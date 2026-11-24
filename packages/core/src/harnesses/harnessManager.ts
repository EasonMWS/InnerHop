import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { HarnessId, HarnessStatus, PresetConfig } from '../types.js';
import { getDefaultDataDir } from '../store/configStore.js';

export interface HarnessManagerOptions {
  homeDir?: string;
  dataDir?: string;
  port?: number;
}

const CODEX_MARKER_START = '# >>> INNERHOP MANAGED START >>>';
const CODEX_MARKER_END = '# <<< INNERHOP MANAGED END <<<';
const LEGACY_CODEX_MARKER_START = '# >>> ORCHESTRATOR MANAGED START >>>';
const LEGACY_CODEX_MARKER_END = '# <<< ORCHESTRATOR MANAGED END <<<';

function isCommandAvailable(cmd: string): boolean {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(checker, [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export class HarnessManager {
  private readonly homeDir: string;
  private readonly backupsDir: string;
  private port: number;

  constructor(options: HarnessManagerOptions = {}) {
    this.homeDir = options.homeDir ?? homedir();
    const dataDir = options.dataDir ?? getDefaultDataDir();
    this.backupsDir = join(dataDir, 'backups');
    this.port = options.port ?? 8787;
    mkdirSync(this.backupsDir, { recursive: true });
  }

  setPort(port: number): void {
    this.port = port;
  }

  private getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private getClaudeSettingsPath(): string {
    return join(this.homeDir, '.claude', 'settings.json');
  }

  private getCodexConfigPath(): string {
    return join(this.homeDir, '.codex', 'config.toml');
  }

  private getOpenCodeConfigPath(): string {
    return join(this.homeDir, '.config', 'opencode', 'opencode.json');
  }

  private getBackupPath(id: HarnessId): string {
    return join(this.backupsDir, `${id}.bak`);
  }

  private getBackupMetaPath(id: HarnessId): string {
    return join(this.backupsDir, `${id}.meta.json`);
  }

  private saveBackupIfNeeded(id: HarnessId, targetPath: string): void {
    const bakPath = this.getBackupPath(id);
    const metaPath = this.getBackupMetaPath(id);
    if (existsSync(metaPath)) return;

    const existed = existsSync(targetPath);
    writeFileSync(metaPath, JSON.stringify({ existed }), 'utf8');
    if (existed) {
      copyFileSync(targetPath, bakPath);
    }
  }

  private restoreBackup(id: HarnessId, targetPath: string): boolean {
    const bakPath = this.getBackupPath(id);
    const metaPath = this.getBackupMetaPath(id);
    if (!existsSync(metaPath)) return false;

    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { existed: boolean };
    if (meta.existed && existsSync(bakPath)) {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(bakPath, targetPath);
      unlinkSync(bakPath);
    } else if (!meta.existed && existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
    unlinkSync(metaPath);
    return true;
  }

  listStatuses(activePresetId: string): HarnessStatus[] {
    const baseUrl = this.getBaseUrl();
    const openAiUrl = `${baseUrl}/v1`;
    const modelAlias = `ih:${activePresetId}`;

    // 1. Claude Code
    const claudePath = this.getClaudeSettingsPath();
    let claudeEnabled = false;
    if (existsSync(claudePath)) {
      try {
        const json = JSON.parse(readFileSync(claudePath, 'utf8')) as {
          env?: Record<string, string>;
        };
        claudeEnabled = Boolean(json.env?.ANTHROPIC_BASE_URL?.includes('127.0.0.1'));
      } catch {
        claudeEnabled = false;
      }
    }

    // 2. Codex CLI
    const codexPath = this.getCodexConfigPath();
    let codexEnabled = false;
    if (existsSync(codexPath)) {
      try {
        const raw = readFileSync(codexPath, 'utf8');
        codexEnabled =
          raw.includes(CODEX_MARKER_START) || raw.includes(LEGACY_CODEX_MARKER_START);
      } catch {
        codexEnabled = false;
      }
    }

    // 3. OpenCode
    const opencodePath = this.getOpenCodeConfigPath();
    let opencodeEnabled = false;
    if (existsSync(opencodePath)) {
      try {
        const json = JSON.parse(readFileSync(opencodePath, 'utf8')) as {
          provider?: Record<string, unknown>;
        };
        opencodeEnabled = Boolean(json.provider?.innerhop || json.provider?.orchestrator);
      } catch {
        opencodeEnabled = false;
      }
    }

    return [
      {
        id: 'claude-code',
        name: 'Claude Code',
        description:
          '终端版 Claude Code CLI（仅支持 API Key 模式，支持智能分流；Claude Desktop 订阅版桌面端会忽略自定义代理地址）',
        mode: 'one-click',
        installed: isCommandAvailable('claude') || existsSync(dirname(claudePath)),
        enabled: claudeEnabled,
        configPath: claudePath,
        hasBackup: existsSync(this.getBackupMetaPath('claude-code')),
      },
      {
        id: 'codex',
        name: 'OpenAI Codex CLI',
        description:
          '终端版 OpenAI Codex CLI（写入独立 profile，仅限终端运行 codex -p innerhop + OPENAI_API_KEY；官方 Codex/ChatGPT 订阅桌面端不走代理且不受影响）',
        mode: 'one-click',
        installed: isCommandAvailable('codex') || existsSync(dirname(codexPath)),
        enabled: codexEnabled,
        configPath: codexPath,
        hasBackup: existsSync(this.getBackupMetaPath('codex')),
      },
      {
        id: 'opencode',
        name: 'OpenCode',
        description: '开源多模型终端编程工具（注入 innerhop provider 即可选择）',
        mode: 'one-click',
        installed: isCommandAvailable('opencode') || existsSync(dirname(opencodePath)),
        enabled: opencodeEnabled,
        configPath: opencodePath,
        hasBackup: existsSync(this.getBackupMetaPath('opencode')),
      },
      {
        id: 'other',
        name: '其他 Harness',
        description:
          'Cline、Roo Code、Cursor、Windsurf、Aider 等任意支持 OpenAI Compatible 的工具，统一填写下方本地地址即可接入',
        mode: 'manual-guide',
        installed: true,
        enabled: false,
        configPath: null,
        hasBackup: false,
        copyConfig: {
          providerLabel: 'OpenAI Compatible',
          baseUrl: openAiUrl,
          apiKeyPlaceholder: 'innerhop-local',
          modelName: modelAlias,
        },
        guideSteps: [
          '打开对应工具的自定义模型 / API Provider 设置面板。',
          'Provider 选择「OpenAI Compatible」，Base URL 填入上方地址，API Key 填任意非空占位字符（如 innerhop-local）。',
          'Model ID 填入当前策略代号（或固定填写 innerhop）；Aider 用户也可直接在终端执行 innerhop run aider。',
        ],
      },
    ];
  }

  enableHarness(
    id: HarnessId,
    activePresetId: string,
    presets?: PresetConfig[],
  ): HarnessStatus[] {
    const baseUrl = this.getBaseUrl();

    if (id === 'claude-code') {
      const target = this.getClaudeSettingsPath();
      mkdirSync(dirname(target), { recursive: true });
      this.saveBackupIfNeeded('claude-code', target);

      let json: Record<string, unknown> = {};
      if (existsSync(target)) {
        try {
          json = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
        } catch {
          json = {};
        }
      }
      const env =
        json.env && typeof json.env === 'object'
          ? { ...(json.env as Record<string, string>) }
          : {};
      env.ANTHROPIC_BASE_URL = baseUrl;
      json.env = env;
      writeFileSync(target, JSON.stringify(json, null, 2), 'utf8');
    } else if (id === 'codex') {
      const target = this.getCodexConfigPath();
      mkdirSync(dirname(target), { recursive: true });
      this.saveBackupIfNeeded('codex', target);

      let raw = existsSync(target) ? readFileSync(target, 'utf8') : '';
      raw = this.stripCodexBlock(raw);
      const block = [
        CODEX_MARKER_START,
        `[model_providers.innerhop]`,
        `name = "InnerHop"`,
        `base_url = "${baseUrl}/v1"`,
        `wire_api = "responses"`,
        `env_key = "OPENAI_API_KEY"`,
        '',
        `[profiles.innerhop]`,
        `model_provider = "innerhop"`,
        `model = "ih:${activePresetId}"`,
        CODEX_MARKER_END,
      ].join('\n');
      const trimmedBase = raw.trimEnd();
      const next = trimmedBase ? `${trimmedBase}\n\n${block}\n` : `${block}\n`;
      writeFileSync(target, next, 'utf8');
    } else if (id === 'opencode') {
      const target = this.getOpenCodeConfigPath();
      mkdirSync(dirname(target), { recursive: true });
      this.saveBackupIfNeeded('opencode', target);

      let json: Record<string, unknown> = {};
      if (existsSync(target)) {
        try {
          json = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
        } catch {
          json = {};
        }
      }
      const providers =
        json.provider && typeof json.provider === 'object'
          ? { ...(json.provider as Record<string, unknown>) }
          : {};
      delete providers.orchestrator;

      const modelsMap: Record<string, { name: string }> = {
        innerhop: { name: 'InnerHop (跟随当前默认策略)' },
      };
      if (presets && presets.length > 0) {
        for (const p of presets) {
          modelsMap[`ih:${p.id}`] = { name: `InnerHop · ${p.name}` };
        }
      } else {
        modelsMap[`ih:${activePresetId}`] = { name: `InnerHop (${activePresetId})` };
      }

      providers.innerhop = {
        npm: '@ai-sdk/openai-compatible',
        name: 'InnerHop (Planner + Executor)',
        options: {
          baseURL: `${baseUrl}/v1`,
          apiKey: 'innerhop-local',
        },
        models: modelsMap,
      };
      json.provider = providers;
      json.model = `innerhop/ih:${activePresetId}`;
      writeFileSync(target, JSON.stringify(json, null, 2), 'utf8');
    }

    return this.listStatuses(activePresetId);
  }

  syncEnabledHarnesses(activePresetId: string, presets: PresetConfig[]): void {
    const statuses = this.listStatuses(activePresetId);
    for (const s of statuses) {
      if (s.enabled && (s.id === 'opencode' || s.id === 'codex')) {
        this.enableHarness(s.id, activePresetId, presets);
      }
    }
  }

  disableHarness(id: HarnessId, activePresetId: string): HarnessStatus[] {
    if (id === 'claude-code') {
      const target = this.getClaudeSettingsPath();
      if (!this.restoreBackup('claude-code', target) && existsSync(target)) {
        try {
          const json = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
          if (json.env && typeof json.env === 'object') {
            delete (json.env as Record<string, unknown>).ANTHROPIC_BASE_URL;
          }
          writeFileSync(target, JSON.stringify(json, null, 2), 'utf8');
        } catch {
          // ignore
        }
      }
    } else if (id === 'codex') {
      const target = this.getCodexConfigPath();
      if (!this.restoreBackup('codex', target) && existsSync(target)) {
        const raw = readFileSync(target, 'utf8');
        writeFileSync(target, this.stripCodexBlock(raw), 'utf8');
      }
    } else if (id === 'opencode') {
      const target = this.getOpenCodeConfigPath();
      if (!this.restoreBackup('opencode', target) && existsSync(target)) {
        try {
          const json = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
          if (json.provider && typeof json.provider === 'object') {
            delete (json.provider as Record<string, unknown>).innerhop;
            delete (json.provider as Record<string, unknown>).orchestrator;
          }
          writeFileSync(target, JSON.stringify(json, null, 2), 'utf8');
        } catch {
          // ignore
        }
      }
    }

    return this.listStatuses(activePresetId);
  }

  private stripMarkerPair(raw: string, startMarker: string, endMarker: string): string {
    const startIdx = raw.indexOf(startMarker);
    const endIdx = raw.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return raw;
    const before = raw.slice(0, startIdx).replace(/\s+$/, '');
    const after = raw.slice(endIdx + endMarker.length).replace(/^\s+/, '');
    if (!before && !after) return '';
    if (!before) return `${after}\n`;
    if (!after) return `${before}\n`;
    return `${before}\n\n${after}`;
  }

  private stripCodexBlock(raw: string): string {
    let cleaned = this.stripMarkerPair(raw, CODEX_MARKER_START, CODEX_MARKER_END);
    cleaned = this.stripMarkerPair(cleaned, LEGACY_CODEX_MARKER_START, LEGACY_CODEX_MARKER_END);
    return cleaned;
  }
}
