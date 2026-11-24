import type { RoutingConfig } from '../types.js';

export type BypassProtocol = 'anthropic' | 'openai-chat' | 'openai-responses';

const FORWARD_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'authorization',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'originator',
  'openai-organization',
  'openai-project',
  'user-agent',
];

const SAFE_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'x-request-id',
  'request-id',
  'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-tokens-remaining',
  'openai-processing-ms',
];

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function resolveBypassTargetUrl(
  protocol: BypassProtocol,
  _inboundHeaders: Record<string, string>,
  routing: RoutingConfig,
): string {
  if (protocol === 'anthropic') {
    return `${trimSlash(routing.bypassAnthropicBaseUrl || 'https://api.anthropic.com')}/v1/messages`;
  }
  if (protocol === 'openai-chat') {
    return `${trimSlash(routing.bypassOpenAIBaseUrl || 'https://api.openai.com/v1')}/chat/completions`;
  }
  return `${trimSlash(routing.bypassOpenAIBaseUrl || 'https://api.openai.com/v1')}/responses`;
}

export async function forwardBypassRequest(
  protocol: BypassProtocol,
  rawBodyText: string,
  inboundHeaders: Record<string, string>,
  routing: RoutingConfig,
): Promise<Response> {
  const targetUrl = resolveBypassTargetUrl(protocol, inboundHeaders, routing);

  const outHeaders: Record<string, string> = {};
  for (const h of FORWARD_REQUEST_HEADERS) {
    if (inboundHeaders[h]) {
      outHeaders[h] = inboundHeaders[h];
    }
  }
  if (!outHeaders['content-type']) {
    outHeaders['content-type'] = 'application/json';
  }

  const upstreamRes = await fetch(targetUrl, {
    method: 'POST',
    headers: outHeaders,
    body: rawBodyText,
  });

  const resHeaders = new Headers();
  for (const h of SAFE_RESPONSE_HEADERS) {
    const val = upstreamRes.headers.get(h);
    if (val !== null) resHeaders.set(h, val);
  }
  upstreamRes.headers.forEach((val, key) => {
    if (key.startsWith('x-ratelimit-') || key.startsWith('anthropic-')) {
      resHeaders.set(key, val);
    }
  });
  resHeaders.set('x-orchestrator-routed', 'bypass');

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: resHeaders,
  });
}
