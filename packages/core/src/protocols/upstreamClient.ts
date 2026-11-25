import { createHash } from 'node:crypto';
import type {
  CanonicalRequest,
  CanonicalStreamEvent,
  CanonicalTool,
} from './normalized.js';
import type { Phase, ProviderConfig, ReasoningEffort } from '../types.js';

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

const MAX_RATE_LIMIT_RETRIES = 3;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 529;
}

function isRateLimitErrorMessage(msg: string): boolean {
  return /rate[_\s-]?limit|too many requests|tokens per min|\btpm\b|\brpm\b|overloaded/i.test(msg);
}

function parseRetryDelayMs(
  headers: Headers | null,
  errorText: string,
  attempt: number,
): number {
  const maxDelay = Number(process.env.INNERHOP_RETRY_MAX_MS ?? 20_000);
  const clamp = (ms: number) => Math.max(50, Math.min(maxDelay, Math.round(ms)));

  const retryAfterMs = headers?.get('retry-after-ms');
  if (retryAfterMs) {
    const n = Number(retryAfterMs);
    if (Number.isFinite(n) && n > 0) return clamp(n + 150);
  }

  const retryAfter = headers?.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return clamp(secs * 1000 + 150);
    const ts = Date.parse(retryAfter);
    if (!Number.isNaN(ts)) {
      const diff = ts - Date.now();
      if (diff > 0) return clamp(diff + 150);
    }
  }

  const hintMatch = errorText.match(/try again in\s+(\d+(?:\.\d+)?)\s*(ms|s)\b/i);
  if (hintMatch) {
    const val = Number(hintMatch[1]);
    if (Number.isFinite(val) && val > 0) {
      return clamp((hintMatch[2].toLowerCase() === 'ms' ? val : val * 1000) + 250);
    }
  }

  const base = Number(process.env.INNERHOP_RETRY_BASE_MS ?? 1800);
  const jitter = Math.random() * 400;
  return clamp(base * Math.pow(2, attempt) + jitter);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchUpstreamWithRetry(
  url: string,
  init: RequestInit,
  onRetry?: () => void,
): Promise<{ res: Response }> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const res = await fetch(url, init);
    if (res.ok || !isRetryableStatus(res.status) || attempt === MAX_RATE_LIMIT_RETRIES) {
      return { res };
    }
    const errText = await res.text().catch(() => res.statusText);
    const delayMs = parseRetryDelayMs(res.headers, errText, attempt);
    onRetry?.();
    await sleepMs(delayMs);
  }
  const res = await fetch(url, init);
  return { res };
}

export function hasDisallowedConsumerSessionHeaders(headers: Record<string, string>): boolean {
  return Boolean(headers['chatgpt-account-id']);
}

function isModernAdaptiveClaude(modelId: string): boolean {
  return /claude-(?:fable|(?:opus|sonnet|haiku)-(?:5|4[.-][6-9]))/i.test(modelId.trim());
}

const LEGACY_THINKING_BUDGETS: Record<Exclude<ReasoningEffort, 'default'>, number> = {
  low: 2048,
  medium: 6144,
  high: 12288,
  xhigh: 24576,
};

function normalizeAnthropicToolId(rawId: string): string {
  const cleaned = rawId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (cleaned.length >= 1 && cleaned.length <= 64) {
    return cleaned;
  }
  const digest = createHash('sha256').update(rawId).digest('hex').slice(0, 24);
  return `toolu_${digest}`;
}

