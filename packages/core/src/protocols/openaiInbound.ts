import type {
  CanonicalContentPart,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalStreamEvent,
  CanonicalSystemPart,
  CanonicalTool,
} from './normalized.js';
import type { StreamResponseSink } from './anthropicInbound.js';

export function parseOpenAIChatRequest(
  body: Record<string, unknown>,
  rawHeaders: Record<string, string>,
): CanonicalRequest {
  const systemParts: CanonicalSystemPart[] = [];
  const messages: CanonicalMessage[] = [];
  const rawMsgs = Array.isArray(body.messages) ? body.messages : [];

  for (const rawMsg of rawMsgs) {
    if (!rawMsg || typeof rawMsg !== 'object') continue;
    const m = rawMsg as Record<string, unknown>;
    const role = String(m.role ?? 'user');

    if (role === 'system' || role === 'developer') {
      const txt =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
                .join('\n')
            : '';
      if (txt.trim()) systemParts.push({ type: 'text', text: txt });
      continue;
    }

    if (role === 'tool') {
      const part: CanonicalContentPart = {
        type: 'tool_result',
        toolUseId: String(m.tool_call_id ?? ''),
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
        isError: false,
      };
      const prev = messages[messages.length - 1];
      if (prev && prev.role === 'user' && prev.parts.every((p) => p.type === 'tool_result')) {
        prev.parts.push(part);
      } else {
        messages.push({ role: 'user', parts: [part] });
      }
      continue;
    }

    if (role === 'assistant') {
      const parts: CanonicalContentPart[] = [];
      if (typeof m.reasoning_content === 'string' && m.reasoning_content.trim()) {
        parts.push({ type: 'thinking', thinking: m.reasoning_content });
      }
      if (typeof m.content === 'string' && m.content) {
        parts.push({ type: 'text', text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const item of m.content) {
          if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
            parts.push({ type: 'text', text: (item as { text: string }).text });
          }
        }
      }
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (!tc || typeof tc !== 'object') continue;
          const tco = tc as {
            id?: unknown;
            function?: { name?: unknown; arguments?: unknown };
            extra_content?: { google?: { thought_signature?: unknown } };
          };
          let parsedInput: Record<string, unknown> = {};
          if (typeof tco.function?.arguments === 'string') {
            try {
              parsedInput = JSON.parse(tco.function.arguments) as Record<string, unknown>;
            } catch {
              parsedInput = {};
            }
          }
          const thoughtSignature =
            typeof tco.extra_content?.google?.thought_signature === 'string'
              ? tco.extra_content.google.thought_signature
              : undefined;
          parts.push({
            type: 'tool_use',
            id: String(tco.id ?? ''),
            name: String(tco.function?.name ?? ''),
            input: parsedInput,
            ...(thoughtSignature ? { thoughtSignature } : {}),
          });
        }
      }
      messages.push({ role: 'assistant', parts });
      continue;
    }

    // user
    const userParts: CanonicalContentPart[] = [];
    if (typeof m.content === 'string') {
      userParts.push({ type: 'text', text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const item of m.content) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        if (obj.type === 'text' && typeof obj.text === 'string') {
          userParts.push({ type: 'text', text: obj.text });
        } else if (obj.type === 'image_url') {
          userParts.push({ type: 'image', source: obj.image_url });
        }
      }
    }
    messages.push({ role: 'user', parts: userParts });
  }

  const tools: CanonicalTool[] = [];
  if (Array.isArray(body.tools)) {
    for (const rawTool of body.tools) {
      if (!rawTool || typeof rawTool !== 'object') continue;
      const t = rawTool as Record<string, unknown>;
      const fn = t.function as Record<string, unknown> | undefined;
      if (t.type === 'function' && fn && typeof fn.name === 'string') {
        tools.push({
          name: fn.name,
          description: typeof fn.description === 'string' ? fn.description : undefined,
          inputSchema:
            fn.parameters && typeof fn.parameters === 'object'
              ? (fn.parameters as Record<string, unknown>)
              : { type: 'object', properties: {} },
        });
      }
    }
  }

  return {
    protocol: 'openai-chat',
    requestedModel: typeof body.model === 'string' ? body.model : 'orchestrator',
    systemParts,
    messages,
    tools,
    maxTokens:
      typeof body.max_completion_tokens === 'number'
        ? body.max_completion_tokens
        : typeof body.max_tokens === 'number'
          ? body.max_tokens
          : undefined,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    stream: body.stream === true,
    rawHeaders,
    promptCacheKey:
      typeof body.prompt_cache_key === 'string' ? body.prompt_cache_key : undefined,
  };
}

