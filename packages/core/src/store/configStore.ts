import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { OrchestratorConfig, PresetConfig, ProviderType } from '../types.js';

export const CUSTOM_PRESET_ID = '__custom__';

const ALLOWED_PROVIDER_TYPES = new Set<ProviderType>([
  'anthropic',
  'openai-compat',
  'openai-responses',
  'google-gemini',
]);

const REMOVED_LEGACY_IDS = new Set([
  'mock-demo',
  'anthropic-passthrough',
  'codex-chatgpt-passthrough',
  'default-demo',
  'claude-opus-sonnet',
  'codex-chatgpt-sub',
]);

export function migrateLegacyDataDirIfNeeded(targetDir: string, legacyDir: string): boolean {
  const targetConfig = join(targetDir, 'config.json');
  const legacyConfig = join(legacyDir, 'config.json');
  if (existsSync(targetConfig) || !existsSync(legacyConfig)) {
    return false;
  }
  try {
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(legacyConfig, targetConfig);
    const legacySessions = join(legacyDir, 'sessions.json');
    if (existsSync(legacySessions)) {
      copyFileSync(legacySessions, join(targetDir, 'sessions.json'));
    }
    const legacyBackups = join(legacyDir, 'backups');
    if (existsSync(legacyBackups)) {
      const targetBackups = join(targetDir, 'backups');
      mkdirSync(targetBackups, { recursive: true });
      for (const entry of readdirSync(legacyBackups)) {
        copyFileSync(join(legacyBackups, entry), join(targetBackups, entry));
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function getDefaultDataDir(): string {
  if (process.env.INNERHOP_DATA_DIR) return process.env.INNERHOP_DATA_DIR;
  if (process.env.ORCHESTRATOR_DATA_DIR) return process.env.ORCHESTRATOR_DATA_DIR;
  const target = join(homedir(), '.innerhop');
  const legacy = join(homedir(), '.orchestrator');
  migrateLegacyDataDirIfNeeded(target, legacy);
  return target;
}

export function createDefaultConfig(): OrchestratorConfig {
  return {
    port: 8787,
    host: '127.0.0.1',
    activePresetId: 'claude-flagship-workhorse',
    routing: {
      mode: 'smart-split',
      triggerModelPatterns: ['opus', 'opusplan'],
      bypassAnthropicBaseUrl: 'https://api.anthropic.com',
      bypassOpenAIBaseUrl: 'https://api.openai.com/v1',
    },
    providers: [
      {
        id: 'anthropic-api',
        name: 'Anthropic API',
        type: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: '',
      },
      {
        id: 'openai-api',
        name: 'OpenAI API',
        type: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
      },
      {
        id: 'google-gemini',
        name: 'Google Gemini (OpenAI 兼容接口)',
        type: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: '',
      },
      {
        id: 'deepseek-api',
        name: 'DeepSeek API',
        type: 'openai-compat',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
      },
      {
        id: 'openrouter-api',
        name: 'OpenRouter',
        type: 'openai-compat',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: '',
      },
      {
        id: 'ollama-local',
        name: 'Ollama 本地模型',
        type: 'openai-compat',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama',
      },
    ],
    presets: [
      {
        id: 'claude-flagship-workhorse',
        name: 'Claude 旗舰搭配（Opus 5.5 + Sonnet 5.5）',
        description: 'Anthropic API：Opus 5.5 负责只读架构设计，Sonnet 5.5 负责高速写码与跑测试。',
        planner: {
          providerId: 'anthropic-api',
          modelId: 'claude-opus-5-5',
          inputPricePerM: 4,
          outputPricePerM: 20,
        },
        executor: {
          providerId: 'anthropic-api',
          modelId: 'claude-sonnet-5-5',
          inputPricePerM: 2,
          outputPricePerM: 10,
        },
        rules: {
          readOnlyPlanning: true,
          maxConsecutiveErrors: 2,
          reviewEverySteps: 10,
          maxHopsPerRequest: 2,
          inlineStatusBadge: false,
        },
      },
      {
        id: 'openai-flagship-workhorse',
        name: 'OpenAI 旗舰搭配（GPT-6.2 Astra + GPT-6.2 Sol）',
        description: 'OpenAI API：GPT-6.2 Astra 负责复杂工程设计，GPT-6.2 Sol 负责生产级落地执行。',
        planner: {
          providerId: 'openai-api',
          modelId: 'gpt-6.2-astra',
          inputPricePerM: 8,
          outputPricePerM: 40,
        },
        executor: {
          providerId: 'openai-api',
          modelId: 'gpt-6.2-sol',
          inputPricePerM: 2,
          outputPricePerM: 10,
        },
        rules: {
          readOnlyPlanning: true,
          maxConsecutiveErrors: 2,
          reviewEverySteps: 10,
          maxHopsPerRequest: 2,
          inlineStatusBadge: false,
        },
      },
      {
        id: 'cross-vendor-save',
        name: '跨厂商省钱搭配（Opus 5.5 + DeepSeek Flash）',
        description: '强推理模型定方案，超低成本 DeepSeek Flash 落地编码，连续报错自动请架构师复盘。',
        planner: {
          providerId: 'anthropic-api',
          modelId: 'claude-opus-5-5',
          inputPricePerM: 4,
          outputPricePerM: 20,
        },
        executor: {
          providerId: 'deepseek-api',
          modelId: 'deepseek-flash',
          inputPricePerM: 0.27,
          outputPricePerM: 1.1,
        },
        rules: {
          readOnlyPlanning: true,
          maxConsecutiveErrors: 2,
          reviewEverySteps: 8,
          maxHopsPerRequest: 2,
          inlineStatusBadge: false,
        },
      },
    ],
  };
}

export function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmpPath, filePath);
  if (process.platform !== 'win32') {
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // ignore on filesystems without POSIX permissions
    }
  }
}

export class ConfigStore extends EventEmitter {
  private readonly filePath: string;
  private config: OrchestratorConfig;

  constructor(dataDir: string = getDefaultDataDir()) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, 'config.json');
    this.config = this.loadOrInit();
  }

  private loadOrInit(): OrchestratorConfig {
    if (!existsSync(this.filePath)) {
      const def = createDefaultConfig();
      atomicWriteJson(this.filePath, def);
      return def;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<OrchestratorConfig>;
      const def = createDefaultConfig();

      const filteredProviders = (parsed.providers ?? []).filter(
        (p) =>
          p &&
          !REMOVED_LEGACY_IDS.has(p.id) &&
          ALLOWED_PROVIDER_TYPES.has(p.type as ProviderType),
      );
      const providers = filteredProviders.length > 0 ? filteredProviders : [...def.providers];
      const providerIdSet = new Set(providers.map((p) => p.id));

      const filteredPresets = (parsed.presets ?? []).filter(
        (p) =>
          p &&
          !REMOVED_LEGACY_IDS.has(p.id) &&
          providerIdSet.has(p.planner?.providerId) &&
          providerIdSet.has(p.executor?.providerId),
      );
      const presets = filteredPresets.length > 0 ? filteredPresets : [...def.presets];

      const rawActive = parsed.activePresetId ?? def.activePresetId;
      const validCustom =
        rawActive === CUSTOM_PRESET_ID &&
        parsed.customPair &&
        providerIdSet.has(parsed.customPair.planner?.providerId) &&
        providerIdSet.has(parsed.customPair.executor?.providerId);

      const activePresetId = validCustom
        ? CUSTOM_PRESET_ID
        : presets.some((p) => p.id === rawActive)
          ? rawActive
          : presets[0].id;

      const {
        bypassAnthropicBaseUrl,
        bypassOpenAIBaseUrl,
        mode,
        triggerModelPatterns,
      } = { ...def.routing, ...(parsed.routing ?? {}) };

      const migrated: OrchestratorConfig = {
        port: parsed.port ?? def.port,
        host: parsed.host ?? def.host,
        activePresetId,
        ...(validCustom && parsed.customPair ? { customPair: parsed.customPair } : {}),
        routing: {
          mode,
          triggerModelPatterns,
          bypassAnthropicBaseUrl,
          bypassOpenAIBaseUrl,
        },
        providers,
        presets,
      };
      return migrated;
    } catch {
      const def = createDefaultConfig();
      atomicWriteJson(this.filePath, def);
      return def;
    }
  }

  getConfig(): OrchestratorConfig {
    return structuredClone(this.config);
  }

  updateConfig(next: OrchestratorConfig): OrchestratorConfig {
    this.config = structuredClone(next);
    atomicWriteJson(this.filePath, this.config);
    this.emit('config_update', this.getConfig());
    return this.getConfig();
  }

  resolvePreset(requestedModel?: string): PresetConfig {
    const prefix = requestedModel?.startsWith('ih:')
      ? 'ih:'
      : requestedModel?.startsWith('orch:')
        ? 'orch:'
        : null;
    if (requestedModel && prefix) {
      const presetId = requestedModel.slice(prefix.length);
      if (presetId === CUSTOM_PRESET_ID && this.config.customPair) {
        return {
          id: CUSTOM_PRESET_ID,
          name: '自定义',
          description: '首页手动配置的自定义模型组合',
          planner: structuredClone(this.config.customPair.planner),
          executor: structuredClone(this.config.customPair.executor),
          rules: structuredClone(this.config.customPair.rules),
        };
      }
      const match = this.config.presets.find((p) => p.id === presetId);
      if (match) return structuredClone(match);
    }

    if (this.config.activePresetId === CUSTOM_PRESET_ID && this.config.customPair) {
      return {
        id: CUSTOM_PRESET_ID,
        name: '自定义',
        description: '首页手动配置的自定义模型组合',
        planner: structuredClone(this.config.customPair.planner),
        executor: structuredClone(this.config.customPair.executor),
        rules: structuredClone(this.config.customPair.rules),
      };
    }

    const active = this.config.presets.find((p) => p.id === this.config.activePresetId);
    return structuredClone(active ?? this.config.presets[0]);
  }

  getPresetById(id: string): PresetConfig {
    if (id === CUSTOM_PRESET_ID && this.config.customPair) {
      return {
        id: CUSTOM_PRESET_ID,
        name: '自定义',
        description: '首页手动配置的自定义模型组合',
        planner: structuredClone(this.config.customPair.planner),
        executor: structuredClone(this.config.customPair.executor),
        rules: structuredClone(this.config.customPair.rules),
      };
    }
    return this.config.presets.find((p) => p.id === id) ?? this.config.presets[0];
  }

  getProvider(id: string) {
    return this.config.providers.find((p) => p.id === id);
  }

  shouldOrchestrate(requestedModel?: string): boolean {
    if (this.config.routing.mode === 'all') {
      return true;
    }
    const m = (requestedModel ?? '').trim().toLowerCase();
    if (
      !m ||
      m === 'innerhop' ||
      m.startsWith('ih:') ||
      m === 'orchestrator' ||
      m.startsWith('orch:')
    ) {
      return true;
    }
    return this.config.routing.triggerModelPatterns.some((pattern) => {
      const p = pattern.trim().toLowerCase();
      return p.length > 0 && m.includes(p);
    });
  }
}
