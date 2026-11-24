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
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { HarnessId, HarnessStatus, PresetConfig } from '../types.js';
import { getDefaultDataDir } from '../store/configStore.js';

export interface HarnessManagerOptions {
  homeDir?: string;
  dataDir?: string;
  port?: number;
}

const MANAGED_MARKER_START = '# >>> INNERHOP MANAGED START >>>';
const MANAGED_MARKER_END = '# <<< INNERHOP MANAGED END <<<';
const LEGACY_CODEX_MARKER_START = '# >>> ORCHESTRATOR MANAGED START >>>';
const LEGACY_CODEX_MARKER_END = '# <<< ORCHESTRATOR MANAGED END <<<';

interface CordisPatchEntry {
  id?: string;
  name?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

function isCommandAvailable(cmd: string): boolean {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(checker, [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
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

  private getDshConfigTarget(): { path: string; format: 'cordis' | 'legacy' } {
    const dshRoot = join(this.homeDir, '.dsh');
    const desktopDir = join(dshRoot, 'profiles', 'desktop');
    const webDir = join(dshRoot, 'profiles', 'web');
    const legacySettings = join(dshRoot, 'settings.yaml');

    if (existsSync(desktopDir)) {
      return { path: join(desktopDir, 'cordis.patch.yml'), format: 'cordis' };
    }
    if (existsSync(webDir)) {
      return { path: join(webDir, 'cordis.patch.yml'), format: 'cordis' };
    }
    if (existsSync(legacySettings)) {
      return { path: legacySettings, format: 'legacy' };
    }
    return { path: join(desktopDir, 'cordis.patch.yml'), format: 'cordis' };
  }

  private getDshCredentialsPath(): string {
    return join(this.homeDir, '.dsh', '.credentials.yaml');
  }

  private getDshEnvPath(): string {
    return join(this.homeDir, '.dsh', '.env');
  }

  private getAiderConfigPath(): string {
    return join(this.homeDir, '.aider.conf.yml');
  }

  private getBackupPath(key: string): string {
    return join(this.backupsDir, `${key}.bak`);
  }

  private getBackupMetaPath(key: string): string {
    return join(this.backupsDir, `${key}.meta.json`);
  }

  private saveBackupIfNeeded(key: string, targetPath: string): void {
    const bakPath = this.getBackupPath(key);
    const metaPath = this.getBackupMetaPath(key);
    if (existsSync(metaPath)) return;

    const existed = existsSync(targetPath);
    writeFileSync(metaPath, JSON.stringify({ existed }), 'utf8');
    if (existed) {
      copyFileSync(targetPath, bakPath);
    }
  }

  private restoreBackup(key: string, targetPath: string): boolean {
    const bakPath = this.getBackupPath(key);
    const metaPath = this.getBackupMetaPath(key);
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

  private buildDshProviderBlock(activePresetId: string, presets?: PresetConfig[]) {
    const baseUrl = this.getBaseUrl();
    const models: Array<{ id: string; name: string }> = [
      { id: 'innerhop', name: 'InnerHop (跟随当前默认策略)' },
    ];
    if (presets && presets.length > 0) {
      for (const p of presets) {
        models.push({ id: `ih:${p.id}`, name: `InnerHop · ${p.name}` });
      }
    } else {
      models.push({ id: `ih:${activePresetId}`, name: `InnerHop (${activePresetId})` });
    }
    return {
      displayName: 'InnerHop (Planner + Executor)',
      apiKeyEnv: 'INNERHOP_API_KEY',
      api: 'openai-completions',
      baseURL: `${baseUrl}/v1`,
      models,
    };
  }

  private checkDshEnabled(target: { path: string; format: 'cordis' | 'legacy' }): boolean {
    if (!existsSync(target.path)) return false;
    try {
      const parsed = parseYaml(readFileSync(target.path, 'utf8'));
      if (target.format === 'cordis') {
        if (!Array.isArray(parsed)) return false;
        const llmEntry = parsed.find(
          (item) =>
            isRecord(item) &&
            (item.id === 'llm-pi-ai' || item.name === '@deepseek-ai/dsh-llm-pi-ai'),
        );
        if (!isRecord(llmEntry) || !isRecord(llmEntry.config) || !isRecord(llmEntry.config.providers)) {
          return false;
        }
        return Boolean(llmEntry.config.providers.innerhop);
      }
      if (!isRecord(parsed) || !isRecord(parsed['llm-pi-ai'])) return false;
      const providers = parsed['llm-pi-ai'].providers;
      return isRecord(providers) && Boolean(providers.innerhop);
    } catch {
      return false;
    }
  }

  listStatuses(activePresetId: string): HarnessStatus[] {
    const baseUrl = this.getBaseUrl();
    const openAiUrl = `${baseUrl}/v1`;
    const modelAlias = `ih:${activePresetId}`;

    // 1. OpenCode (Desktop GUI + CLI)
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

    // 2. DeepSeek Harness / DSH (Desktop GUI + Web + CLI)
    const dshTarget = this.getDshConfigTarget();
    const dshEnabled = this.checkDshEnabled(dshTarget);

    // 3. Claude Code CLI (Terminal API Key mode only)
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

    // 4. OpenAI Codex CLI (Terminal API Key mode only)
    const codexPath = this.getCodexConfigPath();
    let codexEnabled = false;
    if (existsSync(codexPath)) {
      try {
        const raw = readFileSync(codexPath, 'utf8');
        codexEnabled =
          raw.includes(MANAGED_MARKER_START) || raw.includes(LEGACY_CODEX_MARKER_START);
      } catch {
        codexEnabled = false;
      }
    }

    // 5. Aider CLI
    const aiderPath = this.getAiderConfigPath();
    let aiderEnabled = false;
    if (existsSync(aiderPath)) {
      try {
        aiderEnabled = readFileSync(aiderPath, 'utf8').includes(MANAGED_MARKER_START);
      } catch {
        aiderEnabled = false;
      }
    }

    return [
      {
        id: 'opencode',
        name: 'OpenCode',
        description:
          '开源多模型编程工具（Desktop 桌面端 & 终端 CLI 通用，一键写入 innerhop 供应商及全部策略别名）',
        mode: 'one-click',
        surface: 'gui-and-cli',
        installed: isCommandAvailable('opencode') || existsSync(dirname(opencodePath)),
        enabled: opencodeEnabled,
        configPath: opencodePath,
        hasBackup: existsSync(this.getBackupMetaPath('opencode')),
      },
      {
        id: 'dsh',
        name: 'DeepSeek Harness (DSH)',
        description:
          'DeepSeek 插件化 Agent 环境（Desktop 桌面端 / Web / CLI 通用，一键注入并设为默认；若桌面端正开着需重启生效）',
        mode: 'one-click',
        surface: 'gui-and-cli',
        installed: isCommandAvailable('dsh') || existsSync(join(this.homeDir, '.dsh')),
        enabled: dshEnabled,
        configPath: dshTarget.path,
        hasBackup: existsSync(this.getBackupMetaPath('dsh')),
      },
      {
        id: 'claude-code',
        name: 'Claude Code CLI',
        description:
          '仅限终端 CLI（API Key 模式，支持智能分流）；Claude Desktop 消费级订阅客户端直连官方 OAuth，无法走本地代理',
        mode: 'one-click',
        surface: 'cli-only',
        installed: isCommandAvailable('claude') || existsSync(dirname(claudePath)),
        enabled: claudeEnabled,
        configPath: claudePath,
        hasBackup: existsSync(this.getBackupMetaPath('claude-code')),
      },
      {
        id: 'codex',
        name: 'OpenAI Codex CLI',
        description:
          '仅限终端运行 codex -p innerhop（API Key 模式）；ChatGPT / Codex 官方订阅桌面端走 OAuth，不受影响也不走代理',
        mode: 'one-click',
        surface: 'cli-only',
        installed: isCommandAvailable('codex') || existsSync(dirname(codexPath)),
        enabled: codexEnabled,
        configPath: codexPath,
        hasBackup: existsSync(this.getBackupMetaPath('codex')),
      },
      {
        id: 'aider',
        name: 'Aider CLI',
        description:
          '终端 AI 结对编程工具（一键写入 ~/.aider.conf.yml 托管段并支持无损还原，也可运行 innerhop run aider）',
        mode: 'one-click',
        surface: 'cli-only',
        installed: isCommandAvailable('aider') || existsSync(aiderPath),
        enabled: aiderEnabled,
        configPath: aiderPath,
        hasBackup: existsSync(this.getBackupMetaPath('aider')),
      },
      {
        id: 'other',
        name: '其他 Harness',
        description:
          'Cline、Roo Code、Cursor、Windsurf 等桌面 IDE 插件及任意 OpenAI Compatible 客户端，复制下方 3 项即可接入',
        mode: 'manual-guide',
        surface: 'gui-manual',
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
          '打开对应插件或软件的自定义 API Provider 设置面板。',
          'Provider 选择「OpenAI Compatible」，Base URL 填入上方地址，API Key 填任意非空占位字符（如 innerhop-local）。',
          'Model ID 填入 innerhop（随首页配置动态变化）或 ih:<策略id> 锁定特定搭配。',
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
      const env = isRecord(json.env) ? { ...(json.env as Record<string, string>) } : {};
      env.ANTHROPIC_BASE_URL = baseUrl;
      json.env = env;
      writeFileSync(target, JSON.stringify(json, null, 2), 'utf8');
    } else if (id === 'codex') {
      const target = this.getCodexConfigPath();
      mkdirSync(dirname(target), { recursive: true });
      this.saveBackupIfNeeded('codex', target);

      let raw = existsSync(target) ? readFileSync(target, 'utf8') : '';
      raw = this.stripManagedBlock(raw);
      const block = [
        MANAGED_MARKER_START,
        `[model_providers.innerhop]`,
        `name = "InnerHop"`,
        `base_url = "${baseUrl}/v1"`,
        `wire_api = "responses"`,
        `env_key = "OPENAI_API_KEY"`,
        '',
        `[profiles.innerhop]`,
        `model_provider = "innerhop"`,
        `model = "ih:${activePresetId}"`,
        MANAGED_MARKER_END,
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
      const providers = isRecord(json.provider) ? { ...json.provider } : {};
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
    } else if (id === 'dsh') {
      const target = this.getDshConfigTarget();
      mkdirSync(dirname(target.path), { recursive: true });
      this.saveBackupIfNeeded('dsh', target.path);

      const providerBlock = this.buildDshProviderBlock(activePresetId, presets);

      if (target.format === 'cordis') {
        let entries: CordisPatchEntry[] = [];
        if (existsSync(target.path)) {
          try {
            const parsed = parseYaml(readFileSync(target.path, 'utf8'));
            if (Array.isArray(parsed)) {
              entries = parsed as CordisPatchEntry[];
            }
          } catch {
            entries = [];
          }
        }

        let llmEntry = entries.find(
          (e) => isRecord(e) && (e.id === 'llm-pi-ai' || e.name === '@deepseek-ai/dsh-llm-pi-ai'),
        );
        if (!llmEntry) {
          llmEntry = { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: {} };
          entries.push(llmEntry);
        }
        const llmCfg = isRecord(llmEntry.config) ? { ...llmEntry.config } : {};
        const providers = isRecord(llmCfg.providers) ? { ...llmCfg.providers } : {};
        providers.innerhop = providerBlock;
        llmCfg.providers = providers;
        llmEntry.config = llmCfg;

        let defEntry = entries.find(
          (e) =>
            isRecord(e) &&
            (e.id === 'agent-default-model' || e.name === '@deepseek-ai/dsh-agent-default-model'),
        );
        if (!defEntry) {
          defEntry = {
            id: 'agent-default-model',
            name: '@deepseek-ai/dsh-agent-default-model',
            config: {},
          };
          entries.push(defEntry);
        }
        const defCfg = isRecord(defEntry.config) ? { ...defEntry.config } : {};
        defCfg.provider = 'innerhop';
        defCfg.model = 'innerhop';
        defEntry.config = defCfg;

        writeFileSync(target.path, stringifyYaml(entries), 'utf8');

        // Ensure INNERHOP_API_KEY exists inside ~/.dsh/.credentials.yaml without touching existing refs/records
        const credPath = this.getDshCredentialsPath();
        mkdirSync(dirname(credPath), { recursive: true });
        this.saveBackupIfNeeded('dsh-creds', credPath);

        let credDoc: Record<string, unknown> = { version: 1, refs: {} };
        if (existsSync(credPath)) {
          try {
            const parsedCred = parseYaml(readFileSync(credPath, 'utf8'));
            if (isRecord(parsedCred)) credDoc = { ...parsedCred };
          } catch {
            credDoc = { version: 1, refs: {} };
          }
        }
        const refs = isRecord(credDoc.refs) ? { ...credDoc.refs } : {};
        refs.INNERHOP_API_KEY = 'innerhop-local';
        if (credDoc.version === undefined) credDoc.version = 1;
        credDoc.refs = refs;
        writeFileSync(credPath, stringifyYaml(credDoc), 'utf8');
      } else {
        let settingsDoc: Record<string, unknown> = {};
        if (existsSync(target.path)) {
          try {
            const parsed = parseYaml(readFileSync(target.path, 'utf8'));
            if (isRecord(parsed)) settingsDoc = { ...parsed };
          } catch {
            settingsDoc = {};
          }
        }
        const llmCfg = isRecord(settingsDoc['llm-pi-ai']) ? { ...settingsDoc['llm-pi-ai'] } : {};
        const providers = isRecord(llmCfg.providers) ? { ...llmCfg.providers } : {};
        providers.innerhop = providerBlock;
        llmCfg.providers = providers;
        settingsDoc['llm-pi-ai'] = llmCfg;
        settingsDoc['agent-default-model'] = {
          provider: 'innerhop',
          model: 'innerhop',
        };
        writeFileSync(target.path, stringifyYaml(settingsDoc), 'utf8');

        const envPath = this.getDshEnvPath();
        mkdirSync(dirname(envPath), { recursive: true });
        this.saveBackupIfNeeded('dsh-env', envPath);
        const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
        const filteredLines = existingEnv
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0 && !l.startsWith('INNERHOP_API_KEY='));
        filteredLines.push('INNERHOP_API_KEY=innerhop-local');
        writeFileSync(envPath, `${filteredLines.join('\n')}\n`, 'utf8');
      }
    } else if (id === 'aider') {
      const target = this.getAiderConfigPath();
      mkdirSync(dirname(target), { recursive: true });
      this.saveBackupIfNeeded('aider', target);

      let raw = existsSync(target) ? readFileSync(target, 'utf8') : '';
      raw = this.stripManagedBlock(raw);
      const block = [
        MANAGED_MARKER_START,
        `openai-api-base: ${baseUrl}/v1`,
        `openai-api-key: innerhop-local`,
        `model: openai/innerhop`,
        MANAGED_MARKER_END,
      ].join('\n');
      const trimmedBase = raw.trimEnd();
      const next = trimmedBase ? `${trimmedBase}\n\n${block}\n` : `${block}\n`;
      writeFileSync(target, next, 'utf8');
    }

    return this.listStatuses(activePresetId);
  }

  syncEnabledHarnesses(activePresetId: string, presets: PresetConfig[]): void {
    const statuses = this.listStatuses(activePresetId);
    for (const s of statuses) {
      if (
        s.enabled &&
        (s.id === 'opencode' || s.id === 'codex' || s.id === 'dsh' || s.id === 'aider')
      ) {
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
          if (isRecord(json.env)) {
            delete json.env.ANTHROPIC_BASE_URL;
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
        writeFileSync(target, this.stripManagedBlock(raw), 'utf8');
      }
    } else if (id === 'opencode') {
      const target = this.getOpenCodeConfigPath();
      if (!this.restoreBackup('opencode', target) && existsSync(target)) {
        try {
          const json = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
          if (isRecord(json.provider)) {
            delete json.provider.innerhop;
            delete json.provider.orchestrator;
          }
          writeFileSync(target, JSON.stringify(json, null, 2), 'utf8');
        } catch {
          // ignore
        }
      }
    } else if (id === 'dsh') {
      const target = this.getDshConfigTarget();
      const restoredMain = this.restoreBackup('dsh', target.path);
      if (target.format === 'cordis') {
        const credPath = this.getDshCredentialsPath();
        const restoredCreds = this.restoreBackup('dsh-creds', credPath);
        if (!restoredMain && existsSync(target.path)) {
          try {
            const parsed = parseYaml(readFileSync(target.path, 'utf8'));
            if (Array.isArray(parsed)) {
              for (const entry of parsed) {
                if (
                  isRecord(entry) &&
                  (entry.id === 'llm-pi-ai' || entry.name === '@deepseek-ai/dsh-llm-pi-ai') &&
                  isRecord(entry.config) &&
                  isRecord(entry.config.providers)
                ) {
                  delete entry.config.providers.innerhop;
                }
              }
              writeFileSync(target.path, stringifyYaml(parsed), 'utf8');
            }
          } catch {
            // ignore
          }
        }
        if (!restoredCreds && existsSync(credPath)) {
          try {
            const parsedCred = parseYaml(readFileSync(credPath, 'utf8'));
            if (isRecord(parsedCred) && isRecord(parsedCred.refs)) {
              delete parsedCred.refs.INNERHOP_API_KEY;
              writeFileSync(credPath, stringifyYaml(parsedCred), 'utf8');
            }
          } catch {
            // ignore
          }
        }
      } else {
        const envPath = this.getDshEnvPath();
        const restoredEnv = this.restoreBackup('dsh-env', envPath);
        if (!restoredMain && existsSync(target.path)) {
          try {
            const parsed = parseYaml(readFileSync(target.path, 'utf8'));
            if (isRecord(parsed) && isRecord(parsed['llm-pi-ai']) && isRecord(parsed['llm-pi-ai'].providers)) {
              delete parsed['llm-pi-ai'].providers.innerhop;
              writeFileSync(target.path, stringifyYaml(parsed), 'utf8');
            }
          } catch {
            // ignore
          }
        }
        if (!restoredEnv && existsSync(envPath)) {
          const filtered = readFileSync(envPath, 'utf8')
            .split(/\r?\n/)
            .filter((l) => !l.startsWith('INNERHOP_API_KEY='))
            .join('\n');
          writeFileSync(envPath, filtered, 'utf8');
        }
      }
    } else if (id === 'aider') {
      const target = this.getAiderConfigPath();
      if (!this.restoreBackup('aider', target) && existsSync(target)) {
        const raw = readFileSync(target, 'utf8');
        writeFileSync(target, this.stripManagedBlock(raw), 'utf8');
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

  private stripManagedBlock(raw: string): string {
    let cleaned = this.stripMarkerPair(raw, MANAGED_MARKER_START, MANAGED_MARKER_END);
    cleaned = this.stripMarkerPair(cleaned, LEGACY_CODEX_MARKER_START, LEGACY_CODEX_MARKER_END);
    return cleaned;
  }
}
