import {
  buildExecutorSystemAddendum,
  buildPlannerSystemAddendum,
} from '../fsm/prompts.js';
import { OrchestratorFsm } from '../fsm/orchestratorFsm.js';
import { extractSessionId } from '../fsm/sessionKey.js';
import { detectHarnessHint, filterReadOnlyTools } from '../fsm/toolClassifier.js';
import {
  ORCHESTRATOR_ESCALATE_TOOL,
  ORCHESTRATOR_HANDOFF_TOOL,
  VIRTUAL_ESCALATE_TOOL_NAME,
  VIRTUAL_HANDOFF_TOOL_NAME,
  VIRTUAL_TOOL_NAMES,
} from '../fsm/virtualTools.js';
import type { StreamResponseSink } from '../protocols/anthropicInbound.js';
import type {
  CanonicalContentPart,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalStreamEvent,
} from '../protocols/normalized.js';
import {
  appendSystemAddendumPreservingCache,
  sanitizeMessagesForTarget,
} from '../protocols/sanitizer.js';
import { streamUpstreamTurn } from '../protocols/upstreamClient.js';
import type { ConfigStore } from '../store/configStore.js';
import type { SessionStore } from '../store/sessionStore.js';
import type { SessionState } from '../types.js';

export interface EngineDeps {
  configStore: ConfigStore;
  sessionStore: SessionStore;
  fsm: OrchestratorFsm;
}

function extractSessionTitle(req: CanonicalRequest): string | undefined {
  for (const m of req.messages) {
    if (m.role !== 'user') continue;
    const raw = m.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) continue;
    return raw.length > 48 ? `${raw.slice(0, 48)}…` : raw;
  }
  return undefined;
}

