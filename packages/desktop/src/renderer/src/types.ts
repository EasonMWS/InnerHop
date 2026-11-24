import type {
  HarnessStatus,
  OrchestratorConfig,
  PresetConfig,
  ProviderConfig,
  ReasoningEffort,
  SessionState,
} from '@orchestrator/core';

export type {
  HarnessStatus,
  OrchestratorConfig,
  PresetConfig,
  ProviderConfig,
  ReasoningEffort,
  SessionState,
};

export interface EngineState {
  running: boolean;
  url: string;
}

export interface DesktopBridge {
  platform?: string;
  getEngineStatus: () => Promise<EngineState>;
  toggleEngine: () => Promise<EngineState>;
  openExternal: (url: string) => Promise<void>;
  onEngineStateChanged: (cb: (state: EngineState) => void) => () => void;
}

declare global {
  interface Window {
    orchestratorDesktop?: DesktopBridge;
  }
}