export function createOpenAIChatSseSink(
  enqueue: (chunk: string) => void,
  requestedModel: string,
): StreamResponseSink {
  const id = `chatcmpl_orch_${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  let closed = false;
  let toolIndex = -1;
  let finishReason: string = 'stop';
  let inputTokens = 0;
  let outputTokens = 0;

  const sendChunk = (delta: Record<string, unknown>, finish: string | null = null, usage?: unknown) => {
    const payload: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created,
      model: requestedModel,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    if (usage) payload.usage = usage;
    enqueue(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let sentRole = false;

  return {
    emit(event: CanonicalStreamEvent) {
      if (closed) return;
      if (!sentRole && event.type !== 'ping') {
        sentRole = true;
        sendChunk({ role: 'assistant' });
      }
      switch (event.type) {
        case 'text_delta':
          sendChunk({ content: event.text });
          break;
        case 'thinking_delta':
          sendChunk({ reasoning_content: event.thinking });
          break;
        case 'tool_call_start':
          toolIndex += 1;
          sendChunk({
            tool_calls: [
              {
                index: toolIndex,
                id: event.id,
                type: 'function',
                function: { name: event.name, arguments: '' },
                ...(event.thoughtSignature
                  ? { extra_content: { google: { thought_signature: event.thoughtSignature } } }
                  : {}),
              },
            ],
          });
          break;
        case 'tool_call_delta':
          sendChunk({
            tool_calls: [
              {
                index: Math.max(0, toolIndex),
                function: { arguments: event.partialJson },
              },
            ],
          });
          break;
        case 'ping':
          enqueue(': ping\n\n');
          break;
        case 'usage':
          inputTokens += event.inputTokens;
          outputTokens += event.outputTokens;
          break;
        case 'done':
          finishReason = event.stopReason === 'tool_use' ? 'tool_calls' : 'stop';
          break;
        case 'error':
          enqueue(`data: ${JSON.stringify({ error: { message: event.message } })}\n\n`);
          break;
      }
    },
    close() {
      if (closed) return;
      sendChunk({}, finishReason, {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      });
      enqueue('data: [DONE]\n\n');
      closed = true;
    },
  };
}

export function buildOpenAIChatJsonResponse(
  events: CanonicalStreamEvent[],
  requestedModel: string,
): Record<string, unknown> {
  let content = '';
  let reasoningContent = '';
  const toolCalls: Array<Record<string, unknown>> = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = 'stop';

  for (const ev of events) {
    if (ev.type === 'text_delta') content += ev.text;
    else if (ev.type === 'thinking_delta') reasoningContent += ev.thinking;
    else if (ev.type === 'tool_call_end') {
      toolCalls.push({
        id: ev.id,
        type: 'function',
        function: { name: ev.name, arguments: JSON.stringify(ev.input) },
        ...(ev.thoughtSignature
          ? { extra_content: { google: { thought_signature: ev.thoughtSignature } } }
          : {}),
      });
    } else if (ev.type === 'usage') {
      inputTokens += ev.inputTokens;
      outputTokens += ev.outputTokens;
    } else if (ev.type === 'done') {
      finishReason = ev.stopReason === 'tool_use' ? 'tool_calls' : 'stop';
    }
  }

  return {
    id: `chatcmpl_orch_${Date.now().toString(36)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content || null,
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

// --- OpenAI Responses API (/v1/responses) for Codex CLI ---

export function parseOpenAIResponsesRequest(
  body: Record<string, unknown>,
  rawHeaders: Record<string, string>,
): CanonicalRequest {
  const systemParts: CanonicalSystemPart[] = [];
  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    systemParts.push({ type: 'text', text: body.instructions });
  }

  const messages: CanonicalMessage[] = [];
  const input = body.input;

  if (typeof input === 'string') {
    messages.push({ role: 'user', parts: [{ type: 'text', text: input }] });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      if (obj.type === 'function_call') {
        let parsed: Record<string, unknown> = {};
        if (typeof obj.arguments === 'string') {
          try {
            parsed = JSON.parse(obj.arguments) as Record<string, unknown>;
          } catch {
            parsed = {};
          }
        }
        const tcPart: CanonicalContentPart = {
          type: 'tool_use',
          id: String(obj.call_id ?? obj.id ?? ''),
          name: String(obj.name ?? ''),
          input: parsed,
        };
        const prev = messages[messages.length - 1];
        if (prev && prev.role === 'assistant') {
          prev.parts.push(tcPart);
        } else {
          messages.push({ role: 'assistant', parts: [tcPart] });
        }
      } else if (obj.type === 'function_call_output') {
        const trPart: CanonicalContentPart = {
          type: 'tool_result',
          toolUseId: String(obj.call_id ?? ''),
          content: typeof obj.output === 'string' ? obj.output : JSON.stringify(obj.output ?? ''),
          isError: false,
        };
        const prev = messages[messages.length - 1];
        if (prev && prev.role === 'user' && prev.parts.every((p) => p.type === 'tool_result')) {
          prev.parts.push(trPart);
        } else {
          messages.push({ role: 'user', parts: [trPart] });
        }
      } else if (obj.role === 'system' || obj.role === 'developer') {
        const txt = typeof obj.content === 'string' ? obj.content : '';
        if (txt.trim()) systemParts.push({ type: 'text', text: txt });
      } else {
        const role = obj.role === 'assistant' ? 'assistant' : 'user';
        const parts: CanonicalContentPart[] = [];
        if (typeof obj.content === 'string') {
          parts.push({ type: 'text', text: obj.content });
        } else if (Array.isArray(obj.content)) {
          for (const c of obj.content) {
            if (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string') {
              parts.push({ type: 'text', text: (c as { text: string }).text });
            }
          }
        }
        if (parts.length > 0) messages.push({ role, parts });
      }
    }
  }

  const tools: CanonicalTool[] = [];
  if (Array.isArray(body.tools)) {
    for (const rawTool of body.tools) {
      if (!rawTool || typeof rawTool !== 'object') continue;
      const t = rawTool as Record<string, unknown>;
      if (t.type === 'function' && typeof t.name === 'string') {
        tools.push({
          name: t.name,
          description: typeof t.description === 'string' ? t.description : undefined,
          inputSchema:
            t.parameters && typeof t.parameters === 'object'
              ? (t.parameters as Record<string, unknown>)
              : { type: 'object', properties: {} },
        });
      }
    }
  }

  return {
    protocol: 'openai-responses',
    requestedModel: typeof body.model === 'string' ? body.model : 'orchestrator',
    systemParts,
    messages,
    tools,
    maxTokens: typeof body.max_output_tokens === 'number' ? body.max_output_tokens : undefined,
    temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
    stream: body.stream !== false,
    rawHeaders,
    promptCacheKey:
      typeof body.prompt_cache_key === 'string' ? body.prompt_cache_key : undefined,
  };
}