function toAnthropicPayload(
  req: CanonicalRequest,
  modelId: string,
  reasoningEffort?: ReasoningEffort,
) {
  const system = req.systemParts.map((s) => ({
    type: 'text',
    text: s.text,
    ...(s.cacheControl ? { cache_control: s.cacheControl } : {}),
  }));

  const rawMessages = req.messages.map((m) => {
    const mappedBlocks = m.parts.map((p) => {
      switch (p.type) {
        case 'text':
          return {
            type: 'text',
            text: p.text,
            ...(p.cacheControl ? { cache_control: p.cacheControl } : {}),
          };
        case 'thinking':
          return {
            type: 'thinking',
            thinking: p.thinking,
            ...(p.signature ? { signature: p.signature } : {}),
          };
        case 'redacted_thinking':
          return { type: 'redacted_thinking', data: p.data };
        case 'tool_use':
          return {
            type: 'tool_use',
            id: normalizeAnthropicToolId(p.id),
            name: p.name,
            input: p.input,
          };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: normalizeAnthropicToolId(p.toolUseId),
            content: p.content,
            is_error: p.isError === true,
          };
        case 'image':
          return { type: 'image', source: p.source };
      }
    });

    if (m.role === 'assistant') {
      const thinkingBlocks = mappedBlocks.filter(
        (b) => b.type === 'thinking' || b.type === 'redacted_thinking',
      );
      const otherBlocks = mappedBlocks.filter(
        (b) => b.type !== 'thinking' && b.type !== 'redacted_thinking',
      );
      return {
        role: m.role,
        content: [...thinkingBlocks, ...otherBlocks],
      };
    }

    return {
      role: m.role,
      content: mappedBlocks,
    };
  });

  // Merge consecutive same-role messages to guarantee strict user/assistant alternation
  const messages: Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }> = [];
  for (const msg of rawMessages) {
    const prev = messages[messages.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content.push(...msg.content);
    } else {
      messages.push({ role: msg.role, content: [...msg.content] });
    }
  }

  let hasUnsignedAssistantToolHistory = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    const hasToolUse = msg.content.some((b) => b.type === 'tool_use');
    if (!hasToolUse) continue;
    const firstBlock = msg.content[0];
    const hasValidSignedLeadingThinking =
      firstBlock &&
      (firstBlock.type === 'redacted_thinking' ||
        (firstBlock.type === 'thinking' &&
          typeof firstBlock.signature === 'string' &&
          firstBlock.signature.trim().length > 0));
    if (!hasValidSignedLeadingThinking) {
      hasUnsignedAssistantToolHistory = true;
    }
    break;
  }

  const tools = req.tools.map((t: CanonicalTool) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema,
  }));

  const hasEffort =
    Boolean(reasoningEffort && reasoningEffort !== 'default') &&
    !hasUnsignedAssistantToolHistory;
  const adaptiveClaude = hasEffort && isModernAdaptiveClaude(modelId);
  const legacyBudget =
    hasEffort && !adaptiveClaude && reasoningEffort && reasoningEffort !== 'default'
      ? LEGACY_THINKING_BUDGETS[reasoningEffort]
      : undefined;

  const baseMaxTokens = req.maxTokens ?? 8192;
  const maxTokens = legacyBudget ? Math.max(baseMaxTokens, legacyBudget + 4096) : baseMaxTokens;

  return {
    model: modelId,
    max_tokens: maxTokens,
    ...(!hasEffort && req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(adaptiveClaude
      ? {
          thinking: { type: 'adaptive' },
          output_config: { effort: reasoningEffort },
        }
      : legacyBudget
        ? {
            thinking: { type: 'enabled', budget_tokens: legacyBudget },
          }
        : {}),
    ...(req.stopSequences && req.stopSequences.length > 0
      ? { stop_sequences: req.stopSequences }
      : {}),
    ...(system.length > 0 ? { system } : {}),
    messages,
    ...(tools.length > 0 ? { tools } : {}),
    stream: true,
  };
}

function isOpenAIReasoningModel(modelId: string): boolean {
  return /^(?:openai\/)?(?:gpt-[56](?:\b|[.-])|o[134](?:\b|-))/i.test(modelId.trim());
}

function requiresDeepSeekReasoningContent(provider: ProviderConfig, modelId: string): boolean {
  return (
    provider.baseUrl.toLowerCase().includes('deepseek.com') ||
    /deepseek/i.test(modelId)
  );
}

