import { createHash } from 'node:crypto';
import type { CanonicalRequest } from '../protocols/normalized.js';

export function extractSessionId(req: CanonicalRequest): string {
  const explicitHeader = req.rawHeaders['x-orchestrator-session'];
  if (explicitHeader && explicitHeader.trim()) {
    return `hdr:${explicitHeader.trim()}`;
  }

  if (req.metadataUserId && req.metadataUserId.trim()) {
    return `uid:${req.metadataUserId.trim()}`;
  }

  if (req.promptCacheKey && req.promptCacheKey.trim()) {
    return `pck:${req.promptCacheKey.trim()}`;
  }

  const firstUserMsg = req.messages.find((m) => m.role === 'user');
  const firstUserText = firstUserMsg
    ? firstUserMsg.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .slice(0, 600)
    : 'empty';

  const systemPrefix = req.systemParts
    .map((s) => s.text)
    .join('\n')
    .slice(0, 400);

  const hash = createHash('sha256')
    .update(`${req.protocol}::${systemPrefix}::${firstUserText}`)
    .digest('hex')
    .slice(0, 16);

  return `fp:${hash}`;
}