export function createOpenAIResponsesSseSink(
  enqueue: (chunk: string) => void,
  requestedModel: string,
): StreamResponseSink {
  const responseId = `resp_orch_${Date.now().toString(36)}`;
  let started = false;
  let closed = false;
  let outputIndex = -1;
  let currentMsgItemId: string | null = null;
  let currentText = '';
  const completedOutput: Array<Record<string, unknown>> = [];
  let inputTokens = 0;
  let outputTokens = 0;

  const sendEv = (type: string, data: Record<string, unknown>) => {
    enqueue(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  const ensureStarted = () => {
    if (started) return;
    started = true;
    sendEv('response.created', {
      response: {
        id: responseId,
        object: 'response',
        status: 'in_progress',
        model: requestedModel,
        output: [],
      },
    });
  };

  const closeMsgItem = () => {
    if (currentMsgItemId) {
      sendEv('response.output_text.done', {
        item_id: currentMsgItemId,
        output_index: outputIndex,
        content_index: 0,
        text: currentText,
      });
      const item = {
        id: currentMsgItemId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: currentText }],
      };
      sendEv('response.output_item.done', { output_index: outputIndex, item });
      completedOutput.push(item);
      currentMsgItemId = null;
      currentText = '';
    }
  };

  return {
    emit(event: CanonicalStreamEvent) {
      if (closed) return;
      ensureStarted();

      switch (event.type) {
        case 'text_delta':
          if (!currentMsgItemId) {
            outputIndex += 1;
            currentMsgItemId = `msg_${outputIndex}`;
            currentText = '';
            sendEv('response.output_item.added', {
              output_index: outputIndex,
              item: {
                id: currentMsgItemId,
                type: 'message',
                status: 'in_progress',
                role: 'assistant',
                content: [],
              },
            });
            sendEv('response.content_part.added', {
              item_id: currentMsgItemId,
              output_index: outputIndex,
              content_index: 0,
              part: { type: 'output_text', text: '' },
            });
          }
          currentText += event.text;
          sendEv('response.output_text.delta', {
            item_id: currentMsgItemId,
            output_index: outputIndex,
            content_index: 0,
            delta: event.text,
          });
          break;
        case 'tool_call_start':
          closeMsgItem();
          outputIndex += 1;
          sendEv('response.output_item.added', {
            output_index: outputIndex,
            item: {
              id: `fc_${event.id}`,
              type: 'function_call',
              status: 'in_progress',
              call_id: event.id,
              name: event.name,
              arguments: '',
            },
          });
          break;
        case 'tool_call_delta':
          sendEv('response.function_call_arguments.delta', {
            output_index: outputIndex,
            delta: event.partialJson,
          });
          break;
        case 'tool_call_end': {
          const argStr = JSON.stringify(event.input);
          sendEv('response.function_call_arguments.done', {
            output_index: outputIndex,
            arguments: argStr,
          });
          const item = {
            id: `fc_${event.id}`,
            type: 'function_call',
            status: 'completed',
            call_id: event.id,
            name: event.name,
            arguments: argStr,
          };
          sendEv('response.output_item.done', { output_index: outputIndex, item });
          completedOutput.push(item);
          break;
        }
        case 'ping':
          enqueue(': ping\n\n');
          break;
        case 'usage':
          inputTokens += event.inputTokens;
          outputTokens += event.outputTokens;
          break;
        case 'error':
          sendEv('error', { error: { message: event.message } });
          break;
      }
    },
    close() {
      if (closed) return;
      ensureStarted();
      closeMsgItem();
      sendEv('response.completed', {
        response: {
          id: responseId,
          object: 'response',
          status: 'completed',
          model: requestedModel,
          output: completedOutput,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          },
        },
      });
      closed = true;
    },
  };
}

export function buildOpenAIResponsesJsonResponse(
  events: CanonicalStreamEvent[],
  requestedModel: string,
): Record<string, unknown> {
  let text = '';
  const output: Array<Record<string, unknown>> = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const ev of events) {
    if (ev.type === 'text_delta') text += ev.text;
    else if (ev.type === 'tool_call_end') {
      output.push({
        id: `fc_${ev.id}`,
        type: 'function_call',
        status: 'completed',
        call_id: ev.id,
        name: ev.name,
        arguments: JSON.stringify(ev.input),
      });
    } else if (ev.type === 'usage') {
      inputTokens += ev.inputTokens;
      outputTokens += ev.outputTokens;
    }
  }
  if (text) {
    output.unshift({
      id: 'msg_0',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    });
  }

  return {
    id: `resp_orch_${Date.now().toString(36)}`,
    object: 'response',
    status: 'completed',
    model: requestedModel,
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}
