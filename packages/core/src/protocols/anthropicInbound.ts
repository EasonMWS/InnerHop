import type {
  CanonicalContentPart,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalStreamEvent,
  CanonicalSystemPart,
  CanonicalTool,
} from './normalized.js';

export function parseAnthropicRequest(
  body: Record<string, unknown>,
  rawHeaders: Record<string, string>,
): CanonicalRequest {
  const systemParts: CanonicalSystemPart[] = [];
  if (typeof body.system === 'string' && body.system.trim()) {
    systemParts.push({ type: 'text', text: body.system });
  } else if (Array.isArray(body.system)) {
    for (const item of body.system) {
      if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
        const obj = item as { text: string; cache_control?: unknown };
        systemParts.push({
          type: 'text',
          text: obj.text,
          cacheControl: obj.cache_control,
        });
      }
    }
  }

  const messages: CanonicalMessage[] = [];
  const rawMsgs = Array.isArray(body.messages) ? body.messages : [];
  for (const rawMsg of rawMsgs) {
    if (!rawMsg || typeof rawMsg !== 'object') continue;
    const m = rawMsg as { role?: unknown; content?: unknown };
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const parts: CanonicalContentPart[] = [];

    if (typeof m.content === 'string') {
      parts.push({ type: 'text', text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push({ type: 'text', text: b.text, cacheControl: b.cache_control });
        } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
          parts.push({
            type: 'thinking',
            thinking: b.thinking,
            signature: typeof b.signature === 'string' ? b.signature : undefined,
          });
        } else if (b.type === 'redacted_thinking' && typeof b.data === 'string') {
          parts.push({ type: 'redacted_thinking', data: b.data });
        } else if (b.type === 'tool_use') {
          parts.push({
            type: 'tool_use',
            id: String(b.id ?? ''),
            name: String(b.name ?? ''),
            input:
              b.input && typeof b.input === 'object'
                ? (b.input as Record<string, unknown>)
                : {},
          });
        } else if (b.type === 'tool_result') {
          let textContent = '';
          if (typeof b.content === 'string') {
            textContent = b.content;
          } else if (Array.isArray(b.content)) {
            textContent = b.content
              .map((c) => {
                if (typeof c === 'string') return c;
                if (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string') {
                  return (c as { text: string }).text;
                }
                return JSON.stringify(c);
              })
              .join('\n');
          } else if (b.content !== undefined) {
            textContent = JSON.stringify(b.content);
          }
          parts.push({
            type: 'tool_result',
            toolUseId: String(b.tool_use_id ?? ''),
            content: textContent,
            isError: b.is_error === true,
          });
        } else if (b.type === 'image') {
          parts.push({ type: 'image', source: b.source });
        }
      }
    }

    messages.push({ role, parts });
  }

  const tools: CanonicalTool[] = [];
  if (Array.isArray(body.tools)) {
    for (const rawTool of body.tools) {
      if (!rawTool || typeof rawTool !== 'object') continue;
      const t = rawTool as Record<string, unknown>;
      if (typeof t.name !== 'string') continue;
      tools.push({
        name: t.name,
        description: typeof t.description === 'string' ? t.description : undefined,
        inputSchema:
          t.input_schema && typeof t.input_schema === 'object'
            ? (t.input_schema as Record<string, unknown>)
            : { type: 'object', properties: {} },
      });
    }
  }

  const metadata =
    body.metadata && typeof body.metadata === 'object'
      ? (body.metadata as Record<string, unknown>)
      : undefined;

  return {
    protocol: 'anthropic',
    requestedModel: typeof body.model === 'string' ? body.model : 'orchestrator',
    systemParts,
    messages,
    tools,
    maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : 8192,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    stream: body.stream !== false,
    rawHeaders,
    metadataUserId: typeof metadata?.user_id === 'string' ? metadata.user_id : undefined,
    stopSequences: Array.isArray(body.stop_sequences)
      ? body.stop_sequences.filter((s): s is string => typeof s === 'string')
      : undefined,
  };
}

export interface StreamResponseSink {
  emit(event: CanonicalStreamEvent): void;
  close(): void;
}