function requiresGeminiThoughtSignature(provider: ProviderConfig, modelId: string): boolean {
  return (
    provider.type === 'google-gemini' ||
    provider.baseUrl.toLowerCase().includes('generativelanguage.googleapis.com') ||
    /(?:^|\/)gemini-/i.test(modelId.trim())
  );
}

function normalizeResponsesCallId(rawId: string): string {
  const trimmed = rawId.trim();
  if (trimmed.length >= 1 && trimmed.length <= 64) {
    return trimmed;
  }
  const digest = createHash('sha256').update(rawId).digest('hex').slice(0, 24);
  return `call_${digest}`;
}

function shouldUseOpenAIResponsesUpstream(provider: ProviderConfig): boolean {
  if (provider.type === 'openai-responses') return true;
  return (
    provider.type === 'openai-compat' &&
    provider.baseUrl.toLowerCase().includes('api.openai.com')
  );
}

function usesMaxCompletionTokens(provider: ProviderConfig, modelId: string): boolean {
  if (provider.baseUrl.toLowerCase().includes('openai.com')) {
    return true;
  }
  return isOpenAIReasoningModel(modelId);
}

function toOpenAIChatPayload(
  req: CanonicalRequest,
  modelId: string,
  provider: ProviderConfig,
  reasoningEffort?: ReasoningEffort,
) {
  const messages: Array<Record<string, unknown>> = [];

  if (req.systemParts.length > 0) {
    messages.push({
      role: 'system',
      content: req.systemParts.map((s) => s.text).join('\n\n'),
    });
  }

  for (const m of req.messages) {
    if (m.role === 'user') {
      const toolResults = m.parts.filter((p) => p.type === 'tool_result');
      const otherParts = m.parts.filter((p) => p.type !== 'tool_result');

      for (const tr of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: tr.toolUseId,
          content: tr.isError ? `[ERROR] ${tr.content}` : tr.content,
        });
      }

      if (otherParts.length > 0) {
        const textOnly = otherParts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
        if (textOnly || toolResults.length === 0) {
          messages.push({ role: 'user', content: textOnly });
        }
      }
    } else {
      const textOnly = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      const thinkingOnly = m.parts
        .filter((p) => p.type === 'thinking')
        .map((p) => p.thinking)
        .join('\n')
        .trim();
      const toolUses = m.parts.filter((p) => p.type === 'tool_use');
      const needsReasoningContent =
        requiresDeepSeekReasoningContent(provider, modelId) &&
        (toolUses.length > 0 || thinkingOnly.length > 0);
      const needsGeminiSignature = requiresGeminiThoughtSignature(provider, modelId);
      messages.push({
        role: 'assistant',
        content: textOnly || null,
        ...(needsReasoningContent
          ? {
              reasoning_content:
                thinkingOnly || 'Proceeding with tool execution based on the active plan.',
            }
          : {}),
        ...(toolUses.length > 0
          ? {
              tool_calls: toolUses.map((tu) => ({
                id: tu.id,
                type: 'function',
                function: {
                  name: tu.name,
                  arguments: JSON.stringify(tu.input),
                },
                ...(needsGeminiSignature
                  ? {
                      extra_content: {
                        google: {
                          thought_signature:
                            tu.thoughtSignature || 'skip_thought_signature_validator',
                        },
                      },
                    }
                  : {}),
              })),
            }
          : {}),
      });
    }
  }

  const tools = req.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema,
    },
  }));

  const useCompletionTokens = usesMaxCompletionTokens(provider, modelId);
  const effortParam: Record<string, unknown> = {};
  if (reasoningEffort && reasoningEffort !== 'default') {
    const baseUrlLower = provider.baseUrl.toLowerCase();
    if (useCompletionTokens) {
      if (!(tools.length > 0 && /gpt-6/i.test(modelId))) {
        effortParam.reasoning_effort = /gpt-6/i.test(modelId)
          ? reasoningEffort
          : reasoningEffort === 'xhigh'
            ? 'high'
            : reasoningEffort;
      }
    } else if (
      provider.type === 'google-gemini' ||
      baseUrlLower.includes('generativelanguage.googleapis.com')
    ) {
      effortParam.reasoning_effort = reasoningEffort === 'xhigh' ? 'high' : reasoningEffort;
    } else if (baseUrlLower.includes('openrouter.ai')) {
      effortParam.reasoning = {
        effort: reasoningEffort === 'xhigh' ? 'high' : reasoningEffort,
      };
    }
  }

  const omitTemperature =
    Boolean(effortParam.reasoning_effort) && isOpenAIReasoningModel(modelId);

  return {
    model: modelId,
    messages,
    ...(req.maxTokens
      ? useCompletionTokens
        ? { max_completion_tokens: req.maxTokens }
        : { max_tokens: req.maxTokens }
      : {}),
    ...(!omitTemperature && req.temperature !== undefined
      ? { temperature: req.temperature }
      : {}),
    ...effortParam,
    ...(tools.length > 0 ? { tools } : {}),
    stream: true,
    stream_options: { include_usage: true },
  };
}

