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
    case 'opencode':
      return {
        name: 'OpenCode',
        description:
          'Open-source multi-model coding client (Desktop GUI & terminal CLI; one-click injects innerhop provider and strategy aliases)',
      };
    case 'dsh':
      return {
        name: 'DeepSeek Harness (DSH)',
        description:
          'DeepSeek plugin-based Agent harness (Desktop GUI / Web / CLI; one-click injects provider & default model — restart DSH Desktop if already open)',
      };
    case 'claude-code':
      return {
        name: 'Claude Code CLI / Desktop Code',
        description:
          'One-click configures ~/.claude/settings.json for both terminal CLI and Claude Desktop Code tab (works with GPT + DeepSeek even without an Anthropic key).',
      };
    case 'claude-desktop':
      return {
        name: 'Claude Desktop (Official Gateway)',
        description:
          'One-click switch between InnerHop Gateway and Official Claude Pro (lossless backup of Claude-3p; first-time setup generates an official Import JSON file).',
        guideSteps: [
          'Toggle this card ON: InnerHop enables the Developer menu and writes an official import file at ~/.innerhop/claude-desktop-gateway.json.',
          'First time only: relaunch Claude Desktop → ☰ → Developer → Configure third-party inference → top-right dropdown "Import configuration..." → select that JSON → Apply Changes.',
          'One-click restore to Official Pro: toggle this card OFF and relaunch Claude Desktop. Next time you want InnerHop, just toggle ON and relaunch (no re-import needed).',
        ],
      };
    case 'codex':
      return {
        name: 'OpenAI Codex CLI',
        description:
          'Terminal CLI only (`codex -p innerhop` with OPENAI_API_KEY). Official ChatGPT / Codex Desktop consumer OAuth app stays untouched and unproxied.',
      };
    case 'aider':
      return {
        name: 'Aider CLI',
        description:
          'Terminal AI pair-programming tool (writes a clean managed block to ~/.aider.conf.yml with full backup/restore, or run `innerhop run aider`)',
      };
    case 'other':
      return {
        name: 'Other Harnesses',
        description:
          'Cline, Roo Code, Cursor, Windsurf, or any OpenAI-Compatible IDE/GUI plugin — copy the 3 settings below to connect',
        guideSteps: [
          'Open your tool’s custom API / Model Provider settings.',
          'Set Provider to "OpenAI Compatible", paste the Base URL above, and put any non-empty placeholder API Key (e.g. innerhop-local).',
          'Set Model ID to "innerhop" (follows active Home configuration) or a pinned strategy ID like "ih:<id>".',
        ],
      };
    default:
      return { name: zhName, description: zhDesc, guideSteps: zhSteps };
  }
}

export function localizeHarnessLabel(hint: string, locale: Locale): string {
  const enMap: Record<string, string> = {
    'claude-code': 'Claude Code',
    'claude-desktop': 'Claude Desktop',
    codex: 'Codex CLI',
    opencode: 'OpenCode',
    dsh: 'DeepSeek Harness (DSH)',
    cline: 'Cline',
    'roo-code': 'Roo Code',
    cursor: 'Cursor',
    aider: 'Aider CLI',
    other: 'Other Tool',
    generic: 'External Client',
  };
  const zhMap: Record<string, string> = {
    'claude-code': 'Claude Code',
    'claude-desktop': 'Claude Desktop',
    codex: 'Codex CLI',
    opencode: 'OpenCode',
    dsh: 'DeepSeek Harness (DSH)',
    cline: 'Cline',
    'roo-code': 'Roo Code',
    cursor: 'Cursor',
    aider: 'Aider CLI',
    other: '其他工具',
    generic: '外部工具',
  };
  return (locale === 'en' ? enMap[hint] : zhMap[hint]) ?? (locale === 'en' ? 'External Client' : '外部工具');
}
