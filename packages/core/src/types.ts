export type ProviderType =
  | 'anthropic'
  | 'openai-compat'
  | 'openai-responses'
  | 'google-gemini';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  defaultHeaders?: Record<string, string>;
}

export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelRef {
  providerId: string;
  modelId: string;
  /** Reasoning effort / thinking depth for this role */
  reasoningEffort?: ReasoningEffort;
  /** USD per 1M input tokens (optional, used for cost savings display) */
  inputPricePerM?: number;
  /** USD per 1M output tokens (optional, used for cost savings display) */
  outputPricePerM?: number;
}

export interface OrchestratorRules {
  /** Hide write/edit tools during PLANNING phase */
  readOnlyPlanning: boolean;
  /** Escalate back to Planner after N consecutive tool failures (0 = disabled) */
  maxConsecutiveErrors: number;
  /** Trigger periodic Planner review after N executor steps (0 = disabled) */
  reviewEverySteps: number;
  /** Max Inner-Hops inside a single HTTP turn to prevent infinite loops */
  maxHopsPerRequest: number;
  /** Emit lightweight status hint inside text stream when switching models */
  inlineStatusBadge: boolean;
}

export interface PresetConfig {
  id: string;
  name: string;
  description: string;
  planner: ModelRef;
  executor: ModelRef;
  rules: OrchestratorRules;
}

export type RoutingMode = 'all' | 'smart-split';

export interface RoutingConfig {
  mode: RoutingMode;
  triggerModelPatterns: string[];
  bypassAnthropicBaseUrl?: string;
  bypassOpenAIBaseUrl?: string;
}

export interface CustomPairConfig {
  planner: ModelRef;
  executor: ModelRef;
  rules: OrchestratorRules;
}

export interface OrchestratorConfig {
  port: number;
  host: string;
  activePresetId: string;
  customPair?: CustomPairConfig;
  routing: RoutingConfig;
  providers: ProviderConfig[];
  presets: PresetConfig[];
}

export type Phase = 'PLANNING' | 'EXECUTING';

export type TimelineEventType =
  | 'phase_change'
  | 'handoff'
  | 'escalation'
  | 'tool_error'
  | 'turn_complete'
  | 'manual_override';

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: TimelineEventType;
  fromPhase?: Phase;
  toPhase?: Phase;
  model?: string;
  summary: string;
  detail?: string;
}

export interface SessionUsage {
  plannerInput: number;
  plannerOutput: number;
  executorInput: number;
  executorOutput: number;
  actualCostUsd: number;
  baselinePlannerCostUsd: number;
}

export type ReviewReason =
  | 'user_message'
  | 'consecutive_errors'
  | 'step_checkpoint'
  | 'executor_escalation'
  | 'manual_override'
  | null;

export interface SessionState {
  id: string;
  harnessHint: HarnessId | 'generic';
  presetId: string;
  title?: string;
  presetName?: string;
  plannerModel?: string;
  executorModel?: string;
  phase: Phase;
  activePlan: string | null;
  replanIf: string | null;
  planVersion: number;
  execSteps: number;
  consecutiveErrors: number;
  escalationCount: number;
  reviewReason: ReviewReason;
  lastErrorSummary: string | null;
  forcePlannerNext: boolean;
  /** Maps message fingerprint or index to originating model id for sanitization */
  lastAssistantModel: string | null;
  createdAt: string;
  updatedAt: string;
  usage: SessionUsage;
  timeline: TimelineEvent[];
}

export type HarnessId =
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'dsh'
  | 'other'
  | 'cline'
  | 'roo-code'
  | 'cursor'
  | 'aider';

export type HarnessSurface = 'cli-only' | 'gui-and-cli' | 'gui-manual';

export interface HarnessStatus {
  id: HarnessId;
  name: string;
  description: string;
  mode: 'one-click' | 'manual-guide';
  surface?: HarnessSurface;
  installed: boolean;
  enabled: boolean;
  configPath: string | null;
  hasBackup: boolean;
  guideSteps?: string[];
  copyConfig?: {
    providerLabel: string;
    baseUrl: string;
    apiKeyPlaceholder: string;
    modelName: string;
  };
}