async function* parseSseLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';
  let dataLines: string[] = [];

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) {
            yield { event: currentEvent, data: dataLines.join('\n') };
            dataLines = [];
            currentEvent = 'message';
          }
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    if (dataLines.length > 0) {
      yield { event: currentEvent, data: dataLines.join('\n') };
    }
  } finally {
    reader.releaseLock();
  }
}

async function* streamAnthropicUpstream(
  provider: ProviderConfig,
  modelId: string,
  req: CanonicalRequest,
  reasoningEffort?: ReasoningEffort,
): AsyncGenerator<CanonicalStreamEvent> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': req.rawHeaders['anthropic-version'] || '2023-06-01',
    ...(provider.defaultHeaders ?? {}),
  };

  if (provider.apiKey) {
    headers['x-api-key'] = provider.apiKey;
  } else if (req.rawHeaders['x-api-key']) {
    headers['x-api-key'] = req.rawHeaders['x-api-key'];
  }

  const url = joinUrl(provider.baseUrl, '/v1/messages');
  const bodyStr = JSON.stringify(toAnthropicPayload(req, modelId, reasoningEffort));
  const { res } = await fetchUpstreamWithRetry(url, {
    method: 'POST',
    headers,
    body: bodyStr,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    yield {
      type: 'error',
      statusCode: res.status,
      message: `Upstream Anthropic error (${res.status}): ${errText.slice(0, 400)}`,
    };
    return;
  }

  const activeTools = new Map<
    number,
    { id: string; name: string; jsonBuf: string; thoughtSignature?: string }
  >();
  let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' = 'end_turn';

  for await (const frame of parseSseLines(res.body)) {
    if (frame.data === '[DONE]') break;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(frame.data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const evType = String(payload.type ?? frame.event);
    if (evType === 'message_start') {
      const msg = payload.message as
        | {
            id?: string;
            usage?: {
              input_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          }
        | undefined;
      yield { type: 'start', model: modelId, messageId: msg?.id ?? '' };
      if (msg?.usage) {
        const cached = msg.usage.cache_read_input_tokens ?? 0;
        const created = msg.usage.cache_creation_input_tokens ?? 0;
        const totalInput = (msg.usage.input_tokens ?? 0) + cached + created;
        if (totalInput > 0) {
          yield {
            type: 'usage',
            inputTokens: totalInput,
            outputTokens: 0,
            ...(cached > 0 ? { cachedInputTokens: cached } : {}),
            ...(created > 0 ? { cacheCreationInputTokens: created } : {}),
          };
        }
      }
    } else if (evType === 'content_block_start') {
      const idx = Number(payload.index ?? 0);
      const cb = payload.content_block as Record<string, unknown> | undefined;
      if (cb?.type === 'tool_use') {
        const id = String(cb.id ?? `call_${idx}`);
        const name = String(cb.name ?? '');
        activeTools.set(idx, { id, name, jsonBuf: '' });
        yield { type: 'tool_call_start', id, name };
      }
    } else if (evType === 'content_block_delta') {
      const idx = Number(payload.index ?? 0);
      const delta = payload.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        yield { type: 'text_delta', text: delta.text };
      } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        yield { type: 'thinking_delta', thinking: delta.thinking };
      } else if (delta?.type === 'signature_delta' && typeof delta.signature === 'string') {
        yield { type: 'thinking_signature_delta', signature: delta.signature };
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const tool = activeTools.get(idx);
        if (tool) {
          tool.jsonBuf += delta.partial_json;
          yield { type: 'tool_call_delta', id: tool.id, partialJson: delta.partial_json };
        }
      }
    } else if (evType === 'content_block_stop') {
      const idx = Number(payload.index ?? 0);
      const tool = activeTools.get(idx);
      if (tool) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = tool.jsonBuf ? (JSON.parse(tool.jsonBuf) as Record<string, unknown>) : {};
        } catch {
          parsed = {};
        }
        yield {
          type: 'tool_call_end',
          id: tool.id,
          name: tool.name,
          input: parsed,
          rawJson: tool.jsonBuf,
        };
        activeTools.delete(idx);
      }
    } else if (evType === 'message_delta') {
      const delta = payload.delta as { stop_reason?: string } | undefined;
      if (delta?.stop_reason === 'tool_use') stopReason = 'tool_use';
      else if (delta?.stop_reason === 'max_tokens') stopReason = 'max_tokens';
      else if (delta?.stop_reason === 'stop_sequence') stopReason = 'stop_sequence';
      const usage = payload.usage as
        | {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          }
        | undefined;
      if (usage) {
        const cached = usage.cache_read_input_tokens ?? 0;
        const created = usage.cache_creation_input_tokens ?? 0;
        const totalInput = (usage.input_tokens ?? 0) + cached + created;
        yield {
          type: 'usage',
          inputTokens: totalInput,
          outputTokens: usage.output_tokens ?? 0,
          ...(cached > 0 ? { cachedInputTokens: cached } : {}),
          ...(created > 0 ? { cacheCreationInputTokens: created } : {}),
        };
      }
    } else if (evType === 'error') {
      const err = payload.error as { message?: string } | undefined;
      yield { type: 'error', message: err?.message ?? 'Anthropic stream error' };
      return;
    }
  }

  yield { type: 'done', stopReason };
}

