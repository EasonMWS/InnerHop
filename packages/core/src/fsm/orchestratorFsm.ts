import type { CanonicalMessage, CanonicalRequest } from '../protocols/normalized.js';
import type { PresetConfig, SessionState } from '../types.js';
import type { SessionStore } from '../store/sessionStore.js';

function isHarnessSystemNotice(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Pure XML-wrapped system reminders / notices injected by harnesses
  if (/^<(system-reminder|system_message|task-notification|notice)\b[^>]*>[\s\S]*<\/\1>$/i.test(trimmed)) {
    return true;
  }
  // Background subagent / task lifecycle notifications & cwd notices injected as user-role messages
  if (
    /^(?:background\s+(?:subagent|agent|task)\b[\s\S]*\b(?:finished|completed|stopped|exited|failed)|subagent\s+\S+\s+(?:finished|completed)|the working directory changed from\s+"|\[(?:notice|system|subagent|background|reminder|timer|cron)\])/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  return false;
}

function getLastMessageAnalysis(messages: CanonicalMessage[]): {
  hasNewUserText: boolean;
  toolErrorTexts: string[];
  hasToolResults: boolean;
  userTextPreview: string;
} {
  if (messages.length === 0) {
    return {
      hasNewUserText: false,
      toolErrorTexts: [],
      hasToolResults: false,
      userTextPreview: '',
    };
  }
  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return {
      hasNewUserText: false,
      toolErrorTexts: [],
      hasToolResults: false,
      userTextPreview: '',
    };
  }

  const textParts = last.parts.filter((p) => p.type === 'text').map((p) => p.text.trim()).filter(Boolean);
  const humanTextParts = textParts.filter((t) => !isHarnessSystemNotice(t));
  const toolResults = last.parts.filter((p) => p.type === 'tool_result');
  const toolErrorTexts: string[] = [];

  for (const tr of toolResults) {
    const contentLower = tr.content.toLowerCase();
    const looksFailed =
      tr.isError === true ||
      /exit code [1-9]\d*/i.test(tr.content) ||
      /\b(test failed|tests failed|enoent|syntaxerror|typeerror|referenceerror)\b/i.test(
        contentLower,
      );
    if (looksFailed) {
      toolErrorTexts.push(tr.content.slice(0, 500));
    }
  }

  const userTextPreview = humanTextParts.join(' ').slice(0, 200);
  // Treat trailing user message as a fresh human turn only if it has non-system human text and NO tool results
  const hasNewUserText = humanTextParts.length > 0 && toolResults.length === 0;

  return {
    hasNewUserText,
    toolErrorTexts,
    hasToolResults: toolResults.length > 0,
    userTextPreview,
  };
}

export class OrchestratorFsm {
  constructor(private readonly store: SessionStore) {}

  onIncomingRequest(
    session: SessionState,
    req: CanonicalRequest,
    preset: PresetConfig,
  ): SessionState {
    const analysis = getLastMessageAnalysis(req.messages);

    if (session.forcePlannerNext) {
      session.forcePlannerNext = false;
      const prev = session.phase;
      session.phase = 'PLANNING';
      session.reviewReason = 'manual_override';
      this.store.appendEvent(session, {
        type: 'manual_override',
        fromPhase: prev,
        toPhase: 'PLANNING',
        summary: '用户手动强制本轮交给架构师 (Planner)',
      });
      return session;
    }

    // New human message while executing -> always re-enter PLANNING so Planner evaluates intent
    if (analysis.hasNewUserText && session.phase === 'EXECUTING') {
      session.phase = 'PLANNING';
      session.reviewReason = session.activePlan ? 'user_message' : null;
      session.lastErrorSummary = analysis.userTextPreview
        ? `User message: ${analysis.userTextPreview}`
        : null;
      session.consecutiveErrors = 0;
      this.store.appendEvent(session, {
        type: 'phase_change',
        fromPhase: 'EXECUTING',
        toPhase: 'PLANNING',
        summary: '收到用户新指令，交回架构师评估意图',
        detail: analysis.userTextPreview,
      });
      return session;
    }

    // In EXECUTING phase processing tool results
    if (session.phase === 'EXECUTING' && analysis.hasToolResults) {
      session.execSteps += 1;

      if (analysis.toolErrorTexts.length > 0) {
        session.consecutiveErrors += 1;
        session.lastErrorSummary = analysis.toolErrorTexts.join('\n---\n').slice(0, 1200);
        this.store.appendEvent(session, {
          type: 'tool_error',
          model: preset.executor.modelId,
          summary: `执行工具报错（连续 ${session.consecutiveErrors}/${preset.rules.maxConsecutiveErrors} 次）`,
          detail: session.lastErrorSummary,
        });

        if (
          preset.rules.maxConsecutiveErrors > 0 &&
          session.consecutiveErrors >= preset.rules.maxConsecutiveErrors
        ) {
          session.phase = 'PLANNING';
          session.reviewReason = 'consecutive_errors';
          session.escalationCount += 1;
          this.store.appendEvent(session, {
            type: 'escalation',
            fromPhase: 'EXECUTING',
            toPhase: 'PLANNING',
            model: preset.planner.modelId,
            summary: `连续失败达到 ${session.consecutiveErrors} 次，自动回退给架构师复盘`,
            detail: session.lastErrorSummary ?? undefined,
          });
          return session;
        }
      } else {
        session.consecutiveErrors = 0;
      }

      if (
        preset.rules.reviewEverySteps > 0 &&
        session.execSteps >= preset.rules.reviewEverySteps
      ) {
        session.phase = 'PLANNING';
        session.reviewReason = 'step_checkpoint';
        session.escalationCount += 1;
        this.store.appendEvent(session, {
          type: 'escalation',
          fromPhase: 'EXECUTING',
          toPhase: 'PLANNING',
          model: preset.planner.modelId,
          summary: `执行手已连续运行 ${session.execSteps} 步，触发架构师定期巡检`,
        });
        return session;
      }
    }

    this.store.save(session);
    return session;
  }

  onHandoff(
    session: SessionState,
    args: { plan: string; replan_if?: string; summary?: string },
    preset: PresetConfig,
  ): SessionState {
    const prev = session.phase;
    session.activePlan = args.plan;
    session.replanIf = args.replan_if ?? null;
    session.planVersion += 1;
    session.phase = 'EXECUTING';
    session.execSteps = 0;
    session.consecutiveErrors = 0;
    session.reviewReason = null;
    session.lastErrorSummary = null;

    this.store.appendEvent(session, {
      type: 'handoff',
      fromPhase: prev,
      toPhase: 'EXECUTING',
      model: preset.executor.modelId,
      summary:
        args.summary?.trim() ||
        `架构师定稿方案 v${session.planVersion} → 交棒执行手 (${preset.executor.modelId})`,
      detail: args.plan,
    });
    return session;
  }

  onEscalate(
    session: SessionState,
    args: { reason: string; progress_report: string },
    preset: PresetConfig,
  ): SessionState {
    const prev = session.phase;
    session.phase = 'PLANNING';
    session.reviewReason = 'executor_escalation';
    session.escalationCount += 1;
    session.consecutiveErrors = 0;
    session.lastErrorSummary = `Escalation reason: ${args.reason}\nProgress report:\n${args.progress_report}`;

    this.store.appendEvent(session, {
      type: 'escalation',
      fromPhase: prev,
      toPhase: 'PLANNING',
      model: preset.planner.modelId,
      summary: `执行手主动上报回退：${args.reason.slice(0, 80)}`,
      detail: session.lastErrorSummary,
    });
    return session;
  }

  recordUsage(
    session: SessionState,
    role: 'planner' | 'executor',
    inputTokens: number,
    outputTokens: number,
    preset: PresetConfig,
    cachedInputTokens = 0,
  ): void {
    const ref = role === 'planner' ? preset.planner : preset.executor;
    const inPrice = ref.inputPricePerM ?? (role === 'planner' ? 15 : 0.5);
    const outPrice = ref.outputPricePerM ?? (role === 'planner' ? 75 : 1.5);
    const planInPrice = preset.planner.inputPricePerM ?? 15;
    const planOutPrice = preset.planner.outputPricePerM ?? 75;

    const cached = Math.min(Math.max(0, cachedInputTokens), inputTokens);
    const uncached = Math.max(0, inputTokens - cached);

    if (role === 'planner') {
      session.usage.plannerInput += inputTokens;
      session.usage.plannerOutput += outputTokens;
      session.usage.plannerCachedInput = (session.usage.plannerCachedInput ?? 0) + cached;
    } else {
      session.usage.executorInput += inputTokens;
      session.usage.executorOutput += outputTokens;
      session.usage.executorCachedInput = (session.usage.executorCachedInput ?? 0) + cached;
    }

    session.usage.actualCostUsd +=
      (uncached / 1_000_000) * inPrice +
      (cached / 1_000_000) * (inPrice * 0.1) +
      (outputTokens / 1_000_000) * outPrice;
    session.usage.baselinePlannerCostUsd +=
      (uncached / 1_000_000) * planInPrice +
      (cached / 1_000_000) * (planInPrice * 0.1) +
      (outputTokens / 1_000_000) * planOutPrice;

    this.store.save(session);
  }
}
