import type {
  CanonicalContentPart,
  CanonicalMessage,
  CanonicalSystemPart,
} from './normalized.js';
import type { ProviderType } from '../types.js';

/**
 * Strips or downgrades foreign `thinking` / `redacted_thinking` blocks when
 * switching models or providers so upstream APIs never reject stale signatures.
 */
export function sanitizeMessagesForTarget(
  messages: CanonicalMessage[],
  targetModelId: string,
  targetProviderType: ProviderType,
  lastAssistantModel: string | null,
): CanonicalMessage[] {
  const sameModel = lastAssistantModel !== null && lastAssistantModel === targetModelId;
  const allowThinkingBlocks = sameModel && targetProviderType === 'anthropic';
  const allowPlainThinkingForDeepSeek =
    targetProviderType === 'openai-compat' && /deepseek/i.test(targetModelId);

  return messages.map((msg) => {
    if (msg.role !== 'assistant') {
      return msg;
    }

    const sanitizedParts: CanonicalContentPart[] = [];
    for (const part of msg.parts) {
      if (part.type === 'thinking') {
        if (allowThinkingBlocks && part.signature?.trim()) {
          sanitizedParts.push(part);
        } else if (allowPlainThinkingForDeepSeek && part.thinking.trim()) {
          sanitizedParts.push({ type: 'thinking', thinking: part.thinking });
        } else if (part.thinking.trim()) {
          // Drop cryptographic signature; optionally skip or keep summary only if needed.
          // Dropping raw thinking blocks avoids Anthropic 400 signature mismatches and OpenAI errors.
          continue;
        }
      } else if (part.type === 'redacted_thinking') {
        if (allowThinkingBlocks) {
          sanitizedParts.push(part);
        }
      } else {
        sanitizedParts.push(part);
      }
    }

    // Ensure assistant messages always have at least one non-empty part if tool_use was absent
    if (sanitizedParts.length === 0) {
      sanitizedParts.push({ type: 'text', text: '[continuing]' });
    }

    return {
      ...msg,
      parts: sanitizedParts,
    };
  });
}

/**
 * Appends orchestrator instructions AFTER any existing cached system prefix blocks
 * so Anthropic / OpenAI prompt prefix caches remain intact.
 */
export function appendSystemAddendumPreservingCache(
  systemParts: CanonicalSystemPart[],
  addendum: string,
): CanonicalSystemPart[] {
  return [
    ...systemParts,
    {
      type: 'text',
      text: addendum,
    },
  ];
}
