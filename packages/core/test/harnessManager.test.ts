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
      provider?: { orchestrator?: { models?: Record<string, unknown> } };
    };
    expect(modified.provider?.orchestrator).toBeDefined();
    expect(modified.provider?.orchestrator?.models?.['orchestrator']).toBeDefined();
    for (const p of def.presets) {
      expect(modified.provider?.orchestrator?.models?.[`orch:${p.id}`]).toBeDefined();
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
    expect(updated.indexOf('[desktop]')).toBeLessThan(updated.indexOf('[model_providers.orchestrator]'));
    expect(updated).toContain('[profiles.orchestrator]');
    // Must not inject top-level model_provider outside [profiles.orchestrator]
    const beforeDesktop = updated.slice(0, updated.indexOf('[desktop]'));
    expect(beforeDesktop).not.toContain('model_provider');

    manager.disableHarness('codex', 'claude-flagship-workhorse');
    expect(readFileSync(codexPath, 'utf8')).toBe(original);
  });

  it('lists 3 one-click harnesses and 1 unified 其他 Harness entry', () => {
    const statuses = manager.listStatuses('claude-flagship-workhorse');
    expect(statuses.map((s) => s.id)).toEqual(['claude-code', 'codex', 'opencode', 'other']);
    const other = statuses.find((s) => s.id === 'other');
    expect(other?.name).toBe('其他 Harness');
    expect(other?.mode).toBe('manual-guide');
    expect(other?.copyConfig?.baseUrl).toBe('http://127.0.0.1:8787/v1');
  });
});
