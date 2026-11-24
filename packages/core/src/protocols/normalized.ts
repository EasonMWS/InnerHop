export interface CanonicalTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export type CanonicalContentPart =
  | { type: 'text'; text: string; cacheControl?: unknown }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
      thoughtSignature?: string;
    }
  | {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      isError?: boolean;
    }
  | { type: 'image'; source: unknown };

export interface CanonicalMessage {
  role: 'user' | 'assistant';
  parts: CanonicalContentPart[];
  /** Optional originating model tracked internally by proxy */
  originModel?: string;
}

export interface CanonicalSystemPart {
  type: 'text';
  text: string;
  cacheControl?: unknown;
}

export interface CanonicalRequest {
  protocol: 'anthropic' | 'openai-chat' | 'openai-responses';
  requestedModel: string;
  systemParts: CanonicalSystemPart[];
  messages: CanonicalMessage[];
  tools: CanonicalTool[];
  maxTokens?: number;
  temperature?: number;
  stream: boolean;
  /** Preserved raw fields (like metadata, thinking budget) for passthrough */
  rawHeaders: Record<string, string>;
  metadataUserId?: string;
  promptCacheKey?: string;
  stopSequences?: string[];
}

export type CanonicalStreamEvent =
  | { type: 'start'; model: string; messageId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'thinking_signature_delta'; signature: string }
  | { type: 'tool_call_start'; id: string; name: string; thoughtSignature?: string }
  | { type: 'tool_call_delta'; id: string; partialJson: string }
  | {
      type: 'tool_call_end';
      id: string;
      name: string;
      input: Record<string, unknown>;
      rawJson: string;
      thoughtSignature?: string;
    }
  | { type: 'ping' }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' }
  | { type: 'error'; message: string; statusCode?: number };
