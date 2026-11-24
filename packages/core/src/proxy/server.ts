import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Server } from 'node:http';
import { OrchestratorFsm } from '../fsm/orchestratorFsm.js';
import { HarnessManager } from '../harnesses/harnessManager.js';
import {
  buildAnthropicJsonResponse,
  createAnthropicSseSink,
  parseAnthropicRequest,
} from '../protocols/anthropicInbound.js';
import {
  buildOpenAIChatJsonResponse,
  buildOpenAIResponsesJsonResponse,
  createOpenAIChatSseSink,
  createOpenAIResponsesSseSink,
  parseOpenAIChatRequest,
  parseOpenAIResponsesRequest,
} from '../protocols/openaiInbound.js';
import {
  hasDisallowedConsumerSessionHeaders,
  testProviderConnection,
} from '../protocols/upstreamClient.js';
import { ConfigStore } from '../store/configStore.js';
import { SessionStore } from '../store/sessionStore.js';
import type { HarnessId, OrchestratorConfig, SessionState } from '../types.js';
import { forwardBypassRequest } from './bypassProxy.js';
import { createEventCollectorSink, runOrchestratedTurn } from './innerHopEngine.js';

export interface OrchestratorServerOptions {
  configStore?: ConfigStore;
  sessionStore?: SessionStore;
  harnessManager?: HarnessManager;
}

export interface OrchestratorServerHandle {
  app: Hono;
  configStore: ConfigStore;
  sessionStore: SessionStore;
  harnessManager: HarnessManager;
  listen: (port?: number, host?: string) => Promise<{ port: number; host: string; url: string }>;
  close: () => Promise<void>;
}

function collectLowercaseHeaders(raw: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === 'null' || origin.startsWith('file://') || origin.startsWith('app://')) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