export function createAnthropicSseSink(
  enqueue: (chunk: string) => void,
  requestedModel: string,
): StreamResponseSink {
  let started = false;
  let closed = false;
  let nextBlockIndex = 0;
  let activeBlockType: 'text' | 'thinking' | 'tool_use' | null = null;
  let activeBlockIndex = -1;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastStopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' = 'end_turn';
  const messageId = `msg_orch_${Date.now().toString(36)}`;

  const sendSse = (eventName: string, data: unknown) => {
    enqueue(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const ensureStarted = () => {
    if (started) return;
    started = true;
    sendSse('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: requestedModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  };

  const closeActiveBlock = () => {
    if (activeBlockType !== null && activeBlockIndex >= 0) {
      sendSse('content_block_stop', {
        type: 'content_block_stop',
        index: activeBlockIndex,
      });
      activeBlockType = null;
      activeBlockIndex = -1;
    }
  };

  return {
    emit(event: CanonicalStreamEvent) {
      if (closed) return;
      ensureStarted();

      switch (event.type) {
        case 'start':
          break;
        case 'ping':
          closeActiveBlock();
          sendSse('ping', { type: 'ping' });
          break;
        case 'thinking_delta':
          if (activeBlockType !== 'thinking') {
            closeActiveBlock();
            activeBlockIndex = nextBlockIndex++;
            activeBlockType = 'thinking';
            sendSse('content_block_start', {
              type: 'content_block_start',
              index: activeBlockIndex,
              content_block: { type: 'thinking', thinking: '' },
            });
          }
          sendSse('content_block_delta', {
            type: 'content_block_delta',
            index: activeBlockIndex,
            delta: { type: 'thinking_delta', thinking: event.thinking },
          });
          break;
        case 'thinking_signature_delta':
          if (activeBlockType === 'thinking') {
            sendSse('content_block_delta', {
              type: 'content_block_delta',
              index: activeBlockIndex,
              delta: { type: 'signature_delta', signature: event.signature },
            });
          }
          break;
        case 'text_delta':
          if (activeBlockType !== 'text') {
            closeActiveBlock();
            activeBlockIndex = nextBlockIndex++;
            activeBlockType = 'text';
            sendSse('content_block_start', {
              type: 'content_block_start',
              index: activeBlockIndex,
              content_block: { type: 'text', text: '' },
            });
          }
          sendSse('content_block_delta', {
            type: 'content_block_delta',
            index: activeBlockIndex,
            delta: { type: 'text_delta', text: event.text },
          });
          break;
        case 'tool_call_start':
          closeActiveBlock();
          activeBlockIndex = nextBlockIndex++;
          activeBlockType = 'tool_use';
          sendSse('content_block_start', {
            type: 'content_block_start',
            index: activeBlockIndex,
            content_block: {
              type: 'tool_use',
              id: event.id,
              name: event.name,
              input: {},
            },
          });
          break;
        case 'tool_call_delta':
          if (activeBlockType === 'tool_use') {
            sendSse('content_block_delta', {
              type: 'content_block_delta',
              index: activeBlockIndex,
              delta: { type: 'input_json_delta', partial_json: event.partialJson },
            });
          }
          break;
        case 'tool_call_end':
          if (activeBlockType === 'tool_use') {
            closeActiveBlock();
          }
          break;
        case 'usage':
          totalInputTokens += event.inputTokens;
          totalOutputTokens += event.outputTokens;
          break;
        case 'done':
          lastStopReason = event.stopReason;
          break;
        case 'error':
          closeActiveBlock();
          sendSse('error', {
            type: 'error',
            error: { type: 'api_error', message: event.message },
          });
          break;
      }
    },
    close() {
      if (closed) return;
      ensureStarted();
      closeActiveBlock();
      sendSse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: lastStopReason, stop_sequence: null },
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
        },
      });
      sendSse('message_stop', { type: 'message_stop' });
      closed = true;
    },
  };
}

export function buildAnthropicJsonResponse(
  events: CanonicalStreamEvent[],
  requestedModel: string,
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  let currentThinking = '';
  let thinkingSignature = '';
  let currentText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string = 'end_turn';

  const flushThinking = () => {
    if (currentThinking) {
      content.push({
        type: 'thinking',
        thinking: currentThinking,
        ...(thinkingSignature ? { signature: thinkingSignature } : {}),
      });
      currentThinking = '';
      thinkingSignature = '';
    }
  };

  const flushText = () => {
    if (currentText) {
      content.push({ type: 'text', text: currentText });
      currentText = '';
    }
  };

  for (const ev of events) {
    if (ev.type === 'thinking_delta') {
      currentThinking += ev.thinking;
    } else if (ev.type === 'thinking_signature_delta') {
      thinkingSignature += ev.signature;
    } else if (ev.type === 'text_delta') {
      flushThinking();
      currentText += ev.text;
    } else if (ev.type === 'tool_call_end') {
      flushThinking();
      flushText();
      content.push({
        type: 'tool_use',
        id: ev.id,
        name: ev.name,
        input: ev.input,
      });
    } else if (ev.type === 'usage') {
      inputTokens += ev.inputTokens;
      outputTokens += ev.outputTokens;
    } else if (ev.type === 'done') {
      stopReason = ev.stopReason;
    }
  }
  flushThinking();
  flushText();

  return {
    id: `msg_orch_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}
