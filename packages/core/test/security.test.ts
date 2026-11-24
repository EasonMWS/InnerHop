import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigStore,
  createOrchestratorServer,
  HarnessManager,
  hasDisallowedConsumerSessionHeaders,
  migrateLegacyDataDirIfNeeded,
  SessionStore,
} from '../src/index.js';

describe('Security & Platform-ToS Compliance', () => {
  let tmpDir: string;
  let server: ReturnType<typeof createOrchestratorServer>;
  let url: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orch-sec-'));
    const configStore = new ConfigStore(tmpDir);
    const sessionStore = new SessionStore(tmpDir);
    const harnessManager = new HarnessManager({ homeDir: tmpDir, dataDir: tmpDir });
    server = createOrchestratorServer({ configStore, sessionStore, harnessManager });
    const info = await server.listen(0, '127.0.0.1');
    url = info.url;
  });

  afterEach(async () => {
    await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('blocks untrusted browser Origin on /api/* while allowing localhost and no-origin CLI', async () => {
    const evilConfigRes = await fetch(`${url}/api/config`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(evilConfigRes.status).toBe(403);

    const evilHarnessRes = await fetch(`${url}/api/harnesses/claude-code/enable`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect(evilHarnessRes.status).toBe(403);

    const localViteRes = await fetch(`${url}/api/config`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    expect(localViteRes.status).toBe(200);

    const electronFileRes = await fetch(`${url}/api/config`, {
      headers: { Origin: 'null' },
    });
    expect(electronFileRes.status).toBe(200);

    const cliRes = await fetch(`${url}/api/health`);
    expect(cliRes.status).toBe(200);
  });

  it('refuses binding to non-loopback host unless INNERHOP_ALLOW_REMOTE=1', async () => {
    const prevInner = process.env.INNERHOP_ALLOW_REMOTE;
    const prevOrch = process.env.ORCHESTRATOR_ALLOW_REMOTE;
    delete process.env.INNERHOP_ALLOW_REMOTE;
    delete process.env.ORCHESTRATOR_ALLOW_REMOTE;
    const remoteSrv = createOrchestratorServer({
      configStore: new ConfigStore(tmpDir),
      sessionStore: new SessionStore(tmpDir),
      harnessManager: new HarnessManager({ homeDir: tmpDir, dataDir: tmpDir }),
    });
    await expect(remoteSrv.listen(0, '0.0.0.0')).rejects.toThrow(/non-loopback/i);
    if (prevInner !== undefined) process.env.INNERHOP_ALLOW_REMOTE = prevInner;
    if (prevOrch !== undefined) process.env.ORCHESTRATOR_ALLOW_REMOTE = prevOrch;
  });

  it('blocks consumer ChatGPT subscription session headers to prevent ToS violations', async () => {
    expect(hasDisallowedConsumerSessionHeaders({ 'chatgpt-account-id': 'acct-123' })).toBe(true);
    expect(hasDisallowedConsumerSessionHeaders({ authorization: 'Bearer sk-proj-123' })).toBe(false);

    const blockedRes = await fetch(`${url}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer chatgpt-oauth-token',
        'chatgpt-account-id': 'acct-999',
      },
      body: JSON.stringify({
        model: 'orchestrator',
        input: 'hello',
      }),
    });
    expect(blockedRes.status).toBe(403);
    const errBody = (await blockedRes.json()) as { error?: { type?: string } };
    expect(errBody.error?.type).toBe('compliance_error');
  });

  it('migrates legacy v1 config files by stripping removed demo and consumer-passthrough entries', () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'orch-migrate-'));
    try {
      writeFileSync(
        join(legacyDir, 'config.json'),
        JSON.stringify({
          port: 8787,
          host: '127.0.0.1',
          activePresetId: 'default-demo',
          providers: [
            { id: 'mock-demo', name: 'Demo', type: 'mock-demo', baseUrl: 'mock://local', apiKey: 'x' },
            { id: 'codex-chatgpt-passthrough', name: 'ChatGPT', type: 'codex-responses-passthrough', baseUrl: 'https://chatgpt.com/backend-api/codex', apiKey: '' },
            { id: 'openai-api', name: 'OpenAI API', type: 'openai-compat', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-user' },
          ],
          presets: [
            {
              id: 'default-demo',
              name: 'Demo',
              description: 'demo',
              planner: { providerId: 'mock-demo', modelId: 'demo' },
              executor: { providerId: 'mock-demo', modelId: 'demo' },
              rules: { readOnlyPlanning: true, maxConsecutiveErrors: 2, reviewEverySteps: 10, maxHopsPerRequest: 2, inlineStatusBadge: false },
            },
          ],
        }),
        'utf8',
      );
      const store = new ConfigStore(legacyDir);
      const migrated = store.getConfig();
      expect(migrated.providers.some((p) => p.id === 'mock-demo')).toBe(false);
      expect(migrated.providers.some((p) => p.id === 'codex-chatgpt-passthrough')).toBe(false);
      expect(migrated.providers.some((p) => p.id === 'openai-api' && p.apiKey === 'sk-user')).toBe(true);
      expect(migrated.activePresetId).toBe('claude-flagship-workhorse');
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it('closes active /api/events SSE streams immediately and frees the port on close()', async () => {
    const sseController = new AbortController();
    const sseRes = await fetch(`${url}/api/events`, {
      signal: sseController.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);

    const started = Date.now();
    await server.close();
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeLessThan(1000);

    sseController.abort();
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });

  it('migrates legacy ~/.orchestrator data dir to ~/.innerhop read-only without deleting legacy files', () => {
    const base = mkdtempSync(join(tmpdir(), 'ih-legacy-mig-'));
    try {
      const legacyDir = join(base, '.orchestrator');
      const targetDir = join(base, '.innerhop');
      mkdirSync(join(legacyDir, 'backups'), { recursive: true });
      writeFileSync(join(legacyDir, 'config.json'), '{"port":8787,"apiKeyHint":"kept"}', 'utf8');
      writeFileSync(join(legacyDir, 'sessions.json'), '[{"id":"s1"}]', 'utf8');
      writeFileSync(join(legacyDir, 'backups', 'claude-code.bak'), '{"env":{}}', 'utf8');

      const migrated = migrateLegacyDataDirIfNeeded(targetDir, legacyDir);
      expect(migrated).toBe(true);
      expect(readFileSync(join(targetDir, 'config.json'), 'utf8')).toContain('kept');
      expect(readFileSync(join(targetDir, 'sessions.json'), 'utf8')).toContain('s1');
      expect(readFileSync(join(targetDir, 'backups', 'claude-code.bak'), 'utf8')).toBe('{"env":{}}');

      // Legacy directory must remain intact
      expect(existsSync(join(legacyDir, 'config.json'))).toBe(true);
      expect(existsSync(join(legacyDir, 'sessions.json'))).toBe(true);

      // Subsequent calls must not overwrite target
      writeFileSync(join(targetDir, 'config.json'), '{"port":9999}', 'utf8');
      expect(migrateLegacyDataDirIfNeeded(targetDir, legacyDir)).toBe(false);
      expect(readFileSync(join(targetDir, 'config.json'), 'utf8')).toBe('{"port":9999}');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