export function createOrchestratorServer(
  options: OrchestratorServerOptions = {},
): OrchestratorServerHandle {
  const configStore = options.configStore ?? new ConfigStore();
  const sessionStore = options.sessionStore ?? new SessionStore();
  const harnessManager =
    options.harnessManager ??
    new HarnessManager({ port: configStore.getConfig().port });
  const fsm = new OrchestratorFsm(sessionStore);

  const app = new Hono();
  app.use(
    '*',
    cors({
      origin: (origin) => (isAllowedOrigin(origin) ? origin : ''),
    }),
  );
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !isAllowedOrigin(origin)) {
      return c.json({ error: 'Forbidden origin' }, 403);
    }
    await next();
  });

  let boundPort = configStore.getConfig().port;
  let boundHost = configStore.getConfig().host;
  let nodeServer: Server | null = null;
  const activeSseClosers = new Set<() => void>();

  // --- Management API ---

  app.get('/api/health', (c) => {
    const cfg = configStore.getConfig();
    return c.json({
      ok: true,
      port: boundPort,
      host: boundHost,
      activePresetId: cfg.activePresetId,
      sessionCount: sessionStore.list().length,
    });
  });

  app.get('/api/config', (c) => {
    return c.json(configStore.getConfig());
  });

  app.put('/api/config', async (c) => {
    const next = (await c.req.json()) as OrchestratorConfig;
    const saved = configStore.updateConfig(next);
    harnessManager.syncEnabledHarnesses(saved.activePresetId, saved.presets);
    return c.json(saved);
  });

  app.post('/api/providers/test', async (c) => {
    const body = (await c.req.json()) as { providerId: string; modelId: string };
    const provider = configStore.getProvider(body.providerId);
    if (!provider) {
      return c.json({ ok: false, latencyMs: 0, message: '未找到该供应商' }, 404);
    }
    const result = await testProviderConnection(provider, body.modelId);
    return c.json(result);
  });

  app.get('/api/sessions', (c) => {
    return c.json(sessionStore.list());
  });

  app.delete('/api/sessions', (c) => {
    sessionStore.clearAll();
    return c.json({ ok: true });
  });

  app.delete('/api/sessions/:id', (c) => {
    const ok = sessionStore.delete(c.req.param('id'));
    return c.json({ ok });
  });

  app.post('/api/sessions/:id/force-planner', (c) => {
    const session = sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ ok: false }, 404);
    session.forcePlannerNext = true;
    sessionStore.save(session);
    return c.json({ ok: true, session });
  });

  app.post('/api/sessions/:id/reset', (c) => {
    const session = sessionStore.get(c.req.param('id'));
    if (!session) return c.json({ ok: false }, 404);
    session.phase = 'PLANNING';
    session.activePlan = null;
    session.replanIf = null;
    session.execSteps = 0;
    session.consecutiveErrors = 0;
    session.reviewReason = null;
    session.lastErrorSummary = null;
    session.forcePlannerNext = false;
    sessionStore.appendEvent(session, {
      type: 'manual_override',
      toPhase: 'PLANNING',
      summary: '用户手动重置会话为规划态',
    });
    return c.json({ ok: true, session });
  });

  app.get('/api/events', (c) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let isClosed = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        const send = (event: string, data: unknown) => {
          if (isClosed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            cleanup();
          }
        };

        const onSessionUpdate = (s: SessionState) => send('session_update', s);
        const onSessionDeleted = (id: string) => send('session_deleted', { id });
        const onConfigUpdate = (cfg: OrchestratorConfig) => send('config_update', cfg);

        const cleanup = () => {
          if (isClosed) return;
          isClosed = true;
          activeSseClosers.delete(cleanup);
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          sessionStore.off('session_update', onSessionUpdate);
          sessionStore.off('session_deleted', onSessionDeleted);
          configStore.off('config_update', onConfigUpdate);
          try {
            controller.close();
          } catch {
            // ignore
          }
        };

        activeSseClosers.add(cleanup);

        send('init', {
          sessions: sessionStore.list(),
          config: configStore.getConfig(),
        });

        sessionStore.on('session_update', onSessionUpdate);
        sessionStore.on('session_deleted', onSessionDeleted);
        configStore.on('config_update', onConfigUpdate);

        timer = setInterval(() => {
          if (isClosed) {
            if (timer) clearInterval(timer);
            return;
          }
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            cleanup();
          }
        }, 15000);
        timer.unref?.();

        c.req.raw.signal.addEventListener('abort', cleanup);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  });

  app.get('/api/harnesses', (c) => {
    const cfg = configStore.getConfig();
    return c.json(harnessManager.listStatuses(cfg.activePresetId));
  });

  app.post('/api/harnesses/:id/enable', (c) => {
    const id = c.req.param('id') as HarnessId;
    const cfg = configStore.getConfig();
    return c.json(harnessManager.enableHarness(id, cfg.activePresetId, cfg.presets));
  });

  app.post('/api/harnesses/:id/disable', (c) => {
    const id = c.req.param('id') as HarnessId;
    const cfg = configStore.getConfig();
    return c.json(harnessManager.disableHarness(id, cfg.activePresetId));
  });

  // --- LLM Proxy Endpoints ---

  app.get('/v1/models', (c) => {
    const cfg = configStore.getConfig();
    return c.json({
      object: 'list',
      data: [
        { id: 'innerhop', object: 'model', created: 1700000000, owned_by: 'innerhop' },
        ...cfg.presets.map((p) => ({
          id: `ih:${p.id}`,
          object: 'model',
          created: 1700000000,
          owned_by: 'innerhop',
        })),
      ],
    });
  });

  app.post('/v1/messages', async (c) => {
    const rawBody = await c.req.text();
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const headers = collectLowercaseHeaders(c.req.header());
    if (hasDisallowedConsumerSessionHeaders(headers)) {
      return c.json(
        {
          error: {
            type: 'compliance_error',
            message:
              '为遵守 OpenAI 服务条款，InnerHop 禁止代理或混用消费级 ChatGPT 订阅会话。请使用官方 API Key。',
          },
        },
        403,
      );
    }
    const requestedModel = typeof body.model === 'string' ? body.model : undefined;

    if (!configStore.shouldOrchestrate(requestedModel)) {
      return forwardBypassRequest('anthropic', rawBody, headers, configStore.getConfig().routing);
    }

    const canonical = parseAnthropicRequest(body, headers);

    if (!canonical.stream) {
      const { sink, events } = createEventCollectorSink();
      await runOrchestratedTurn(canonical, sink, { configStore, sessionStore, fsm });
      return c.json(buildAnthropicJsonResponse(events, canonical.requestedModel), 200, {
        'x-innerhop-routed': 'innerhop',
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sink = createAnthropicSseSink(
          (chunk) => controller.enqueue(encoder.encode(chunk)),
          canonical.requestedModel,
        );
        try {
          await runOrchestratedTurn(canonical, sink, { configStore, sessionStore, fsm });
        } catch (err) {
          sink.emit({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
          sink.close();
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'x-innerhop-routed': 'innerhop',
      },
    });
  });

  app.post('/v1/chat/completions', async (c) => {
    const rawBody = await c.req.text();
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const headers = collectLowercaseHeaders(c.req.header());
    if (hasDisallowedConsumerSessionHeaders(headers)) {
      return c.json(
        {
          error: {
            type: 'compliance_error',
            message:
              '为遵守 OpenAI 服务条款，InnerHop 禁止代理或混用消费级 ChatGPT 订阅会话。请使用官方 OPENAI_API_KEY。',
          },
        },
        403,
      );
    }
    const requestedModel = typeof body.model === 'string' ? body.model : undefined;

    if (!configStore.shouldOrchestrate(requestedModel)) {
      return forwardBypassRequest('openai-chat', rawBody, headers, configStore.getConfig().routing);
    }

    const canonical = parseOpenAIChatRequest(body, headers);

    if (!canonical.stream) {
      const { sink, events } = createEventCollectorSink();
      await runOrchestratedTurn(canonical, sink, { configStore, sessionStore, fsm });
      return c.json(buildOpenAIChatJsonResponse(events, canonical.requestedModel), 200, {
        'x-innerhop-routed': 'innerhop',
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sink = createOpenAIChatSseSink(
          (chunk) => controller.enqueue(encoder.encode(chunk)),
          canonical.requestedModel,
        );
        try {
          await runOrchestratedTurn(canonical, sink, { configStore, sessionStore, fsm });
        } catch (err) {
          sink.emit({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
          sink.close();
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'x-innerhop-routed': 'innerhop',
      },
    });
  });

  app.post('/v1/responses', async (c) => {
    const rawBody = await c.req.text();
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const headers = collectLowercaseHeaders(c.req.header());
    if (hasDisallowedConsumerSessionHeaders(headers)) {
      return c.json(
        {
          error: {
            type: 'compliance_error',
            message:
              '为遵守 OpenAI 服务条款，InnerHop 禁止代理或混用消费级 ChatGPT 订阅会话。请使用官方 OPENAI_API_KEY 认证 Codex CLI 后再接入。',
          },
        },
        403,
      );
    }
    const requestedModel = typeof body.model === 'string' ? body.model : undefined;

    if (!configStore.shouldOrchestrate(requestedModel)) {
      return forwardBypassRequest('openai-responses', rawBody, headers, configStore.getConfig().routing);
    }

    const canonical = parseOpenAIResponsesRequest(body, headers);

    if (!canonical.stream) {
      const { sink, events } = createEventCollectorSink();
      await runOrchestratedTurn(canonical, sink, { configStore, sessionStore, fsm });
      return c.json(buildOpenAIResponsesJsonResponse(events, canonical.requestedModel), 200, {
        'x-innerhop-routed': 'innerhop',
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sink = createOpenAIResponsesSseSink(
          (chunk) => controller.enqueue(encoder.encode(chunk)),
          canonical.requestedModel,
        );
        try {
          await runOrchestratedTurn(canonical, sink, { configStore, sessionStore, fsm });
        } catch (err) {
          sink.emit({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
          sink.close();
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'x-innerhop-routed': 'innerhop',
      },
    });
  });

  return {
    app,
    configStore,
    sessionStore,
    harnessManager,
    listen(port = configStore.getConfig().port, host = configStore.getConfig().host) {
      if (
        !isLoopbackHost(host) &&
        process.env.INNERHOP_ALLOW_REMOTE !== '1' &&
        process.env.ORCHESTRATOR_ALLOW_REMOTE !== '1'
      ) {
        return Promise.reject(
          new Error(
            `Security policy blocks binding to non-loopback host "${host}". Set INNERHOP_ALLOW_REMOTE=1 to override.`,
          ),
        );
      }
      return new Promise((resolve, reject) => {
        try {
          const srv = serve(
            {
              fetch: app.fetch,
              port,
              hostname: host,
            },
            (info) => {
              boundPort = info.port;
              boundHost = host;
              harnessManager.setPort(info.port);
              resolve({
                port: info.port,
                host,
                url: `http://${host}:${info.port}`,
              });
            },
          );
          nodeServer = srv as unknown as Server;
        } catch (err) {
          reject(err);
        }
      });
    },
    close() {
      return new Promise((resolve) => {
        for (const closeSse of Array.from(activeSseClosers)) {
          closeSse();
        }
        activeSseClosers.clear();

        const srv = nodeServer;
        if (!srv) {
          resolve();
          return;
        }
        nodeServer = null;

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallbackTimer);
          resolve();
        };

        const fallbackTimer = setTimeout(finish, 1500);
        fallbackTimer.unref?.();

        srv.close(() => finish());
        srv.closeIdleConnections?.();
        srv.closeAllConnections?.();
      });
    },
  };
}