async function* streamOpenAIUpstream(
  provider: ProviderConfig,
  modelId: string,
  req: CanonicalRequest,
  reasoningEffort?: ReasoningEffort,
): AsyncGenerator<CanonicalStreamEvent> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(provider.defaultHeaders ?? {}),
  };

  if (provider.apiKey) {
    headers['authorization'] = `Bearer ${provider.apiKey}`;
  } else if (req.rawHeaders['authorization'] && /^bearer\s+sk-/i.test(req.rawHeaders['authorization'])) {
    headers['authorization'] = req.rawHeaders['authorization'];
  }

  const url = joinUrl(provider.baseUrl, '/chat/completions');
  const bodyStr = JSON.stringify(toOpenAIChatPayload(req, modelId, provider, reasoningEffort));
  const { res } = await fetchUpstreamWithRetry(url, {
    method: 'POST',
    headers,
    body: bodyStr,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    yield {
      type: 'error',
      statusCode: res.status,
      message: `Upstream OpenAI-compat error (${res.status}): ${errText.slice(0, 400)}`,
    };
    return;
  }

  yield { type: 'start', model: modelId, messageId: '' };

  const activeTools = new Map<
    number,
    { id: string; name: string; jsonBuf: string; thoughtSignature?: string }
  >();
  let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' = 'end_turn';

  for await (const frame of parseSseLines(res.body)) {
    if (frame.data === '[DONE]') break;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(frame.data) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (payload.usage && typeof payload.usage === 'object') {
      const u = payload.usage as {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        prompt_cache_hit_tokens?: number;
      };
      const cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
      yield {
        type: 'usage',
        inputTokens: u.prompt_tokens ?? 0,
        outputTokens: u.completion_tokens ?? 0,
        ...(cached > 0 ? { cachedInputTokens: cached } : {}),
      };
    }

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const choice = choices[0] as Record<string, unknown> | undefined;
    if (!choice) continue;

    if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
    else if (choice.finish_reason === 'length') stopReason = 'max_tokens';

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) continue;

    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      yield { type: 'thinking_delta', thinking: delta.reasoning_content };
    }
    if (typeof delta.content === 'string' && delta.content) {
      yield { type: 'text_delta', text: delta.content };
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (!tc || typeof tc !== 'object') continue;
        const tco = tc as {
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
          extra_content?: { google?: { thought_signature?: string } };
        };
        const idx = tco.index ?? 0;
        const chunkThoughtSig =
          typeof tco.extra_content?.google?.thought_signature === 'string'
            ? tco.extra_content.google.thought_signature
            : undefined;
        let existing = activeTools.get(idx);
        if (!existing) {
          existing = {
            id: tco.id || `call_${Date.now().toString(36)}_${idx}`,
            name: tco.function?.name || '',
            jsonBuf: '',
            ...(chunkThoughtSig ? { thoughtSignature: chunkThoughtSig } : {}),
          };
          activeTools.set(idx, existing);
          yield {
            type: 'tool_call_start',
            id: existing.id,
            name: existing.name,
            ...(existing.thoughtSignature ? { thoughtSignature: existing.thoughtSignature } : {}),
          };
        }
        if (chunkThoughtSig && !existing.thoughtSignature) {
          existing.thoughtSignature = chunkThoughtSig;
        }
        if (tco.function?.name && !existing.name) {
          existing.name = tco.function.name;
        }
        if (typeof tco.function?.arguments === 'string' && tco.function.arguments) {
          existing.jsonBuf += tco.function.arguments;
          yield {
            type: 'tool_call_delta',
            id: existing.id,
            partialJson: tco.function.arguments,
          };
        }
      }
    }
  }

  for (const [, tool] of activeTools) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = tool.jsonBuf ? (JSON.parse(tool.jsonBuf) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }
    yield {
      type: 'tool_call_end',
      id: tool.id,
      name: tool.name,
      input: parsed,
      rawJson: tool.jsonBuf,
      ...(tool.thoughtSignature ? { thoughtSignature: tool.thoughtSignature } : {}),
    };
  }

  if (activeTools.size > 0) stopReason = 'tool_use';
  yield { type: 'done', stopReason };
}

