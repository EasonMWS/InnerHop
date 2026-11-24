export type Locale = 'zh' | 'en';

const LOCALE_STORAGE_KEY = 'orch_locale_v1';

export function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // ignore storage errors
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  return 'en';
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

export function localizeProviderName(id: string, fallbackName: string, locale: Locale): string {
  if (locale === 'zh') return fallbackName;
  switch (id) {
    case 'anthropic-api':
      return 'Anthropic API';
    case 'openai-api':
      return 'OpenAI API';
    case 'google-gemini':
      return 'Google Gemini (OpenAI Compat)';
    case 'deepseek-api':
      return 'DeepSeek API';
    case 'openrouter-api':
      return 'OpenRouter';
    case 'ollama-local':
      return 'Ollama (Local)';
    default:
      return fallbackName === '自定义中转站 (OpenAI 兼容)'
        ? 'Custom Relay (OpenAI Compat)'
        : fallbackName;
  }
}

export function localizePreset(
  id: string,
  zhName: string,
  zhDesc: string,
  locale: Locale,
): { name: string; description: string } {
  if (locale === 'zh') return { name: zhName, description: zhDesc };
  switch (id) {
    case 'claude-flagship-workhorse':
      return {
        name: 'Claude Flagship Pair (Opus 5.5 + Sonnet 5.5)',
        description:
          'Anthropic API: Opus 5.5 handles read-only architecture planning; Sonnet 5.5 writes code and runs tests.',
      };
    case 'openai-flagship-workhorse':
      return {
        name: 'OpenAI Flagship Pair (GPT-6.2 Astra + GPT-6.2 Sol)',
        description:
          'OpenAI API: GPT-6.2 Astra designs architecture; GPT-6.2 Sol executes edits and verification.',
      };
    case 'cross-vendor-save':
      return {
        name: 'Cross-Vendor Cost Saver (Opus 5.5 + DeepSeek Flash)',
        description:
          'Frontier planner writes the plan; ultra-low-cost DeepSeek Flash executes edits and auto-escalates on errors.',
      };
    default:
      return { name: zhName, description: zhDesc };
  }
}

export function localizeHarnessText(
  id: string,
  zhName: string,
  zhDesc: string,
  zhSteps: string[] | undefined,
  locale: Locale,
): { name: string; description: string; guideSteps?: string[] } {
  if (locale === 'zh') {
    return { name: zhName, description: zhDesc, guideSteps: zhSteps };
  }
  switch (id) {
    case 'claude-code':
      return {
        name: 'Claude Code',
        description:
          'Anthropic terminal coding agent (uses standard ANTHROPIC_API_KEY, supports Smart-Split routing)',
      };
    case 'codex':
      return {
        name: 'OpenAI Codex CLI',
        description:
          'Writes an isolated [profiles.orchestrator] without touching the official Codex/ChatGPT Desktop app; run `codex -p orchestrator`',
      };
    case 'opencode':
      return {
        name: 'OpenCode',
        description:
          'Open-source multi-model terminal coding agent (injects orchestrator provider & strategy aliases)',
      };
    case 'other':
      return {
        name: 'Other Harnesses',
        description:
          'Cline, Roo Code, Cursor, Windsurf, Aider, or any OpenAI-Compatible client — point it to the local endpoint below',
        guideSteps: [
          'Open your tool’s custom API / Model Provider settings.',
          'Set Provider to "OpenAI Compatible", paste the Base URL above, and put any non-empty placeholder API Key (e.g. orchestrator-local).',
          'Set Model ID to "orchestrator" (follows active Home configuration) or a pinned strategy ID like "orch:<id>". Aider users can also run `orch run aider`.',
        ],
      };
    default:
      return { name: zhName, description: zhDesc, guideSteps: zhSteps };
  }
}

export function localizeHarnessLabel(hint: string, locale: Locale): string {
  const enMap: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex CLI',
    opencode: 'OpenCode',
    cline: 'Cline',
    'roo-code': 'Roo Code',
    cursor: 'Cursor',
    aider: 'Aider',
    other: 'Other Tool',
    generic: 'External Client',
  };
  const zhMap: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex CLI',
    opencode: 'OpenCode',
    cline: 'Cline',
    'roo-code': 'Roo Code',
    cursor: 'Cursor',
    aider: 'Aider',
    other: '其他工具',
    generic: '外部工具',
  };
  return (locale === 'en' ? enMap[hint] : zhMap[hint]) ?? (locale === 'en' ? 'External Client' : '外部工具');
}
