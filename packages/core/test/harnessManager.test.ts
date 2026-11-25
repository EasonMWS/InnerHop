import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultConfig, HarnessManager } from '../src/index.js';

describe('HarnessManager Safe Backup & Restore', () => {
  let tmpHome: string;
  let tmpData: string;
  let manager: HarnessManager;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'orch-home-'));
    tmpData = mkdtempSync(join(tmpdir(), 'orch-data-'));
    manager = new HarnessManager({ homeDir: tmpHome, dataDir: tmpData, port: 8787 });
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpData, { recursive: true, force: true });
  });

  it('backs up and restores Claude Code settings.json byte-for-byte', () => {
    const claudeDir = join(tmpHome, '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    mkdirSync(claudeDir, { recursive: true });
    const original = JSON.stringify({ theme: 'dark', env: { CUSTOM_VAR: '1' } }, null, 2);
    writeFileSync(settingsPath, original, 'utf8');

    const afterEnable = manager.enableHarness('claude-code', 'claude-flagship-workhorse');
    expect(afterEnable.find((h) => h.id === 'claude-code')?.enabled).toBe(true);
    const modified = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(modified.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8787');
    expect(modified.env.CUSTOM_VAR).toBe('1');

    const afterDisable = manager.disableHarness('claude-code', 'claude-flagship-workhorse');
    expect(afterDisable.find((h) => h.id === 'claude-code')?.enabled).toBe(false);
    expect(readFileSync(settingsPath, 'utf8')).toBe(original);
  });

  it('creates and removes Codex config.toml cleanly with API key auth when previously absent', () => {
    const codexPath = join(tmpHome, '.codex', 'config.toml');
    expect(existsSync(codexPath)).toBe(false);

    manager.enableHarness('codex', 'claude-flagship-workhorse');
    expect(existsSync(codexPath)).toBe(true);
    const codexToml = readFileSync(codexPath, 'utf8');
    expect(codexToml).toContain('http://127.0.0.1:8787/v1');
    expect(codexToml).toContain('env_key = "OPENAI_API_KEY"');
    expect(codexToml).not.toContain('requires_openai_auth');

    manager.disableHarness('codex', 'claude-flagship-workhorse');
    expect(existsSync(codexPath)).toBe(false);
  });

  it('backs up and restores OpenCode opencode.json cleanly', () => {
    const ocDir = join(tmpHome, '.config', 'opencode');
    const ocPath = join(ocDir, 'opencode.json');
    mkdirSync(ocDir, { recursive: true });
    const original = '{"$schema":"https://opencode.ai/config.json"}';
    writeFileSync(ocPath, original, 'utf8');

    const def = createDefaultConfig();
    manager.enableHarness('opencode', 'claude-flagship-workhorse', def.presets);
    const modified = JSON.parse(readFileSync(ocPath, 'utf8')) as {
      provider?: { innerhop?: { models?: Record<string, unknown> } };
    };
    expect(modified.provider?.innerhop).toBeDefined();
    expect(modified.provider?.innerhop?.models?.['innerhop']).toBeDefined();
    for (const p of def.presets) {
      expect(modified.provider?.innerhop?.models?.[`ih:${p.id}`]).toBeDefined();
    }

    manager.disableHarness('opencode', 'claude-flagship-workhorse');
    expect(readFileSync(ocPath, 'utf8')).toBe(original);
  });

  it('appends Codex profile at end of existing config.toml without breaking top-level keys or Desktop app', () => {
    const codexDir = join(tmpHome, '.codex');
    const codexPath = join(codexDir, 'config.toml');
    mkdirSync(codexDir, { recursive: true });
    const original = [
      'model = "gpt-6-astra"',
      'sandbox_mode = "workspace-write"',
      '',
      '[desktop]',
      'appearanceTheme = "light"',
      '',
      "[projects.'d:\\work']",
      'trust_level = "trusted"',
      '',
    ].join('\n');
    writeFileSync(codexPath, original, 'utf8');

    manager.enableHarness('codex', 'claude-flagship-workhorse');
    const updated = readFileSync(codexPath, 'utf8');
    // Top-level keys must stay above [desktop]
    expect(updated.indexOf('model = "gpt-6-astra"')).toBeLessThan(updated.indexOf('[desktop]'));
    expect(updated.indexOf('[desktop]')).toBeLessThan(updated.indexOf('[model_providers.innerhop]'));
    expect(updated).toContain('[profiles.innerhop]');
    // Must not inject top-level model_provider outside [profiles.innerhop]
    const beforeDesktop = updated.slice(0, updated.indexOf('[desktop]'));
    expect(beforeDesktop).not.toContain('model_provider');

    manager.disableHarness('codex', 'claude-flagship-workhorse');
    expect(readFileSync(codexPath, 'utf8')).toBe(original);
  });

  it('replaces legacy ORCHESTRATOR Codex block cleanly on enable', () => {
    const codexDir = join(tmpHome, '.codex');
    const codexPath = join(codexDir, 'config.toml');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      codexPath,
      [
        'model = "gpt-6-astra"',
        '',
        '# >>> ORCHESTRATOR MANAGED START >>>',
        '[model_providers.orchestrator]',
        'name = "Orchestrator"',
        '# <<< ORCHESTRATOR MANAGED END <<<',
        '',
      ].join('\n'),
      'utf8',
    );

    manager.enableHarness('codex', 'claude-flagship-workhorse');
    const updated = readFileSync(codexPath, 'utf8');
    expect(updated).not.toContain('ORCHESTRATOR MANAGED');
    expect(updated).toContain('[model_providers.innerhop]');
    expect(updated).toContain('[profiles.innerhop]');
  });

  it('lists one-click harnesses with explicit surfaces plus Claude Desktop Gateway and 其他 Harness entries', () => {
    const statuses = manager.listStatuses('claude-flagship-workhorse');
    expect(statuses.map((s) => s.id)).toEqual([
      'opencode',
      'dsh',
      'claude-code',
      'claude-desktop',
      'codex',
      'aider',
      'other',
    ]);
    expect(statuses.find((s) => s.id === 'opencode')?.surface).toBe('gui-and-cli');
    expect(statuses.find((s) => s.id === 'dsh')?.surface).toBe('gui-and-cli');
    expect(statuses.find((s) => s.id === 'claude-code')?.surface).toBe('gui-and-cli');
    expect(statuses.find((s) => s.id === 'claude-desktop')?.mode).toBe('one-click');
    expect(statuses.find((s) => s.id === 'claude-desktop')?.surface).toBe('gui-and-cli');
    expect(statuses.find((s) => s.id === 'claude-desktop')?.copyConfig?.baseUrl).toBe('http://127.0.0.1:8787');
    expect(statuses.find((s) => s.id === 'codex')?.surface).toBe('cli-only');
    expect(statuses.find((s) => s.id === 'aider')?.surface).toBe('cli-only');

    const other = statuses.find((s) => s.id === 'other');
    expect(other?.name).toBe('其他 Harness');
    expect(other?.mode).toBe('manual-guide');
    expect(other?.surface).toBe('gui-manual');
    expect(other?.copyConfig?.baseUrl).toBe('http://127.0.0.1:8787/v1');
  });

  it('deploys DSH cordis.patch.yml + .credentials.yaml preserving existing providers and restores byte-for-byte', () => {
    const dshDesktopDir = join(tmpHome, '.dsh', 'profiles', 'desktop');
    const patchPath = join(dshDesktopDir, 'cordis.patch.yml');
    const credPath = join(tmpHome, '.dsh', '.credentials.yaml');
    mkdirSync(dshDesktopDir, { recursive: true });

    const originalPatch = [
      '- id: llm-pi-ai',
      '  name: "@deepseek-ai/dsh-llm-pi-ai"',
      '  config:',
      '    providers:',
      '      bailian:',
      '        api: openai-completions',
      '        baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1',
      '- id: ui-chat',
      '  name: "@deepseek-ai/dsh-client-ui-chat"',
      '  config:',
      '    transcriptView: standard',
      '',
    ].join('\n');
    const originalCreds = [
      'version: 1',
      'records:',
      '  client-connection/browser-session:',
      '    kind: secret',
      'refs:',
      '  DEEPSEEK_API_KEY: ds-keep-me',
      '',
    ].join('\n');
    writeFileSync(patchPath, originalPatch, 'utf8');
    writeFileSync(credPath, originalCreds, 'utf8');

    const def = createDefaultConfig();
    const afterEnable = manager.enableHarness('dsh', 'claude-flagship-workhorse', def.presets);
    const dshStatus = afterEnable.find((h) => h.id === 'dsh');
    expect(dshStatus?.enabled).toBe(true);
    expect(dshStatus?.installed).toBe(true);

    const updatedPatch = readFileSync(patchPath, 'utf8');
    expect(updatedPatch).toContain('bailian');
    expect(updatedPatch).toContain('ui-chat');
    expect(updatedPatch).toContain('innerhop');
    expect(updatedPatch).toContain('http://127.0.0.1:8787/v1');
    expect(updatedPatch).toContain('agent-default-model');
    expect(updatedPatch).toContain('ih:claude-flagship-workhorse');

    const updatedCreds = readFileSync(credPath, 'utf8');
    expect(updatedCreds).toContain('DEEPSEEK_API_KEY: ds-keep-me');
    expect(updatedCreds).toContain('INNERHOP_API_KEY: innerhop-local');
    expect(updatedCreds).toContain('client-connection/browser-session');

    const afterDisable = manager.disableHarness('dsh', 'claude-flagship-workhorse');
    expect(afterDisable.find((h) => h.id === 'dsh')?.enabled).toBe(false);
    expect(readFileSync(patchPath, 'utf8')).toBe(originalPatch);
    expect(readFileSync(credPath, 'utf8')).toBe(originalCreds);
  });

  it('deploys DSH legacy settings.yaml + .env and restores cleanly', () => {
    const dshRoot = join(tmpHome, '.dsh');
    const settingsPath = join(dshRoot, 'settings.yaml');
    const envPath = join(dshRoot, '.env');
    mkdirSync(dshRoot, { recursive: true });
    const originalYaml = 'ui:\n  theme: light\n';
    writeFileSync(settingsPath, originalYaml, 'utf8');
    writeFileSync(envPath, 'EXISTING_KEY=abc\n', 'utf8');

    const afterEnable = manager.enableHarness('dsh', 'claude-flagship-workhorse');
    expect(afterEnable.find((h) => h.id === 'dsh')?.enabled).toBe(true);
    expect(readFileSync(settingsPath, 'utf8')).toContain('http://127.0.0.1:8787/v1');
    expect(readFileSync(envPath, 'utf8')).toContain('INNERHOP_API_KEY=innerhop-local');
    expect(readFileSync(envPath, 'utf8')).toContain('EXISTING_KEY=abc');

    const afterDisable = manager.disableHarness('dsh', 'claude-flagship-workhorse');
    expect(afterDisable.find((h) => h.id === 'dsh')?.enabled).toBe(false);
    expect(readFileSync(settingsPath, 'utf8')).toBe(originalYaml);
    expect(readFileSync(envPath, 'utf8')).toBe('EXISTING_KEY=abc\n');
  });

  it('deploys and restores ~/.aider.conf.yml cleanly', () => {
    const aiderPath = join(tmpHome, '.aider.conf.yml');
    const original = 'dark-mode: true\n';
    writeFileSync(aiderPath, original, 'utf8');

    const afterEnable = manager.enableHarness('aider', 'claude-flagship-workhorse');
    expect(afterEnable.find((h) => h.id === 'aider')?.enabled).toBe(true);
    const updated = readFileSync(aiderPath, 'utf8');
    expect(updated).toContain('dark-mode: true');
    expect(updated).toContain('openai-api-base: http://127.0.0.1:8787/v1');
    expect(updated).toContain('model: openai/innerhop');

    const afterDisable = manager.disableHarness('aider', 'claude-flagship-workhorse');
    expect(afterDisable.find((h) => h.id === 'aider')?.enabled).toBe(false);
    expect(readFileSync(aiderPath, 'utf8')).toBe(original);
  });

  it('exports official Claude Desktop Gateway JSON and toggles Claude-3p cleanly with lossless restore', () => {
    const baseRoot =
      process.platform === 'win32'
        ? join(tmpHome, 'AppData', 'Local')
        : process.platform === 'darwin'
          ? join(tmpHome, 'Library', 'Application Support')
          : join(tmpHome, '.config');
    const c1pDir =
      process.platform === 'win32'
        ? join(baseRoot, 'Claude-Data', 'claude_testpkg')
        : join(baseRoot, 'Claude');
    const c3pDir = join(baseRoot, 'Claude-3p');
    const c3pDisabledDir = join(baseRoot, 'Claude-3p.innerhop-disabled');

    mkdirSync(c1pDir, { recursive: true });
    mkdirSync(join(c3pDir, 'configLibrary'), { recursive: true });
    writeFileSync(
      join(c3pDir, 'configLibrary', '_meta.json'),
      JSON.stringify({ appliedId: 'innerhop', entries: [{ id: 'innerhop', name: 'InnerHop' }] }),
      'utf8',
    );

    // Initially active because Claude-3p/configLibrary/_meta.json exists
    const initial = manager.listStatuses('claude-flagship-workhorse');
    expect(initial.find((h) => h.id === 'claude-desktop')?.enabled).toBe(true);

    // One-click disable restores 1P by moving Claude-3p -> Claude-3p.innerhop-disabled
    const afterDisable = manager.disableHarness('claude-desktop', 'claude-flagship-workhorse');
    expect(afterDisable.find((h) => h.id === 'claude-desktop')?.enabled).toBe(false);
    expect(existsSync(c3pDir)).toBe(false);
    expect(existsSync(c3pDisabledDir)).toBe(true);

    // One-click re-enable moves Claude-3p.innerhop-disabled back, exports JSON, and enables allowDevTools
    const afterEnable = manager.enableHarness('claude-desktop', 'claude-flagship-workhorse');
    expect(afterEnable.find((h) => h.id === 'claude-desktop')?.enabled).toBe(true);
    expect(existsSync(c3pDir)).toBe(true);
    expect(existsSync(c3pDisabledDir)).toBe(false);

    const exported = JSON.parse(
      readFileSync(join(tmpData, 'claude-desktop-gateway.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(exported.inferenceProvider).toBe('gateway');
    expect(exported.inferenceGatewayBaseUrl).toBe('http://127.0.0.1:8787');
    expect(exported.inferenceGatewayApiKey).toBe('innerhop-local');

    const devSettings = JSON.parse(
      readFileSync(join(c1pDir, 'developer_settings.json'), 'utf8'),
    ) as { allowDevTools?: boolean };
    expect(devSettings.allowDevTools).toBe(true);
  });

  it('detects DSH as enabled when a custom provider key points to 127.0.0.1:8787', () => {
    const dshDesktopDir = join(tmpHome, '.dsh', 'profiles', 'desktop');
    const patchPath = join(dshDesktopDir, 'cordis.patch.yml');
    mkdirSync(dshDesktopDir, { recursive: true });
    writeFileSync(
      patchPath,
      [
        '- id: llm-pi-ai',
        '  name: "@deepseek-ai/dsh-llm-pi-ai"',
        '  config:',
        '    providers:',
        '      my-local:',
        '        baseURL: http://127.0.0.1:8787/v1',
        '        models:',
        '          - id: innerhop',
        '            name: innerhop',
      ].join('\n'),
      'utf8',
    );

    const statuses = manager.listStatuses('claude-flagship-workhorse');
    expect(statuses.find((h) => h.id === 'dsh')?.enabled).toBe(true);
  });
});
