import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { HarnessId, SessionState, TimelineEvent } from '../types.js';
import { atomicWriteJson, getDefaultDataDir } from './configStore.js';

export class SessionStore extends EventEmitter {
  private readonly filePath: string;
  private sessions: Map<string, SessionState> = new Map();

  constructor(dataDir: string = getDefaultDataDir()) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, 'sessions.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const arr = JSON.parse(raw) as SessionState[];
      for (const s of arr) {
        this.sessions.set(s.id, s);
      }
    } catch {
      // Ignore corrupt session cache
    }
  }

  private persist(): void {
    const arr = Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100);
    atomicWriteJson(this.filePath, arr);
  }

  get(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  list(): SessionState[] {
    return Array.from(this.sessions.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  getOrCreate(
    id: string,
    presetId: string,
    harnessHint: HarnessId | 'generic' = 'generic',
  ): SessionState {
    const existing = this.sessions.get(id);
    if (existing) {
      if (harnessHint !== 'generic' && existing.harnessHint === 'generic') {
        existing.harnessHint = harnessHint;
      }
      if (existing.presetId !== presetId) {
        existing.presetId = presetId;
      }
      return existing;
    }
    const now = new Date().toISOString();
    const created: SessionState = {
      id,
      harnessHint,
      presetId,
      phase: 'PLANNING',
      activePlan: null,
      replanIf: null,
      planVersion: 0,
      execSteps: 0,
      consecutiveErrors: 0,
      escalationCount: 0,
      reviewReason: null,
      lastErrorSummary: null,
      forcePlannerNext: false,
      lastAssistantModel: null,
      createdAt: now,
      updatedAt: now,
      usage: {
        plannerInput: 0,
        plannerOutput: 0,
        executorInput: 0,
        executorOutput: 0,
        actualCostUsd: 0,
        baselinePlannerCostUsd: 0,
      },
      timeline: [],
    };
    this.sessions.set(id, created);
    this.save(created);
    return created;
  }

  save(session: SessionState): SessionState {
    session.updatedAt = new Date().toISOString();
    if (session.timeline.length > 80) {
      session.timeline = session.timeline.slice(-80);
    }
    this.sessions.set(session.id, session);
    this.persist();
    this.emit('session_update', structuredClone(session));
    return session;
  }

  appendEvent(session: SessionState, event: Omit<TimelineEvent, 'id' | 'timestamp'>): TimelineEvent {
    const full: TimelineEvent = {
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    session.timeline.push(full);
    this.save(session);
    this.emit('timeline_event', { sessionId: session.id, event: full });
    return full;
  }

  delete(id: string): boolean {
    const ok = this.sessions.delete(id);
    if (ok) {
      this.persist();
      this.emit('session_deleted', id);
    }
    return ok;
  }

  clearAll(): void {
    this.sessions.clear();
    this.persist();
  }
}
