#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createOrchestratorServer } from '@orchestrator/core';

function parseArgs(argv: string[]) {
  const args = [...argv];
  let port = 8787;
  let preset: string | undefined;
  const positional: string[] = [];
  let passthroughArgs: string[] = [];

  const dashDashIdx = args.indexOf('--');
  if (dashDashIdx !== -1) {
    passthroughArgs = args.slice(dashDashIdx + 1);
    args.splice(dashDashIdx);
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--port' && args[i + 1]) {
      port = Number(args[++i]) || 8787;
    } else if (a === '--preset' && args[i + 1]) {
      preset = args[++i];
    } else {
      positional.push(a);
    }
  }

  return { command: positional[0] ?? 'help', sub: positional[1], rest: positional.slice(2), port, preset, passthroughArgs };
}

async function isServerAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

function printHelp() {
  console.log(`
Orchestrator CLI (orch) — 多 Harness 通用双模型编排器

用法:
  orch serve [--port 8787]                   启动本地编排代理服务
  orch run <claude|codex|opencode|aider>     带代理环境变量临时启动指定 AI 工具
           [--preset <id>] [-- ...args]
  orch status [--port 8787]                  查看当前运行状态与活跃会话
  `.trim());
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
    printHelp();
    return;
  }

  if (parsed.command === 'serve') {
    const srv = createOrchestratorServer();
    const info = await srv.listen(parsed.port, '127.0.0.1');
    const cfg = srv.configStore.getConfig();
    const preset = srv.configStore.getPresetById(cfg.activePresetId);
    console.log(`[Orchestrator] 代理引擎已启动: ${info.url}`);
    console.log(
      `[Orchestrator] 当前套餐: ${preset.name} (${preset.planner.modelId} -> ${preset.executor.modelId})`,
    );
    console.log(`[Orchestrator] 按 Ctrl+C 停止服务`);
    process.on('SIGINT', async () => {
      await srv.close();
      process.exit(0);
    });
    return;
  }

  if (parsed.command === 'status') {
    const url = `http://127.0.0.1:${parsed.port}/api/health`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.error(`[Orchestrator] 未检测到运行中的服务 (${url})。请先打开桌面端或运行 orch serve。`);
      process.exit(1);
    }
    return;
  }

  if (parsed.command === 'run') {
    const target = parsed.sub;
    if (!target) {
      console.error('请指定要启动的工具，例如: orch run claude');
      process.exit(1);
    }

    let embeddedServer: ReturnType<typeof createOrchestratorServer> | null = null;
    if (!(await isServerAlive(parsed.port))) {
      embeddedServer = createOrchestratorServer();
      await embeddedServer.listen(parsed.port, '127.0.0.1');
      console.log(`[Orchestrator] 已自动拉起临时本地编排引擎 http://127.0.0.1:${parsed.port}`);
    }

    const baseUrl = `http://127.0.0.1:${parsed.port}`;
    const modelName = parsed.preset ? `orch:${parsed.preset}` : 'orchestrator';
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ANTHROPIC_BASE_URL: baseUrl,
      OPENAI_BASE_URL: `${baseUrl}/v1`,
      OPENAI_API_BASE: `${baseUrl}/v1`,
      ...(parsed.preset ? { ANTHROPIC_MODEL: modelName, OPENAI_MODEL: modelName } : {}),
    };

    const childArgs = [...parsed.rest, ...parsed.passthroughArgs];
    const child = spawn(target, childArgs, {
      stdio: 'inherit',
      env: childEnv,
      shell: process.platform === 'win32',
    });

    child.on('exit', async (code) => {
      if (embeddedServer) await embeddedServer.close();
      process.exit(code ?? 0);
    });
    child.on('error', async (err) => {
      console.error(`[Orchestrator] 启动 "${target}" 失败: ${err.message}`);
      if (embeddedServer) await embeddedServer.close();
      process.exit(1);
    });
    return;
  }

  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