export async function runOrchestratedTurn(
  req: CanonicalRequest,
  sink: StreamResponseSink,
  deps: EngineDeps,
): Promise<SessionState> {
  const { configStore, sessionStore, fsm } = deps;
  const preset = configStore.resolvePreset(req.requestedModel);
  const sessionId = extractSessionId(req);
  const systemText = req.systemParts.map((s) => s.text).join('\n');
  const harnessHint = detectHarnessHint(systemText, req.tools);

  let session = sessionStore.getOrCreate(sessionId, preset.id, harnessHint);
  session.presetName = preset.name;
  session.plannerModel = preset.planner.modelId;
  session.executorModel = preset.executor.modelId;
  if (!session.title) {
    session.title = extractSessionTitle(req);
  }
  session = fsm.onIncomingRequest(session, req, preset);

  let workingMessages: CanonicalMessage[] = structuredClone(req.messages);
  const maxHops = Math.min(3, Math.max(0, preset.rules.maxHopsPerRequest));

  for (let hop = 0; hop <= maxHops; hop++) {
    const isPlanner = session.phase === 'PLANNING';
    const modelRef = isPlanner ? preset.planner : preset.executor;
    const provider = configStore.getProvider(modelRef.providerId);

    if (!provider) {
      sink.emit({
        type: 'error',
        message: `未找到模型供应商配置: ${modelRef.providerId}`,
      });
      break;
    }

    const addendum = isPlanner
      ? buildPlannerSystemAddendum(session)
      : buildExecutorSystemAddendum(session);

    const systemParts = appendSystemAddendumPreservingCache(req.systemParts, addendum);
    const baseTools =
      isPlanner && preset.rules.readOnlyPlanning
        ? filterReadOnlyTools(req.tools)
        : req.tools;

    const virtualTool = isPlanner ? ORCHESTRATOR_HANDOFF_TOOL : ORCHESTRATOR_ESCALATE_TOOL;
    const tools = [...baseTools, virtualTool];

    const sanitizedMessages = sanitizeMessagesForTarget(
      workingMessages,
      modelRef.modelId,
      provider.type,
      session.lastAssistantModel,
    );

    const outboundReq: CanonicalRequest = {
      ...req,
      systemParts,
      messages: sanitizedMessages,
      tools,
    };

    const swallowingToolIds = new Set<string>();
    const bufferedAssistantParts: CanonicalContentPart[] = [];
    let hopTextBuffer = '';
    let hopThinkingBuffer = '';
    let hopThinkingSignature = '';
    let hopInputTokens = 0;
    let hopOutputTokens = 0;
    let triggeredVirtual:
      | { kind: 'handoff'; id: string; input: Record<string, unknown> }
      | { kind: 'escalate'; id: string; input: Record<string, unknown> }
      | null = null;
    let hadError = false;
    let lastErrorMessage = '';

    for await (const ev of streamUpstreamTurn(
      provider,
      modelRef.modelId,
      outboundReq,
      session.phase,
      modelRef.reasoningEffort,
    )) {
      if (ev.type === 'usage') {
        hopInputTokens += ev.inputTokens;
        hopOutputTokens += ev.outputTokens;
        sink.emit(ev);
        continue;
      }

      if (ev.type === 'error') {
        hadError = true;
        lastErrorMessage = ev.message;
        sink.emit(ev);
        break;
      }

      if (ev.type === 'tool_call_start') {
        if (VIRTUAL_TOOL_NAMES.has(ev.name)) {
          swallowingToolIds.add(ev.id);
          continue;
        }
        sink.emit(ev);
        continue;
      }

      if (ev.type === 'tool_call_delta') {
        if (swallowingToolIds.has(ev.id)) {
          continue;
        }
        sink.emit(ev);
        continue;
      }

      if (ev.type === 'tool_call_end') {
        if (swallowingToolIds.has(ev.id)) {
          if (ev.name === VIRTUAL_HANDOFF_TOOL_NAME) {
            triggeredVirtual = { kind: 'handoff', id: ev.id, input: ev.input };
          } else if (ev.name === VIRTUAL_ESCALATE_TOOL_NAME) {
            triggeredVirtual = { kind: 'escalate', id: ev.id, input: ev.input };
          }
          continue;
        }
        if (hopTextBuffer) {
          bufferedAssistantParts.push({ type: 'text', text: hopTextBuffer });
          hopTextBuffer = '';
        }
        bufferedAssistantParts.push({
          type: 'tool_use',
          id: ev.id,
          name: ev.name,
          input: ev.input,
          ...(ev.thoughtSignature ? { thoughtSignature: ev.thoughtSignature } : {}),
        });
        sink.emit(ev);
        continue;
      }

      if (ev.type === 'text_delta') {
        hopTextBuffer += ev.text;
        sink.emit(ev);
        continue;
      }

      if (ev.type === 'thinking_delta') {
        hopThinkingBuffer += ev.thinking;
        sink.emit(ev);
        continue;
      }

      if (ev.type === 'thinking_signature_delta') {
        hopThinkingSignature += ev.signature;
        sink.emit(ev);
        continue;
      }

      if (ev.type === 'done') {
        // Hold off emitting final done if we are about to inner-hop
        if (!triggeredVirtual || hop >= maxHops) {
          sink.emit(ev);
        }
        continue;
      }

      sink.emit(ev);
    }

    session.lastAssistantModel = modelRef.modelId;
    fsm.recordUsage(
      session,
      isPlanner ? 'planner' : 'executor',
      hopInputTokens,
      hopOutputTokens,
      preset,
    );

    if (hadError) {
      sessionStore.appendEvent(session, {
        type: 'tool_error',
        model: modelRef.modelId,
        summary: '本轮上游调用失败',
        detail: lastErrorMessage.slice(0, 300) || undefined,
      });
      break;
    }

    if (triggeredVirtual && hop < maxHops) {
      if (hopThinkingBuffer.trim()) {
        bufferedAssistantParts.unshift({
          type: 'thinking',
          thinking: hopThinkingBuffer.trim(),
          ...(hopThinkingSignature ? { signature: hopThinkingSignature } : {}),
        });
      }
      if (hopTextBuffer) {
        bufferedAssistantParts.push({ type: 'text', text: hopTextBuffer });
      }

      if (triggeredVirtual.kind === 'handoff') {
        const plan = String(triggeredVirtual.input.plan ?? '').trim() || 'Execute the user request.';
        const replanIf =
          typeof triggeredVirtual.input.replan_if === 'string'
            ? triggeredVirtual.input.replan_if
            : undefined;
        const summary =
          typeof triggeredVirtual.input.summary === 'string'
            ? triggeredVirtual.input.summary
            : undefined;

        session = fsm.onHandoff(session, { plan, replan_if: replanIf, summary }, preset);

        if (preset.rules.inlineStatusBadge) {
          sink.emit({
            type: 'text_delta',
            text: `\n[orch] 架构师 (${preset.planner.modelId}) 已定稿方案 v${session.planVersion} → 交棒执行手 (${preset.executor.modelId})\n`,
          });
        }

        // Append virtual tool_use + tool_result to workingMessages so the Executor sees valid turn alternation
        workingMessages = [
          ...workingMessages,
          {
            role: 'assistant',
            parts: [
              ...bufferedAssistantParts,
              {
                type: 'tool_use',
                id: triggeredVirtual.id,
                name: VIRTUAL_HANDOFF_TOOL_NAME,
                input: triggeredVirtual.input,
              },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                type: 'tool_result',
                toolUseId: triggeredVirtual.id,
                content:
                  'Handoff accepted. You are now the EXECUTOR. Execute step 1 of <active_plan> immediately using the available workspace tools.',
              },
            ],
          },
        ];
      } else {
        const reason = String(triggeredVirtual.input.reason ?? 'Needs Planner review');
        const progressReport = String(triggeredVirtual.input.progress_report ?? '');

        session = fsm.onEscalate(
          session,
          { reason, progress_report: progressReport },
          preset,
        );

        if (preset.rules.inlineStatusBadge) {
          sink.emit({
            type: 'text_delta',
            text: `\n[orch] 执行手触发回退 → 交回架构师 (${preset.planner.modelId}) 复盘: ${reason}\n`,
          });
        }

        workingMessages = [
          ...workingMessages,
          {
            role: 'assistant',
            parts: [
              ...bufferedAssistantParts,
              {
                type: 'tool_use',
                id: triggeredVirtual.id,
                name: VIRTUAL_ESCALATE_TOOL_NAME,
                input: triggeredVirtual.input,
              },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                type: 'tool_result',
                toolUseId: triggeredVirtual.id,
                content: `Escalation received. Review the friction (${reason}) and either revise the plan and call ${VIRTUAL_HANDOFF_TOOL_NAME}, or answer the user directly.`,
              },
            ],
          },
        ];
      }

      sink.emit({ type: 'ping' });
      continue;
    }

    const calledToolNames = bufferedAssistantParts
      .filter((p): p is Extract<CanonicalContentPart, { type: 'tool_use' }> => p.type === 'tool_use')
      .map((p) => p.name);
    const summary =
      calledToolNames.length > 0
        ? isPlanner
          ? `架构师只读调研（调用 ${calledToolNames.join('、')}）`
          : `执行手调用工具（${calledToolNames.join('、')}）`
        : isPlanner
          ? '架构师直接回复（无需交棒写代码）'
          : '执行手完成本轮交付';

    const preview = hopTextBuffer.replace(/\s+/g, ' ').trim();
    const usageLine = `输入 ${hopInputTokens} · 输出 ${hopOutputTokens} tokens`;
    const detail = preview
      ? `${usageLine}\n${preview.slice(0, 140)}${preview.length > 140 ? '…' : ''}`
      : usageLine;

    sessionStore.appendEvent(session, {
      type: 'turn_complete',
      model: modelRef.modelId,
      summary,
      detail,
    });

    break;
  }

  sink.close();
  return session;
}

/**
 * Helper for non-streaming HTTP requests: collects all canonical events into an array.
 */
export function createEventCollectorSink(): {
  sink: StreamResponseSink;
  events: CanonicalStreamEvent[];
} {
  const events: CanonicalStreamEvent[] = [];
  const sink: StreamResponseSink = {
    emit(ev) {
      events.push(ev);
    },
    close() {
      // no-op
    },
  };
  return { sink, events };
}
