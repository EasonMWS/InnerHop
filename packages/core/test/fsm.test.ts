import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendSystemAddendumPreservingCache,
  ConfigStore,
  filterReadOnlyTools,
  OrchestratorFsm,
  sanitizeMessagesForTarget,
  SessionStore,
  type CanonicalRequest,
} from '../src/index.js';

describe('OrchestratorFsm & Protocol Helpers', () => {
  let tmpDir: string;
  let configStore: ConfigStore;
  let sessionStore: SessionStore;
  let fsm: OrchestratorFsm;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orch-fsm-test-'));
    configStore = new ConfigStore(tmpDir);
    sessionStore = new SessionStore(tmpDir);
    fsm = new OrchestratorFsm(sessionStore);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('filters out write/mutating tools during PLANNING phase', () => {
    const tools = [
      { name: 'Read', inputSchema: {} },
      { name: 'Grep', inputSchema: {} },
      { name: 'Edit', inputSchema: {} },
      { name: 'Write', inputSchema: {} },
      { name: 'apply_patch', inputSchema: {} },
      { name: 'bash', inputSchema: {} },
      { name: 'run_tests', inputSchema: {} },
    ];
    const readOnly = filterReadOnlyTools(tools).map((t) => t.name);
    expect(readOnly).toEqual(['Read', 'Grep', 'run_tests']);
  });

  it('strips foreign thinking signatures when switching models', () => {
    const messages = [
      {
        role: 'assistant' as const,
        parts: [
          { type: 'thinking' as const, thinking: 'secret thought', signature: 'sig-opus-123' },
          { type: 'text' as const, text: 'Here is the plan.' },
        ],
      },
    ];

    const sameModel = sanitizeMessagesForTarget(
      messages,
      'claude-opus-4-1',
      'anthropic',
      'claude-opus-4-1',
    );
    expect(sameModel[0].parts.some((p) => p.type === 'thinking')).toBe(true);

    const switchedModel = sanitizeMessagesForTarget(
      messages,
      'claude-sonnet-4-5',
      'anthropic',
      'claude-opus-4-1',
    );
    expect(switchedModel[0].parts.some((p) => p.type === 'thinking')).toBe(false);
    expect(switchedModel[0].parts[0]).toEqual({ type: 'text', text: 'Here is the plan.' });
  });

  it('preserves earlier cached system blocks when appending orchestrator addendum', () => {
    const base = [
      { type: 'text' as const, text: 'Static system prefix', cacheControl: { type: 'ephemeral' } },
    ];
    const next = appendSystemAddendumPreservingCache(base, '<orchestrator_role>...</orchestrator_role>');
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(base[0]);
    expect(next[1].cacheControl).toBeUndefined();
  });

  it('escalates back to PLANNING after N consecutive tool errors', () => {
    const preset = configStore.getPresetById('claude-flagship-workhorse');
    preset.rules.maxConsecutiveErrors = 2;
    const session = sessionStore.getOrCreate('s1', preset.id, 'claude-code');
    fsm.onHandoff(session, { plan: 'Step 1', replan_if: 'test fails' }, preset);
    expect(session.phase).toBe('EXECUTING');

    const errReq = (): CanonicalRequest => ({
      protocol: 'anthropic',
      requestedModel: 'orchestrator',
      systemParts: [],
      messages: [
        {
          role: 'user',
          parts: [{ type: 'tool_result', toolUseId: 't1', content: 'exit code 1', isError: true }],
        },
      ],
      tools: [],
      stream: true,
      rawHeaders: {},
    });

    fsm.onIncomingRequest(session, errReq(), preset);
    expect(session.phase).toBe('EXECUTING');
    expect(session.consecutiveErrors).toBe(1);

    fsm.onIncomingRequest(session, errReq(), preset);
    expect(session.phase).toBe('PLANNING');
    expect(session.reviewReason).toBe('consecutive_errors');
    expect(session.escalationCount).toBe(1);
  });

  it('triggers step_checkpoint review after reviewEverySteps', () => {
    const preset = configStore.getPresetById('claude-flagship-workhorse');
    preset.rules.reviewEverySteps = 2;
    const session = sessionStore.getOrCreate('s2', preset.id, 'codex');
    fsm.onHandoff(session, { plan: 'Step 1' }, preset);

    const okReq = (): CanonicalRequest => ({
      protocol: 'anthropic',
      requestedModel: 'orchestrator',
      systemParts: [],
      messages: [
        {
          role: 'user',
          parts: [{ type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false }],
        },
      ],
      tools: [],
      stream: true,
      rawHeaders: {},
    });

    fsm.onIncomingRequest(session, okReq(), preset);
    expect(session.phase).toBe('EXECUTING');
    fsm.onIncomingRequest(session, okReq(), preset);
    expect(session.phase).toBe('PLANNING');
    expect(session.reviewReason).toBe('step_checkpoint');
  });

  it('re-enters PLANNING when user sends a new text message mid-execution', () => {
    const preset = configStore.getPresetById('claude-flagship-workhorse');
    const session = sessionStore.getOrCreate('s3', preset.id, 'opencode');
    fsm.onHandoff(session, { plan: 'Step 1' }, preset);
    expect(session.phase).toBe('EXECUTING');

    const userMsgReq: CanonicalRequest = {
      protocol: 'anthropic',
      requestedModel: 'orchestrator',
      systemParts: [],
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Actually use Postgres instead' }] }],
      tools: [],
      stream: true,
      rawHeaders: {},
    };

    fsm.onIncomingRequest(session, userMsgReq, preset);
    expect(session.phase).toBe('PLANNING');
    expect(session.reviewReason).toBe('user_message');
  });
});