function toOpenAIResponsesPayload(
  req: CanonicalRequest,
  modelId: string,
  reasoningEffort?: ReasoningEffort,
) {
  const instructions = req.systemParts.map((s) => s.text).join('\n\n').trim();
  const input: Array<Record<string, unknown>> = [];

  for (const m of req.messages) {
    if (m.role === 'user') {
      const toolResults = m.parts.filter((p) => p.type === 'tool_result');
      const textParts = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

      for (const tr of toolResults) {
        input.push({
          type: 'function_call_output',
          call_id: normalizeResponsesCallId(tr.toolUseId),
          output: tr.isError ? `[ERROR] ${tr.content}` : tr.content,
        });
      }
      if (textParts || toolResults.length === 0) {
        input.push({ role: 'user', content: textParts });
      }
    } else {
      const textParts = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      const toolUses = m.parts.filter((p) => p.type === 'tool_use');

      if (textParts) {
        input.push({ role: 'assistant', content: textParts });
      }
      for (const tu of toolUses) {
        input.push({
          type: 'function_call',
          call_id: normalizeResponsesCallId(tu.id),
          name: tu.name,
          arguments: JSON.stringify(tu.input),
        });
      }
    }
  }

  const tools = req.tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description ?? '',
    parameters: t.inputSchema,
    strict: false,
  }));

  const mappedEffort =
    reasoningEffort && reasoningEffort !== 'default'
      ? /gpt-6/i.test(modelId)
        ? reasoningEffort
        : reasoningEffort === 'xhigh'
          ? 'high'
          : reasoningEffort
      : undefined;

  const omitTemperature = Boolean(mappedEffort) || isOpenAIReasoningModel(modelId);

  return {
    model: modelId,
    ...(instructions ? { instructions } : {}),
    input,
    ...(tools.length > 0 ? { tools } : {}),
    ...(mappedEffort ? { reasoning: { effort: mappedEffort } } : {}),
    ...(req.maxTokens ? { max_output_tokens: req.maxTokens } : {}),
    ...(req.promptCacheKey ? { prompt_cache_key: req.promptCacheKey } : {}),
    ...(!omitTemperature && req.temperature !== undefined
      ? { temperature: req.temperature }
      : {}),
    stream: true,
    store: false,
  };
}

