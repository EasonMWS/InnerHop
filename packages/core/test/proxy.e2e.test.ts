import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigStore,
  createDefaultConfig,
  createOrchestratorServer,
  HarnessManager,
  SessionStore,
  VIRTUAL_ESCALATE_TOOL_NAME,
  VIRTUAL_HANDOFF_TOOL_NAME,
} from '../src/index.js';

interface RecordedUpstreamCall {
  path: string;
  model: string;
  toolNames: string[];
  systemText: string;
  messages: unknown[];
  headers: Record<string, string | string[] | undefined>;
  rawBody: Record<string, unknown>;
}

function parseAnthropicSseEvents(raw: string): Array<{ event: string; data: Record<string, unknown> }> {
  const frames: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of raw.split(/\n\n+/)) {
    if (!block.trim()) continue;
    let event = 'message';
    let dataStr = '';
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
    }
    if (dataStr && dataStr !== '[DONE]') {
      frames.push({ event, data: JSON.parse(dataStr) as Record<string, unknown> });
    }
  }
  return frames;
}

describe('Orchestrator Proxy E2E (Inner-Hop, Escalation, Multi-Protocol)', () => {
  let tmpDir: string;
  let mockUpstream: Server;
  let mockUpstreamUrl: string;
  let recordedCalls: RecordedUpstreamCall[];
  let nextPlannerAction: 'qa' | 'read' | 'handoff' = 'handoff';
  let nextExecutorAction: 'edit' | 'escalate' = 'edit';
  let proxyHandle: ReturnType<typeof createOrchestratorServer>;
  let proxyUrl: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
    recordedCalls = [];
    nextPlannerAction = 'handoff';
    nextExecutorAction = 'edit';

    mockUpstream = createServer((req, res) => {
      let bodyStr = '';
      req.on('data', (c) => (bodyStr += c.toString()));
      req.on('end', () => {
        const body = JSON.parse(bodyStr) as Record<string, unknown>;
        const isAnthropic = req.url?.includes('/v1/messages');
        const isResponses = req.url?.includes('/responses');
        const model = String(body.model ?? '');
        const messages = Array.isArray(body.messages)
          ? body.messages
          : Array.isArray(body.input)
            ? body.input
            : [];
        const tools = Array.isArray(body.tools) ? body.tools : [];
        const toolNames = tools.map((t: Record<string, unknown>) =>
          typeof t.name === 'string'
            ? t.name
            : String((t.function as { name?: string } | undefined)?.name ?? ''),
        );
        const systemText = isAnthropic
          ? Array.isArray(body.system)
            ? body.system.map((s: { text?: string }) => s.text ?? '').join('\n')
            : String(body.system ?? '')
          : isResponses
            ? String(body.instructions ?? '')
            : String((messages[0] as { content?: string } | undefined)?.content ?? '');

        recordedCalls.push({
          path: req.url ?? '',
          model,
          toolNames,
          systemText,
          messages,
          headers: req.headers,
          rawBody: body,
        });

        // Reject if foreign thinking block with signature was leaked to wrong model
        if (isAnthropic) {
          for (const m of messages as Array<{ role?: string; content?: Array<{ type?: string; signature?: string }> }>) {
            if (m.role === 'assistant' && Array.isArray(m.content)) {
              for (const part of m.content) {
                if (part.type === 'thinking' && part.signature === 'sig-planner-only' && model !== 'planner-opus') {
                  res.writeHead(400, { 'content-type': 'application/json' });
                  res.end(JSON.stringify({ error: { message: 'Invalid thinking signature for model' } }));
                  return;
                }
              }
            }
          }
        }

        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        });

        if (isAnthropic) {
          const send = (ev: string, data: unknown) =>
            res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
          send('message_start', {
            type: 'message_start',
            message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 0 } },
          });

          if (model === 'planner-opus' || model === 'claude-opus-5-5') {
            if (nextPlannerAction === 'qa') {
              if (model === 'claude-opus-5-5') {
                send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
                send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Reasoning deeply...' } });
                send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig_claude_5_5' } });
                send('content_block_stop', { type: 'content_block_stop', index: 0 });
                send('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
                send('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Direct Q&A answer.' } });
                send('content_block_stop', { type: 'content_block_stop', index: 1 });
                send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } });
              } else {
                send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
                send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Direct Q&A answer.' } });
                send('content_block_stop', { type: 'content_block_stop', index: 0 });
                send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } });
              }
            } else if (nextPlannerAction === 'read') {
              send('content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: 'tu_read_1', name: 'Read', input: {} },
              });
              send('content_block_delta', {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts"}' },
              });
              send('content_block_stop', { type: 'content_block_stop', index: 0 });
              send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } });
            } else {
              send('content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: 'tu_handoff_1', name: VIRTUAL_HANDOFF_TOOL_NAME, input: {} },
              });
              send('content_block_delta', {
                type: 'content_block_delta',
                index: 0,
                delta: {
                  type: 'input_json_delta',
                  partial_json: JSON.stringify({
                    plan: '1. Edit a.ts\n2. Run tests',
                    replan_if: 'Tests fail twice',
                  }),
                },
              });
              send('content_block_stop', { type: 'content_block_stop', index: 0 });
              send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 40 } });
            }
          } else {
            // Executor (OpenAI-compat upstream or Anthropic upstream)
            if (nextExecutorAction === 'escalate') {
              send('content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: 'tu_esc_1', name: VIRTUAL_ESCALATE_TOOL_NAME, input: {} },
              });
              send('content_block_delta', {
                type: 'content_block_delta',
                index: 0,
                delta: {
                  type: 'input_json_delta',
                  partial_json: JSON.stringify({ reason: 'Missing auth helper', progress_report: 'Blocked at step 1' }),
                },
              });
              send('content_block_stop', { type: 'content_block_stop', index: 0 });
              send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 35 } });
            }
          }
          send('message_stop', { type: 'message_stop' });
          res.end();
        } else if (isResponses) {
          const sendResp = (ev: string, data: Record<string, unknown>) =>
            res.write(`event: ${ev}\ndata: ${JSON.stringify({ type: ev, ...data })}\n\n`);
          sendResp('response.created', { response: { id: 'resp_up_1' } });
          if (model === 'gpt-6-astra' || model === 'gpt-6.2-astra') {
            const argsStr = JSON.stringify({
              plan: '1. Apply patch via executor',
              replan_if: 'Tests fail',
            });
            sendResp('response.output_item.added', {
              output_index: 0,
              item: {
                type: 'function_call',
                call_id: 'fc_handoff_1',
                name: VIRTUAL_HANDOFF_TOOL_NAME,
              },
            });
            sendResp('response.function_call_arguments.delta', {
              output_index: 0,
              delta: argsStr,
            });
            sendResp('response.output_item.done', {
              output_index: 0,
              item: {
                type: 'function_call',
                call_id: 'fc_handoff_1',
                name: VIRTUAL_HANDOFF_TOOL_NAME,
                arguments: argsStr,
              },
            });
          } else {
            sendResp('response.output_text.delta', { delta: 'Codex executor running.' });
            sendResp('response.output_item.added', {
              output_index: 0,
              item: { type: 'function_call', call_id: 'fc_patch_1', name: 'apply_patch' },
            });
            sendResp('response.output_item.done', {
              output_index: 0,
              item: {
                type: 'function_call',
                call_id: 'fc_patch_1',
                name: 'apply_patch',
                arguments: '{"patch":"ok"}',
              },
            });
          }
          sendResp('response.completed', {
            response: { usage: { input_tokens: 50, output_tokens: 20 } },
          });
          res.end();
        } else {
          // OpenAI Chat Completions upstream (Executor)
          const sendChunk = (delta: Record<string, unknown>, finish: string | null = null) =>
            res.write(
              `data: ${JSON.stringify({
                id: 'c1',
                object: 'chat.completion.chunk',
                choices: [{ index: 0, delta, finish_reason: finish }],
              })}\n\n`,
            );

          if (nextExecutorAction === 'escalate') {
            sendChunk({
              tool_calls: [
                {
                  index: 0,
                  id: 'call_esc_1',
                  type: 'function',
                  function: {
                    name: VIRTUAL_ESCALATE_TOOL_NAME,
                    arguments: JSON.stringify({
                      reason: 'Missing auth helper',
                      progress_report: 'Blocked on step 1',
                    }),
                  },
                },
              ],
            });
            sendChunk({}, 'tool_calls');
          } else {
            sendChunk({ content: 'Executor applying edit. ' });
            sendChunk({
              tool_calls: [
                {
                  index: 0,
                  id: 'call_edit_1',
                  type: 'function',
                  function: { name: 'Edit', arguments: '{"path":"a.ts"}' },
                },
              ],
            });
            sendChunk({}, 'tool_calls');
          }
          res.write('data: [DONE]\n\n');
          res.end();
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockUpstream.listen(0, '127.0.0.1', () => {
        const addr = mockUpstream.address();
        if (addr && typeof addr === 'object') {
          mockUpstreamUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    const configStore = new ConfigStore(tmpDir);
    const sessionStore = new SessionStore(tmpDir);
    const harnessManager = new HarnessManager({ homeDir: tmpDir, dataDir: tmpDir });
    const cfg = createDefaultConfig();
    cfg.providers = [
      {
        id: 'mock-anthropic-planner',
        name: 'Planner',
        type: 'anthropic',
        baseUrl: mockUpstreamUrl,
        apiKey: 'k1',
      },
      {
        id: 'mock-openai-exec',
        name: 'Executor',
        type: 'openai-compat',
        baseUrl: `${mockUpstreamUrl}/v1`,
        apiKey: 'k2',
      },
      {
        id: 'mock-openai-responses',
        name: 'OpenAI Responses API',
        type: 'openai-responses',
        baseUrl: mockUpstreamUrl,
        apiKey: 'sk-test-openai-key',
      },
      ...cfg.providers,
    ];
    cfg.routing.bypassAnthropicBaseUrl = mockUpstreamUrl;
    cfg.routing.bypassOpenAIBaseUrl = `${mockUpstreamUrl}/v1`;
    cfg.presets.unshift(
      {
        id: 'e2e-pair',
        name: 'E2E Pair',
        description: 'Anthropic planner + OpenAI executor',
        planner: { providerId: 'mock-anthropic-planner', modelId: 'planner-opus', inputPricePerM: 15, outputPricePerM: 75 },
        executor: { providerId: 'mock-openai-exec', modelId: 'executor-flash', inputPricePerM: 0.3, outputPricePerM: 1.5 },
        rules: {
          readOnlyPlanning: true,
          maxConsecutiveErrors: 2,
          reviewEverySteps: 10,
          maxHopsPerRequest: 2,
          inlineStatusBadge: false,
        },
      },
      {
        id: 'e2e-openai-responses',
        name: 'E2E OpenAI Responses',
        description: 'Standard OpenAI Responses API pair',
        planner: { providerId: 'mock-openai-responses', modelId: 'gpt-6-astra', inputPricePerM: 10, outputPricePerM: 30 },
        executor: { providerId: 'mock-openai-responses', modelId: 'gpt-6.1-sol', inputPricePerM: 3, outputPricePerM: 12 },
        rules: {
          readOnlyPlanning: true,
          maxConsecutiveErrors: 2,
          reviewEverySteps: 10,
          maxHopsPerRequest: 2,
          inlineStatusBadge: false,
        },
      },
    );
    cfg.activePresetId = 'e2e-pair';
    configStore.updateConfig(cfg);

    proxyHandle = createOrchestratorServer({ configStore, sessionStore, harnessManager });
    const info = await proxyHandle.listen(0, '127.0.0.1');
    proxyUrl = info.url;
  });

  afterEach(async () => {
    await proxyHandle.close();
    await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles pure Q&A fast-path without invoking Executor', async () => {
    nextPlannerAction = 'qa';
    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'qa-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [{ role: 'user', content: 'What does this file do?' }],
        tools: [
          { name: 'Read', input_schema: { type: 'object' } },
          { name: 'Edit', input_schema: { type: 'object' } },
        ],
      }),
    });
    const raw = await res.text();
    const events = parseAnthropicSseEvents(raw);
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].model).toBe('planner-opus');
    // Edit was filtered out in PLANNING
    expect(recordedCalls[0].toolNames).toContain('Read');
    expect(recordedCalls[0].toolNames).not.toContain('Edit');
    expect(events.some((e) => e.event === 'message_stop')).toBe(true);

    const sessRes = await fetch(`${proxyUrl}/api/sessions`);
    const sessList = (await sessRes.json()) as Array<{
      title?: string;
      plannerModel?: string;
      executorModel?: string;
      timeline: Array<{ type: string; model?: string }>;
    }>;
    expect(sessList).toHaveLength(1);
    expect(sessList[0].title).toBe('What does this file do?');
    expect(sessList[0].plannerModel).toBe('planner-opus');
    expect(sessList[0].executorModel).toBe('executor-flash');
    expect(sessList[0].timeline.some((t) => t.type === 'turn_complete' && t.model === 'planner-opus')).toBe(true);

    const clearRes = await fetch(`${proxyUrl}/api/sessions`, { method: 'DELETE' });
    expect(clearRes.status).toBe(200);
    const afterClear = (await (await fetch(`${proxyUrl}/api/sessions`)).json()) as unknown[];
    expect(afterClear).toHaveLength(0);
  });

  it('performs seamless Planner -> Executor Inner-Hop and swallows virtual tools cleanly', async () => {
    nextPlannerAction = 'handoff';
    nextExecutorAction = 'edit';

    const res = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'inner-hop-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [
          { role: 'user', content: 'Update a.ts' },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'hmm', signature: 'sig-planner-only' },
              { type: 'text', text: 'Let me check.' },
            ],
          },
          { role: 'user', content: 'Proceed now' },
        ],
        tools: [
          { name: 'Read', input_schema: { type: 'object' } },
          { name: 'Edit', input_schema: { type: 'object' } },
        ],
      }),
    });

    const raw = await res.text();
    const events = parseAnthropicSseEvents(raw);

    // 2 upstream calls in 1 HTTP turn: Planner -> Executor
    expect(recordedCalls).toHaveLength(2);
    expect(recordedCalls[0].model).toBe('planner-opus');
    expect(recordedCalls[0].toolNames).not.toContain('Edit');
    expect(recordedCalls[1].model).toBe('executor-flash');
    expect(recordedCalls[1].toolNames).toContain('Edit');

    // Virtual handoff tool must NEVER leak to client
    const toolStarts = events.filter(
      (e) => e.event === 'content_block_start' && (e.data.content_block as { type?: string })?.type === 'tool_use',
    );
    expect(toolStarts).toHaveLength(1);
    expect((toolStarts[0].data.content_block as { name: string }).name).toBe('Edit');

    // Content block indices must be strictly contiguous 0, 1, ...
    const blockIndices = events
      .filter((e) => e.event === 'content_block_start')
      .map((e) => Number(e.data.index));
    expect(blockIndices).toEqual([0, 1]);
  });

  it('escalates back from Executor to Planner in the same HTTP turn on orchestrator_escalate', async () => {
    // First put session in EXECUTING
    const sessRes = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'esc-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [{ role: 'user', content: 'Refactor auth' }],
        tools: [{ name: 'Edit', input_schema: { type: 'object' } }],
      }),
    });
    await sessRes.text();

    recordedCalls = [];
    nextExecutorAction = 'escalate';
    nextPlannerAction = 'qa'; // Planner receives escalation and replies directly

    const res2 = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'esc-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [
          { role: 'user', content: 'Refactor auth' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'call_edit_1', name: 'Edit', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_edit_1', content: 'done' }] },
        ],
        tools: [{ name: 'Edit', input_schema: { type: 'object' } }],
      }),
    });

    const raw2 = await res2.text();
    expect(recordedCalls).toHaveLength(2);
    expect(recordedCalls[0].model).toBe('executor-flash');
    expect(recordedCalls[1].model).toBe('planner-opus');
    expect(recordedCalls[1].systemText).toContain('[PLAN REVIEW TRIGGERED]');
    expect(raw2).toContain('Direct Q&A answer.');
    expect(raw2).not.toContain(VIRTUAL_ESCALATE_TOOL_NAME);
  });

  it('works over OpenAI /v1/chat/completions and /v1/responses streaming', async () => {
    nextPlannerAction = 'handoff';
    nextExecutorAction = 'edit';

    const chatRes = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-innerhop-session': 'openai-chat-sess',
      },
      body: JSON.stringify({
        model: 'ih:e2e-pair',
        stream: true,
        messages: [{ role: 'user', content: 'Fix bug in a.ts' }],
        tools: [
          { type: 'function', function: { name: 'Read', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'Edit', parameters: { type: 'object' } } },
        ],
      }),
    });
    const chatText = await chatRes.text();
    expect(chatText).toContain('Executor applying edit.');
    expect(chatText).toContain('"name":"Edit"');
    expect(chatText).not.toContain(VIRTUAL_HANDOFF_TOOL_NAME);
    expect(chatText).toContain('data: [DONE]');

    recordedCalls = [];
    const respRes = await fetch(`${proxyUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'openai-resp-sess',
      },
      body: JSON.stringify({
        model: 'orch:e2e-pair',
        stream: true,
        input: 'Fix bug in a.ts',
        tools: [
          { type: 'function', name: 'Read', parameters: { type: 'object' } },
          { type: 'function', name: 'apply_patch', parameters: { type: 'object' } },
        ],
      }),
    });
    const respText = await respRes.text();
    expect(respText).toContain('response.output_text.delta');
    expect(respText).toContain('response.completed');
    expect(respText).not.toContain(VIRTUAL_HANDOFF_TOOL_NAME);
  });

  it('smart-split bypasses native models while orchestrating trigger slots', async () => {
    // Default triggerModelPatterns = ['opus', 'opusplan']
    const bypassRes = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'user-native-key',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        stream: true,
        system: 'Native Claude Code prompt',
        messages: [{ role: 'user', content: 'Say hi' }],
        tools: [{ name: 'Edit', input_schema: { type: 'object' } }],
      }),
    });

    expect(bypassRes.headers.get('x-innerhop-routed')).toBe('bypass');
    await bypassRes.text();
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].model).toBe('claude-sonnet-4-5');
    expect(recordedCalls[0].systemText).toBe('Native Claude Code prompt');
    expect(recordedCalls[0].systemText).not.toContain('<innerhop_role');
    expect(recordedCalls[0].toolNames).toContain('Edit');

    recordedCalls = [];
    nextPlannerAction = 'qa';
    const triggerRes = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-innerhop-session': 'slot-trigger-sess',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-1',
        stream: true,
        messages: [{ role: 'user', content: 'Explain auth.ts' }],
        tools: [
          { name: 'Read', input_schema: { type: 'object' } },
          { name: 'Edit', input_schema: { type: 'object' } },
        ],
      }),
    });

    expect(triggerRes.headers.get('x-innerhop-routed')).toBe('innerhop');
    await triggerRes.text();
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].model).toBe('planner-opus');
    expect(recordedCalls[0].systemText).toContain('<innerhop_role');
    expect(recordedCalls[0].toolNames).not.toContain('Edit');
  });

  it('supports OpenAI Responses API Inner-Hop with API Key and customPair mode', async () => {
    const res = await fetch(`${proxyUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-innerhop-session': 'openai-resp-api-sess',
      },
      body: JSON.stringify({
        model: 'ih:e2e-openai-responses',
        stream: true,
        input: 'Patch auth.ts',
        tools: [
          { type: 'function', name: 'Read', parameters: { type: 'object' } },
          { type: 'function', name: 'apply_patch', parameters: { type: 'object' } },
        ],
      }),
    });

    expect(res.headers.get('x-innerhop-routed')).toBe('innerhop');
    const text = await res.text();
    expect(recordedCalls).toHaveLength(2);
    expect(recordedCalls[0].model).toBe('gpt-6-astra');
    expect(recordedCalls[0].headers['authorization']).toBe('Bearer sk-test-openai-key');
    expect(recordedCalls[1].model).toBe('gpt-6.1-sol');
    expect(recordedCalls[1].headers['authorization']).toBe('Bearer sk-test-openai-key');
    expect(text).toContain('Codex executor running.');
    expect(text).toContain('apply_patch');
    expect(text).not.toContain(VIRTUAL_HANDOFF_TOOL_NAME);

    // Test customPair resolution when activePresetId is __custom__
    recordedCalls = [];
    const currentCfg = proxyHandle.configStore.getConfig();
    proxyHandle.configStore.updateConfig({
      ...currentCfg,
      activePresetId: '__custom__',
      customPair: {
        planner: { providerId: 'mock-anthropic-planner', modelId: 'planner-opus' },
        executor: { providerId: 'mock-openai-exec', modelId: 'executor-flash' },
        rules: currentCfg.presets[0].rules,
      },
    });

    const customRes = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-innerhop-session': 'custom-pair-sess',
      },
      body: JSON.stringify({
        model: 'innerhop',
        stream: true,
        messages: [{ role: 'user', content: 'Update auth' }],
        tools: [{ name: 'Edit', input_schema: { type: 'object' } }],
      }),
    });
    expect(customRes.status).toBe(200);
    expect(customRes.headers.get('x-innerhop-routed')).toBe('innerhop');
    await customRes.text();
    expect(recordedCalls).toHaveLength(2);
    expect(recordedCalls[0].model).toBe('planner-opus');
    expect(recordedCalls[1].model).toBe('executor-flash');

    // Backward compatibility: legacy 'orchestrator' alias still routes to InnerHop
    recordedCalls = [];
    const legacyAliasRes = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'legacy-alias-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [{ role: 'user', content: 'Update auth' }],
        tools: [{ name: 'Edit', input_schema: { type: 'object' } }],
      }),
    });
    expect(legacyAliasRes.status).toBe(200);
    expect(legacyAliasRes.headers.get('x-innerhop-routed')).toBe('innerhop');
    await legacyAliasRes.text();
    expect(recordedCalls).toHaveLength(2);
  });

  it('sends max_completion_tokens for OpenAI GPT-5/GPT-6 models and keeps max_tokens for compat models', async () => {
    const gptTestRes = await fetch(`${proxyUrl}/api/providers/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'mock-openai-exec', modelId: 'gpt-6-luna' }),
    });
    expect(gptTestRes.status).toBe(200);
    const gptJson = (await gptTestRes.json()) as { ok: boolean };
    expect(gptJson.ok).toBe(true);
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].rawBody.max_completion_tokens).toBe(128);
    expect(recordedCalls[0].rawBody.max_tokens).toBeUndefined();

    recordedCalls = [];
    const deepseekTestRes = await fetch(`${proxyUrl}/api/providers/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'mock-openai-exec', modelId: 'deepseek-flash' }),
    });
    expect(deepseekTestRes.status).toBe(200);
    const dsJson = (await deepseekTestRes.json()) as { ok: boolean };
    expect(dsJson.ok).toBe(true);
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].rawBody.max_tokens).toBe(128);
    expect(recordedCalls[0].rawBody.max_completion_tokens).toBeUndefined();
  });

  it('translates reasoningEffort into per-vendor protocol fields and omits unsupported ones', async () => {
    const cfg = proxyHandle.configStore.getConfig();
    proxyHandle.configStore.updateConfig({
      ...cfg,
      activePresetId: '__custom__',
      customPair: {
        planner: {
          providerId: 'mock-anthropic-planner',
          modelId: 'claude-opus-5-5',
          reasoningEffort: 'high',
        },
        executor: {
          providerId: 'mock-openai-exec',
          modelId: 'gpt-6.2-sol',
          reasoningEffort: 'low',
        },
        rules: cfg.presets[0].rules,
      },
    });

    recordedCalls = [];
    nextPlannerAction = 'handoff';
    const res1 = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'effort-anthropic-openai-chat',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        temperature: 0.3,
        messages: [{ role: 'user', content: 'Refactor auth' }],
        tools: [{ name: 'Edit', input_schema: { type: 'object' } }],
      }),
    });
    expect(res1.status).toBe(200);
    await res1.text();
    expect(recordedCalls).toHaveLength(2);

    // Modern Claude adaptive thinking + effort (and temperature stripped)
    expect(recordedCalls[0].rawBody.thinking).toEqual({ type: 'adaptive' });
    expect(recordedCalls[0].rawBody.output_config).toEqual({ effort: 'high' });
    expect(recordedCalls[0].rawBody.temperature).toBeUndefined();

    // OpenAI /v1/chat/completions with function tools must omit reasoning_effort for gpt-6.2
    expect(recordedCalls[1].rawBody.reasoning_effort).toBeUndefined();

    // Test OpenAI Responses API (supports tools + reasoning.effort simultaneously + strict: false)
    const cfg2 = proxyHandle.configStore.getConfig();
    proxyHandle.configStore.updateConfig({
      ...cfg2,
      activePresetId: '__custom__',
      customPair: {
        planner: {
          providerId: 'mock-openai-responses',
          modelId: 'gpt-6.2-astra',
          reasoningEffort: 'xhigh',
        },
        executor: {
          providerId: 'mock-openai-responses',
          modelId: 'gpt-6.2-sol',
          reasoningEffort: 'low',
        },
        rules: cfg2.presets[0].rules,
      },
    });

    recordedCalls = [];
    const res2 = await fetch(`${proxyUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'effort-responses-pair',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        temperature: 0.5,
        input: 'Build feature',
        tools: [{ type: 'function', name: 'apply_patch', parameters: { type: 'object' } }],
      }),
    });
    expect(res2.status).toBe(200);
    await res2.text();
    expect(recordedCalls).toHaveLength(2);
    expect(recordedCalls[0].rawBody.reasoning).toEqual({ effort: 'xhigh' });
    expect(recordedCalls[0].rawBody.temperature).toBeUndefined();
    expect((recordedCalls[0].rawBody.tools as Array<{ strict?: boolean }>)[0]?.strict).toBe(false);
    expect(recordedCalls[1].rawBody.reasoning).toEqual({ effort: 'low' });
    expect(recordedCalls[1].rawBody.temperature).toBeUndefined();
    expect((recordedCalls[1].rawBody.tools as Array<{ strict?: boolean }>)[0]?.strict).toBe(false);

    // Test DeepSeek compat (must omit reasoning_effort)
    const cfg3 = proxyHandle.configStore.getConfig();
    proxyHandle.configStore.updateConfig({
      ...cfg3,
      activePresetId: '__custom__',
      customPair: {
        planner: {
          providerId: 'mock-openai-responses',
          modelId: 'gpt-6.2-astra',
          reasoningEffort: 'xhigh',
        },
        executor: {
          providerId: 'mock-openai-exec',
          modelId: 'deepseek-flash',
          reasoningEffort: 'high',
        },
        rules: cfg3.presets[0].rules,
      },
    });

    recordedCalls = [];
    const res3 = await fetch(`${proxyUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'effort-deepseek-omit',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        input: 'Build feature',
        tools: [{ type: 'function', name: 'apply_patch', parameters: { type: 'object' } }],
      }),
    });
    expect(res3.status).toBe(200);
    await res3.text();
    expect(recordedCalls).toHaveLength(2);
    expect(recordedCalls[1].rawBody.reasoning_effort).toBeUndefined();
    expect(recordedCalls[1].rawBody.reasoning).toBeUndefined();
  });

  it('ensures DeepSeek tool_calls assistant messages always carry reasoning_content across handoff and follow-up turns', async () => {
    const cfg = proxyHandle.configStore.getConfig();
    proxyHandle.configStore.updateConfig({
      ...cfg,
      activePresetId: '__custom__',
      customPair: {
        planner: {
          providerId: 'mock-openai-responses',
          modelId: 'gpt-6.2-astra',
        },
        executor: {
          providerId: 'mock-openai-exec',
          modelId: 'deepseek-flash',
        },
        rules: cfg.presets[0].rules,
      },
    });

    // Turn 1: Planner hands off to DeepSeek Executor over OpenAI Chat Completions
    recordedCalls = [];
    const turn1 = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'deepseek-reasoning-content-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [{ role: 'user', content: 'Create game html' }],
        tools: [
          {
            type: 'function',
            function: { name: 'Edit', parameters: { type: 'object' } },
          },
        ],
      }),
    });
    expect(turn1.status).toBe(200);
    await turn1.text();
    expect(recordedCalls).toHaveLength(2);

    const dsMessages1 = recordedCalls[1].messages as Array<{
      role?: string;
      tool_calls?: unknown[];
      reasoning_content?: string;
    }>;
    const dsAssistantToolCalls1 = dsMessages1.filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
    expect(dsAssistantToolCalls1.length).toBeGreaterThan(0);
    for (const msg of dsAssistantToolCalls1) {
      expect(typeof msg.reasoning_content).toBe('string');
      expect(msg.reasoning_content!.trim().length).toBeGreaterThan(0);
    }

    // Turn 2: Client sends back both an assistant message with explicit reasoning_content and one where client stripped it
    recordedCalls = [];
    const turn2 = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'deepseek-reasoning-content-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [
          { role: 'user', content: 'Create game html' },
          {
            role: 'assistant',
            content: null,
            reasoning_content: 'Client preserved thinking text.',
            tool_calls: [
              { id: 'c_1', type: 'function', function: { name: 'Edit', arguments: '{"path":"a.ts"}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'c_1', content: 'edited a.ts' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c_2', type: 'function', function: { name: 'Edit', arguments: '{"path":"b.ts"}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'c_2', content: 'edited b.ts' },
        ],
        tools: [
          {
            type: 'function',
            function: { name: 'Edit', parameters: { type: 'object' } },
          },
        ],
      }),
    });
    expect(turn2.status).toBe(200);
    await turn2.text();
    expect(recordedCalls).toHaveLength(1);
    const dsMessages2 = recordedCalls[0].messages as Array<{
      role?: string;
      tool_calls?: unknown[];
      reasoning_content?: string;
    }>;
    const dsAssistantToolCalls2 = dsMessages2.filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
    expect(dsAssistantToolCalls2).toHaveLength(2);
    expect(dsAssistantToolCalls2[0].reasoning_content).toBe('Client preserved thinking text.');
    expect(typeof dsAssistantToolCalls2[1].reasoning_content).toBe('string');
    expect(dsAssistantToolCalls2[1].reasoning_content!.trim().length).toBeGreaterThan(0);
  });

  it('injects Gemini thought_signature on cross-model tool calls and preserves real signatures', async () => {
    const cfg = proxyHandle.configStore.getConfig();
    proxyHandle.configStore.updateConfig({
      ...cfg,
      activePresetId: '__custom__',
      customPair: {
        planner: {
          providerId: 'mock-openai-responses',
          modelId: 'gpt-6.2-astra',
        },
        executor: {
          providerId: 'mock-openai-exec',
          modelId: 'gemini-4-hydrogen',
        },
        rules: cfg.presets[0].rules,
      },
    });

    recordedCalls = [];
    const res1 = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'gemini-sig-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [{ role: 'user', content: 'Edit file' }],
        tools: [{ type: 'function', function: { name: 'Edit', parameters: { type: 'object' } } }],
      }),
    });
    expect(res1.status).toBe(200);
    await res1.text();
    expect(recordedCalls).toHaveLength(2);
    const gemMsgs1 = recordedCalls[1].messages as Array<{
      role?: string;
      tool_calls?: Array<{ extra_content?: { google?: { thought_signature?: string } } }>;
    }>;
    const gemToolMsg1 = gemMsgs1.find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
    expect(gemToolMsg1?.tool_calls?.[0]?.extra_content?.google?.thought_signature).toBe(
      'skip_thought_signature_validator',
    );

    // Follow-up turn where client preserves real Gemini thought_signature
    recordedCalls = [];
    const res2 = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'gemini-sig-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [
          { role: 'user', content: 'Edit file' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'gem_call_1',
                type: 'function',
                function: { name: 'Edit', arguments: '{"path":"a.ts"}' },
                extra_content: { google: { thought_signature: 'real_gemini_sig_999' } },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'gem_call_1', content: 'ok' },
        ],
        tools: [{ type: 'function', function: { name: 'Edit', parameters: { type: 'object' } } }],
      }),
    });
    expect(res2.status).toBe(200);
    await res2.text();
    expect(recordedCalls).toHaveLength(1);
    const gemMsgs2 = recordedCalls[0].messages as Array<{
      role?: string;
      tool_calls?: Array<{ extra_content?: { google?: { thought_signature?: string } } }>;
    }>;
    const gemToolMsg2 = gemMsgs2.find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
    expect(gemToolMsg2?.tool_calls?.[0]?.extra_content?.google?.thought_signature).toBe(
      'real_gemini_sig_999',
    );
  });

  it('safely downgrades Anthropic thinking on unsigned tool history, normalizes tool IDs, and forwards signature_delta', async () => {
    const cfg = proxyHandle.configStore.getConfig();
    proxyHandle.configStore.updateConfig({
      ...cfg,
      activePresetId: '__custom__',
      customPair: {
        planner: {
          providerId: 'mock-anthropic-planner',
          modelId: 'claude-opus-5-5',
          reasoningEffort: 'high',
        },
        executor: {
          providerId: 'mock-openai-exec',
          modelId: 'deepseek-flash',
        },
        rules: cfg.presets[0].rules,
      },
    });

    // 1. Fresh Q&A forwards signature_delta cleanly in Anthropic SSE
    recordedCalls = [];
    nextPlannerAction = 'qa';
    const qaRes = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'claude-sig-delta-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [{ role: 'user', content: 'Explain' }],
      }),
    });
    expect(qaRes.status).toBe(200);
    const qaRaw = await qaRes.text();
    expect(qaRaw).toContain('"type":"signature_delta"');
    expect(qaRaw).toContain('"signature":"sig_claude_5_5"');

    // 2. Follow-up turn where prior assistant tool_use has no signed thinking block & invalid tool ID characters
    recordedCalls = [];
    nextPlannerAction = 'qa';
    const followUpRes = await fetch(`${proxyUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'claude-unsigned-tool-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [
          { role: 'user', content: 'Do task' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call:weird.id/1', name: 'Read', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'call:weird.id/1', content: 'file text' }],
          },
        ],
        tools: [{ name: 'Read', input_schema: { type: 'object' } }],
      }),
    });
    expect(followUpRes.status).toBe(200);
    await followUpRes.text();
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0].rawBody.thinking).toBeUndefined();
    const sentMsgs = recordedCalls[0].rawBody.messages as Array<{
      role: string;
      content: Array<{ type: string; id?: string; tool_use_id?: string }>;
    }>;
    const toolUseId = sentMsgs[1].content.find((b) => b.type === 'tool_use')?.id;
    const toolResId = sentMsgs[2].content.find((b) => b.type === 'tool_result')?.tool_use_id;
    expect(toolUseId).toBe('call_weird_id_1');
    expect(toolResId).toBe('call_weird_id_1');
  });

  it('normalizes over-long call_id values to <= 64 chars for OpenAI Responses API', async () => {
    const cfg = proxyHandle.configStore.getConfig();
    proxyHandle.configStore.updateConfig({
      ...cfg,
      activePresetId: '__custom__',
      customPair: {
        planner: {
          providerId: 'mock-openai-responses',
          modelId: 'gpt-6.2-astra',
        },
        executor: {
          providerId: 'mock-openai-responses',
          modelId: 'gpt-6.2-sol',
        },
        rules: cfg.presets[0].rules,
      },
    });

    const longId = `call_${'x'.repeat(80)}`;
    recordedCalls = [];
    const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orchestrator-session': 'long-call-id-sess',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        stream: true,
        messages: [
          { role: 'user', content: 'Do task' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: longId, type: 'function', function: { name: 'Read', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: longId, content: 'contents' },
        ],
        tools: [{ type: 'function', function: { name: 'Read', parameters: { type: 'object' } } }],
      }),
    });
    expect(res.status).toBe(200);
    await res.text();
    const inputItems = recordedCalls[0].rawBody.input as Array<{ type?: string; call_id?: string }>;
    const fc = inputItems.find((i) => i.type === 'function_call');
    const fco = inputItems.find((i) => i.type === 'function_call_output');
    expect(fc?.call_id).toBeDefined();
    expect(fc!.call_id!.length).toBeLessThanOrEqual(64);
    expect(fco?.call_id).toBe(fc?.call_id);
  });
});