async function* streamOpenAIResponsesUpstream(
  provider: ProviderConfig,
  modelId: string,
  req: CanonicalRequest,
  reasoningEffort?: ReasoningEffort,
): AsyncGenerator<CanonicalStreamEvent> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...(provider.defaultHeaders ?? {}),
  };

  if (provider.apiKey) {
    headers['authorization'] = `Bearer ${provider.apiKey}`;
  } else if (req.rawHeaders['authorization'] && /^bearer\s+sk-/i.test(req.rawHeaders['authorization'])) {
    headers['authorization'] = req.rawHeaders['authorization'];
  }

  const url = joinUrl(provider.baseUrl, '/responses');
  const bodyStr = JSON.stringify(toOpenAIResponsesPayload(req, modelId, reasoningEffort));

  for (let streamAttempt = 0; streamAttempt <= MAX_RATE_LIMIT_RETRIES; streamAttempt++) {
    const { res } = await fetchUpstreamWithRetry(url, {
      method: 'POST',
      headers,
      body: bodyStr,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText);
      yield {
        type: 'error',
        statusCode: res.status,
        message: `Upstream Responses error (${res.status}): ${errText.slice(0, 400)}`,
      };
      return;
    }

    const activeTools = new Map<number, { id: string; name: string; jsonBuf: string }>();
    let sawToolCall = false;
    let emittedOutput = false;
    let shouldRetryStream = false;

    for await (const frame of parseSseLines(res.body)) {
      if (frame.data === '[DONE]') break;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(frame.data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const evType = String(payload.type ?? frame.event);

      if (evType === 'response.created') {
        const resp = payload.response as { id?: string } | undefined;
        yield { type: 'start', model: modelId, messageId: resp?.id ?? '' };
      } else if (evType === 'response.output_text.delta' && typeof payload.delta === 'string') {
        emittedOutput = true;
        yield { type: 'text_delta', text: payload.delta };
      } else if (
        evType === 'response.reasoning_summary_text.delta' &&
        typeof payload.delta === 'string'
      ) {
        emittedOutput = true;
        yield { type: 'thinking_delta', thinking: payload.delta };
      } else if (evType === 'response.output_item.added') {
        const idx = Number(payload.output_index ?? 0);
        const item = payload.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call') {
          emittedOutput = true;
          const id = String(item.call_id ?? item.id ?? `call_${idx}`);
          const name = String(item.name ?? '');
          activeTools.set(idx, { id, name, jsonBuf: '' });
          sawToolCall = true;
          yield { type: 'tool_call_start', id, name };
        }
      } else if (
        evType === 'response.function_call_arguments.delta' &&
        typeof payload.delta === 'string'
      ) {
        const idx = Number(payload.output_index ?? 0);
        const tool = activeTools.get(idx);
        if (tool) {
          tool.jsonBuf += payload.delta;
          yield { type: 'tool_call_delta', id: tool.id, partialJson: payload.delta };
        }
      } else if (evType === 'response.output_item.done') {
        const idx = Number(payload.output_index ?? 0);
        const item = payload.item as Record<string, unknown> | undefined;
        const tool = activeTools.get(idx);
        if (item?.type === 'function_call' && tool) {
          const rawJson =
            typeof item.arguments === 'string' && item.arguments.length > 0
              ? item.arguments
              : tool.jsonBuf;
          let parsed: Record<string, unknown> = {};
          try {
            parsed = rawJson ? (JSON.parse(rawJson) as Record<string, unknown>) : {};
          } catch {
            parsed = {};
          }
          yield {
            type: 'tool_call_end',
            id: tool.id,
            name: tool.name,
            input: parsed,
            rawJson,
          };
          activeTools.delete(idx);
        }
      } else if (evType === 'response.completed' || evType === 'response.incomplete') {
        const resp = payload.response as
          | {
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                input_tokens_details?: { cached_tokens?: number };
              };
            }
          | undefined;
        if (resp?.usage) {
          const cached = resp.usage.input_tokens_details?.cached_tokens ?? 0;
          yield {
            type: 'usage',
            inputTokens: resp.usage.input_tokens ?? 0,
            outputTokens: resp.usage.output_tokens ?? 0,
            ...(cached > 0 ? { cachedInputTokens: cached } : {}),
          };
        }
      } else if (evType === 'error' || evType === 'response.failed') {
        const errObj =
          (payload.error as { message?: string; code?: string } | undefined) ??
          ((payload.response as { error?: { message?: string; code?: string } } | undefined)?.error);
        const errMsg = errObj?.message ?? 'OpenAI Responses stream error';
        const isRl =
          !emittedOutput &&
          streamAttempt < MAX_RATE_LIMIT_RETRIES &&
          (errObj?.code === 'rate_limit_exceeded' || isRateLimitErrorMessage(errMsg));
        if (isRl) {
          const delayMs = parseRetryDelayMs(res.headers, errMsg, streamAttempt);
          yield { type: 'ping' };
          await sleepMs(delayMs);
          shouldRetryStream = true;
          break;
        }
        yield {
          type: 'error',
          message: errMsg,
        };
        return;
      }
    }

    if (shouldRetryStream) {
      continue;
    }

    yield { type: 'done', stopReason: sawToolCall ? 'tool_use' : 'end_turn' };
    return;
  }
}

export async function* streamUpstreamTurn(
  provider: ProviderConfig,
  modelId: string,
  req: CanonicalRequest,
  _phase: Phase,
  reasoningEffort?: ReasoningEffort,
): AsyncGenerator<CanonicalStreamEvent> {
  if (provider.type === 'anthropic') {
    yield* streamAnthropicUpstream(provider, modelId, req, reasoningEffort);
    return;
  }

  if (shouldUseOpenAIResponsesUpstream(provider)) {
    yield* streamOpenAIResponsesUpstream(provider, modelId, req, reasoningEffort);
    return;
  }

  yield* streamOpenAIUpstream(provider, modelId, req, reasoningEffort);
}

export async function testProviderConnection(
  provider: ProviderConfig,
  modelId: string,
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const started = Date.now();
  if (!provider.apiKey && !provider.baseUrl.includes('127.0.0.1') && !provider.baseUrl.includes('localhost')) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: '请先填写官方 API Key 再测试连通性',
    };
  }

  const testReq: CanonicalRequest = {
    protocol: shouldUseOpenAIResponsesUpstream(provider) ? 'openai-responses' : 'openai-chat',
    requestedModel: modelId,
    systemParts: [],
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Reply with OK only.' }] }],
    tools: [],
    maxTokens: 128,
    stream: true,
    rawHeaders: {},
  };

  try {
    let gotText = false;
    for await (const ev of streamUpstreamTurn(provider, modelId, testReq, 'PLANNING')) {
      if (ev.type === 'error') {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          message: ev.message,
        };
      }
      if (ev.type === 'text_delta' || ev.type === 'done') {
        gotText = true;
      }
    }
    return {
      ok: gotText,
      latencyMs: Date.now() - started,
      message: gotText ? `连接成功 (${modelId})` : '未收到模型响应',
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
