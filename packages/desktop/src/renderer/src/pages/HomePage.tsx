import React, { useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Brain,
  Check,
  Coins,
  Copy,
  GitBranch,
  Power,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import type {
  EngineState,
  HarnessStatus,
  OrchestratorConfig,
  ReasoningEffort,
  SessionState,
} from '../types';
import {
  getCatalogForProvider,
  getDefaultModelForRole,
  REASONING_EFFORT_OPTIONS,
} from '../data/modelCatalog';

const CUSTOM_PRESET_ID = '__custom__';

interface SmartSplitRow {
  pattern: string;
  label: string;
  clients: string;
}

const SMART_SPLIT_MODEL_ROWS: SmartSplitRow[] = [
  { pattern: 'opus', label: 'Claude Opus 系列（如 claude-opus-5-5）', clients: 'Claude Code' },
  { pattern: 'opusplan', label: 'Claude OpusPlan（内置规划槽位）', clients: 'Claude Code' },
  { pattern: 'fable', label: 'Claude Fable 系列（如 claude-fable-5-2）', clients: 'Claude Code' },
  { pattern: 'sonnet', label: 'Claude Sonnet 系列（如 claude-sonnet-5-5）', clients: 'Claude Code' },
  { pattern: 'haiku', label: 'Claude Haiku 系列（如 claude-haiku-5-5）', clients: 'Claude Code' },
  { pattern: 'gpt-6.2', label: 'OpenAI GPT-6.2 系列（Astra / Sol）', clients: 'Codex CLI / OpenAI 兼容' },
  { pattern: 'gpt-6', label: 'OpenAI GPT-6 / 6.1 系列（Astra / Sol / Luna）', clients: 'Codex CLI / OpenAI 兼容' },
  { pattern: 'gemini-4', label: 'Google Gemini 4 系列（Carbon / Neon / Argon）', clients: 'OpenCode / 其他' },
];

const BUILTIN_SPLIT_PATTERNS = new Set(SMART_SPLIT_MODEL_ROWS.map((r) => r.pattern));

interface HomePageProps {
  engine: EngineState;
  config: OrchestratorConfig;
  harnesses: HarnessStatus[];
  sessions: SessionState[];
  onToggleEngine: () => void;
  onSelectPreset: (presetId: string) => Promise<void>;
  onSaveConfig: (next: OrchestratorConfig) => Promise<void>;
  onToggleHarness: (id: string, enable: boolean) => Promise<void>;
  onNavigate: (tab: 'home' | 'providers' | 'strategies' | 'cockpit') => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  engine,
  config,
  harnesses,
  sessions,
  onToggleEngine,
  onSelectPreset,
  onSaveConfig,
  onToggleHarness,
  onNavigate,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [guideHarness, setGuideHarness] = useState<HarnessStatus | null>(null);
  const [busyHarness, setBusyHarness] = useState<string | null>(null);
  const [customSlot, setCustomSlot] = useState('');
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    try {
      return localStorage.getItem('orch_onboarding_dismissed_v2') !== '1';
    } catch {
      return true;
    }
  });

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    try {
      localStorage.setItem('orch_onboarding_dismissed_v2', '1');
    } catch {
      // ignore
    }
  };

  const reopenOnboarding = () => {
    setShowOnboarding(true);
    try {
      localStorage.removeItem('orch_onboarding_dismissed_v2');
    } catch {
      // ignore
    }
  };

  const isCustomMode = config.activePresetId === CUSTOM_PRESET_ID && Boolean(config.customPair);
  const matchedPreset = config.presets.find((p) => p.id === config.activePresetId);
  const fallbackPreset = config.presets[0];

  const currentPlanner = isCustomMode
    ? config.customPair!.planner
    : (matchedPreset ?? fallbackPreset).planner;
  const currentExecutor = isCustomMode
    ? config.customPair!.executor
    : (matchedPreset ?? fallbackPreset).executor;
  const currentRules = isCustomMode
    ? config.customPair!.rules
    : (matchedPreset ?? fallbackPreset).rules;

  const plannerProvider = config.providers.find(
    (p) => p.id === currentPlanner.providerId,
  );
  const executorProvider = config.providers.find(
    (p) => p.id === currentExecutor.providerId,
  );
  const plannerCatalog = getCatalogForProvider(plannerProvider);
  const executorCatalog = getCatalogForProvider(executorProvider);

  const totalActualCost = sessions.reduce((s, x) => s + x.usage.actualCostUsd, 0);
  const totalBaselineCost = sessions.reduce(
    (s, x) => s + x.usage.baselinePlannerCostUsd,
    0,
  );
  const savedCost = Math.max(0, totalBaselineCost - totalActualCost);
  const savedPct =
    totalBaselineCost > 0 ? Math.round((savedCost / totalBaselineCost) * 100) : 0;
  const totalEscalations = sessions.reduce((s, x) => s + x.escalationCount, 0);

  const applyManualPair = async (
    nextPlanner: typeof currentPlanner,
    nextExecutor: typeof currentExecutor,
  ) => {
    const matchingPreset = config.presets.find(
      (p) =>
        p.planner.providerId === nextPlanner.providerId &&
        p.planner.modelId === nextPlanner.modelId &&
        (p.planner.reasoningEffort ?? 'default') === (nextPlanner.reasoningEffort ?? 'default') &&
        p.executor.providerId === nextExecutor.providerId &&
        p.executor.modelId === nextExecutor.modelId &&
        (p.executor.reasoningEffort ?? 'default') === (nextExecutor.reasoningEffort ?? 'default'),
    );

    if (matchingPreset) {
      await onSaveConfig({
        ...config,
        activePresetId: matchingPreset.id,
      });
    } else {
      await onSaveConfig({
        ...config,
        activePresetId: CUSTOM_PRESET_ID,
        customPair: {
          planner: nextPlanner,
          executor: nextExecutor,
          rules: currentRules,
        },
      });
    }
  };

  const handlePlannerProviderChange = async (providerId: string) => {
    const prov = config.providers.find((p) => p.id === providerId);
    const def = getDefaultModelForRole(prov, 'planner');
    await applyManualPair(
      {
        ...currentPlanner,
        providerId,
        modelId: def.id,
        inputPricePerM: def.inPrice,
        outputPricePerM: def.outPrice,
      },
      currentExecutor,
    );
  };

  const handleExecutorProviderChange = async (providerId: string) => {
    const prov = config.providers.find((p) => p.id === providerId);
    const def = getDefaultModelForRole(prov, 'executor');
    await applyManualPair(currentPlanner, {
      ...currentExecutor,
      providerId,
      modelId: def.id,
      inputPricePerM: def.inPrice,
      outputPricePerM: def.outPrice,
    });
  };

  const handlePlannerModelChange = async (modelId: string) => {
    const found = plannerCatalog.find((m) => m.id === modelId);
    await applyManualPair(
      {
        ...currentPlanner,
        modelId,
        ...(found ? { inputPricePerM: found.inPrice, outputPricePerM: found.outPrice } : {}),
      },
      currentExecutor,
    );
  };

  const handleExecutorModelChange = async (modelId: string) => {
    const found = executorCatalog.find((m) => m.id === modelId);
    await applyManualPair(currentPlanner, {
      ...currentExecutor,
      modelId,
      ...(found ? { inputPricePerM: found.inPrice, outputPricePerM: found.outPrice } : {}),
    });
  };

  const handlePlannerEffortChange = async (reasoningEffort: ReasoningEffort) => {
    await applyManualPair(
      {
        ...currentPlanner,
        reasoningEffort,
      },
      currentExecutor,
    );
  };

  const handleExecutorEffortChange = async (reasoningEffort: ReasoningEffort) => {
    await applyManualPair(currentPlanner, {
      ...currentExecutor,
      reasoningEffort,
    });
  };

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleToggleHarness = async (h: HarnessStatus) => {
    setBusyHarness(h.id);
    try {
      await onToggleHarness(h.id, !h.enabled);
    } finally {
      setBusyHarness(null);
    }
  };

  const routing = config.routing ?? {
    mode: 'smart-split' as const,
    triggerModelPatterns: ['opus', 'opusplan'],
  };

  const setRoutingMode = async (mode: 'all' | 'smart-split') => {
    await onSaveConfig({
      ...config,
      routing: { ...routing, mode },
    });
  };

  const toggleTriggerSlot = async (slot: string) => {
    const exists = routing.triggerModelPatterns.includes(slot);
    const nextPatterns = exists
      ? routing.triggerModelPatterns.filter((p) => p !== slot)
      : [...routing.triggerModelPatterns, slot];
    await onSaveConfig({
      ...config,
      routing: { ...routing, triggerModelPatterns: nextPatterns },
    });
  };

  const addCustomTriggerSlot = async () => {
    const trimmed = customSlot.trim().toLowerCase();
    if (!trimmed || routing.triggerModelPatterns.includes(trimmed)) {
      setCustomSlot('');
      return;
    }
    await onSaveConfig({
      ...config,
      routing: {
        ...routing,
        triggerModelPatterns: [...routing.triggerModelPatterns, trimmed],
      },
    });
    setCustomSlot('');
  };

  const activePresetValue = isCustomMode
    ? CUSTOM_PRESET_ID
    : (matchedPreset ?? fallbackPreset)?.id ?? '';

  return (
    <div className="space-y-6">
      {/* 首次使用 3 步快速指引 */}
      {showOnboarding && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-indigo-800">
              3 步上手：填好 API Key → 选定规划/执行模型 → 一键接入你的 AI 工具
            </span>
            <button
              onClick={dismissOnboarding}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100 cursor-pointer"
            >
              收起引导
            </button>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-xs">
            <button
              onClick={() => onNavigate('providers')}
              className="rounded-xl bg-white/90 p-3 text-left border border-indigo-100 hover:border-indigo-300 transition cursor-pointer"
            >
              <div className="font-semibold text-slate-900">1. 填入官方 API Key</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                在左侧「模型 API Key」填好官方 Key 并测速（仅支持开发者 API Key 与本地 Ollama）。
              </div>
            </button>
            <div className="rounded-xl bg-white/90 p-3 border border-indigo-100">
              <div className="font-semibold text-slate-900">2. 选择策略或自由搭配</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                直接在下方卡片挑架构师与执行手模型；不匹配预设策略时会自动切为「自定义」。
              </div>
            </div>
            <div className="rounded-xl bg-white/90 p-3 border border-indigo-100">
              <div className="font-semibold text-slate-900">3. 接入原工具直接用</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                在下方一键开启 Claude Code / Codex / OpenCode，或复制地址到其他 Harness 后回原工具对话。
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1. Orchestrator 编排引擎（置顶，集成核心运行数据） */}
      <div className="surface-card relative overflow-hidden rounded-2xl p-5">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-400" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                engine.running
                  ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              <Power className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-semibold text-slate-900">
                  Orchestrator 编排引擎
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    engine.running
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      engine.running ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                    }`}
                  />
                  {engine.running ? '运行中' : '已暂停'}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                本地监听地址：
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                  {engine.url}
                </code>
                <span className="ml-2 text-slate-400">
                  （关闭窗口保留在系统托盘后台运行）
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onToggleEngine}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition cursor-pointer ${
                engine.running
                  ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
              }`}
            >
              {engine.running ? '暂停引擎' : '立即启动'}
            </button>
            {!showOnboarding && (
              <button
                onClick={reopenOnboarding}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 hover:text-indigo-600 cursor-pointer"
              >
                新手引导
              </button>
            )}
          </div>
        </div>

        {/* 集成核心统计指标 */}
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">预估已省模型费用</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Coins className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-emerald-600">
                ${savedCost.toFixed(4)}
              </span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-emerald-700">
                省 {savedPct}%
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">对比全程使用架构师强模型</p>
          </div>

          <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">自动救场复盘次数</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <RefreshCw className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-indigo-600">
              {totalEscalations}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">执行遇阻自动交回强模型修正方案</p>
          </div>

          <div
            onClick={() => onNavigate('cockpit')}
            className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/30 transition cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">累计编排会话</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                <Activity className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="text-xl font-bold tabular-nums text-slate-900">
                {sessions.length}
              </span>
              <span className="text-xs font-medium text-indigo-600">打开驾驶舱 →</span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">所有 AI 工具会话集中实时监控</p>
          </div>
        </div>
      </div>

      {/* 2. 当前工作模式（集成策略选择与手动选模型） */}
      <div className="surface-card rounded-2xl p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">
                当前工作模式：强模型设计 + 次级模型落地
              </h3>
              {isCustomMode && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                  自定义组合
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {isCustomMode
                ? '当前手动选择的模型未命中预设策略，已自动切换为「自定义」编排运行。'
                : (matchedPreset ?? fallbackPreset)?.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">当前策略：</span>
            <select
              value={activePresetValue}
              onChange={(e) => {
                if (e.target.value !== CUSTOM_PRESET_ID) {
                  onSelectPreset(e.target.value);
                }
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-400"
            >
              {config.presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {isCustomMode && (
                <option value={CUSTOM_PRESET_ID}>自定义</option>
              )}
            </select>
            <button
              onClick={() => onNavigate('providers')}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              配置 API Key
            </button>
            <button
              onClick={() => onNavigate('strategies')}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              管理策略
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-11">
          {/* 架构师手动选择器 */}
          <div className="md:col-span-5 rounded-xl border border-indigo-200/80 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                <Brain className="h-3.5 w-3.5" />
                架构师 Planner
              </span>
              <span className="text-xs text-slate-400">只读调研 · 定方案</span>
            </div>

            <div className="mt-3 space-y-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  供应商
                </label>
                <select
                  value={currentPlanner.providerId}
                  onChange={(e) => handlePlannerProviderChange(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-indigo-400 focus:bg-white"
                >
                  {config.providers.map((prov) => (
                    <option key={prov.id} value={prov.id}>
                      {prov.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  模型（旗舰优先）
                </label>
                <select
                  value={
                    plannerCatalog.some((m) => m.id === currentPlanner.modelId)
                      ? currentPlanner.modelId
                      : '__manual__'
                  }
                  onChange={(e) => {
                    if (e.target.value !== '__manual__') {
                      handlePlannerModelChange(e.target.value);
                    }
                  }}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-800 outline-none focus:border-indigo-400 focus:bg-white"
                >
                  {plannerCatalog.map((m) => (
                    <option key={m.id} value={m.id}>
                      [{m.tier}] {m.id} — {m.note}
                    </option>
                  ))}
                  {!plannerCatalog.some((m) => m.id === currentPlanner.modelId) && (
                    <option value="__manual__">
                      自定义: {currentPlanner.modelId}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  思考强度（推理深度）
                </label>
                <select
                  value={currentPlanner.reasoningEffort ?? 'default'}
                  onChange={(e) => handlePlannerEffortChange(e.target.value as ReasoningEffort)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-indigo-400 focus:bg-white"
                >
                  {REASONING_EFFORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.shortLabel}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              {currentRules.readOnlyPlanning
                ? '规划期已锁定只读，绝不乱改文件'
                : '规划期允许常规工具'}
            </div>
          </div>

          {/* Arrow */}
          <div className="md:col-span-1 flex flex-col items-center justify-center gap-1.5 py-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-indigo-600 shadow-sm ring-1 ring-indigo-100">
              <ArrowLeftRight className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400 text-center leading-tight">
              自动接力
              <br />
              遇错回退
            </span>
          </div>

          {/* 执行手手动选择器 */}
          <div className="md:col-span-5 rounded-xl border border-sky-200/80 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                <Zap className="h-3.5 w-3.5" />
                执行手 Executor
              </span>
              <span className="text-xs text-slate-400">高速低价 · 写代码</span>
            </div>

            <div className="mt-3 space-y-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  供应商
                </label>
                <select
                  value={currentExecutor.providerId}
                  onChange={(e) => handleExecutorProviderChange(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-sky-400 focus:bg-white"
                >
                  {config.providers.map((prov) => (
                    <option key={prov.id} value={prov.id}>
                      {prov.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  模型（旗舰优先）
                </label>
                <select
                  value={
                    executorCatalog.some((m) => m.id === currentExecutor.modelId)
                      ? currentExecutor.modelId
                      : '__manual__'
                  }
                  onChange={(e) => {
                    if (e.target.value !== '__manual__') {
                      handleExecutorModelChange(e.target.value);
                    }
                  }}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-800 outline-none focus:border-sky-400 focus:bg-white"
                >
                  {executorCatalog.map((m) => (
                    <option key={m.id} value={m.id}>
                      [{m.tier}] {m.id} — {m.note}
                    </option>
                  ))}
                  {!executorCatalog.some((m) => m.id === currentExecutor.modelId) && (
                    <option value="__manual__">
                      自定义: {currentExecutor.modelId}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  思考强度（推理深度）
                </label>
                <select
                  value={currentExecutor.reasoningEffort ?? 'default'}
                  onChange={(e) => handleExecutorEffortChange(e.target.value as ReasoningEffort)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-sky-400 focus:bg-white"
                >
                  {REASONING_EFFORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.shortLabel}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 text-[11px] text-slate-600">
              连续报错{' '}
              <span className="font-semibold text-amber-600">
                {currentRules.maxConsecutiveErrors} 次
              </span>{' '}
              自动交回架构师复盘
            </div>
          </div>
        </div>
      </div>

      {/* 3. 模型分流与原 Agent 兼容控制 */}
      <div className="surface-card rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <GitBranch className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                模型分流模式（保护原工具里的模型选择器）
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {routing.mode === 'smart-split'
                  ? '当前为智能分流：只有选 orch:* 或下方触发槽位时才启用双模型，在原 Agent 里选其他模型将 100% 原样直通官方。'
                  : '当前为全量接管：接入后的工具所有请求都会经过 Orchestrator 编排引擎。'}
              </p>
            </div>
          </div>

          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => setRoutingMode('smart-split')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                routing.mode === 'smart-split'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              智能分流（推荐）
            </button>
            <button
              onClick={() => setRoutingMode('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                routing.mode === 'all'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              全量接管
            </button>
          </div>
        </div>

        {routing.mode === 'smart-split' && (
          <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-600">
                勾选客户端模型路由规则（已启用{' '}
                <span className="font-semibold text-indigo-600">
                  {routing.triggerModelPatterns.length}
                </span>{' '}
                项关键字触发 + 固定 <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">orchestrator / orch:*</code>）：
              </span>
              <span className="text-[11px] text-slate-400">
                未勾选的模型在原工具中被选中时，将 100% 原样直通官方 API
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/90 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="w-12 px-3 py-2.5 text-center">路由</th>
                    <th className="px-3 py-2.5">客户端模型 / 匹配关键词</th>
                    <th className="px-3 py-2.5">适用客户端</th>
                    <th className="px-3 py-2.5">当前去向</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="bg-indigo-50/35">
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        aria-label="固定路由 orchestrator 和 orch:*"
                        className="h-4 w-4 rounded border-indigo-300 text-indigo-600 opacity-75"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono font-semibold text-slate-800">
                        orchestrator / orch:*
                      </div>
                      <div className="text-[11px] text-slate-400">
                        专属策略代号（始终由编排引擎接管）
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">所有接入工具</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                        → 路由到本软件（固定）
                      </span>
                    </td>
                  </tr>

                  {SMART_SPLIT_MODEL_ROWS.map((row) => {
                    const checked = routing.triggerModelPatterns.includes(row.pattern);
                    return (
                      <tr
                        key={row.pattern}
                        onClick={() => toggleTriggerSlot(row.pattern)}
                        className={`cursor-pointer transition ${
                          checked ? 'bg-indigo-50/20 hover:bg-indigo-50/40' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td
                          className="px-3 py-2.5 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTriggerSlot(row.pattern)}
                            aria-label={`路由 ${row.pattern}`}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                              {row.pattern}
                            </code>
                            <span className="text-slate-700">{row.label}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{row.clients}</td>
                        <td className="px-3 py-2.5">
                          {checked ? (
                            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
                              → 路由到本软件（双模型）
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                              → 原样直通官方 API
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {routing.triggerModelPatterns
                    .filter((p) => !BUILTIN_SPLIT_PATTERNS.has(p))
                    .map((customPattern) => (
                      <tr
                        key={customPattern}
                        onClick={() => toggleTriggerSlot(customPattern)}
                        className="cursor-pointer bg-indigo-50/20 hover:bg-indigo-50/40 transition"
                      >
                        <td
                          className="px-3 py-2.5 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked
                            onChange={() => toggleTriggerSlot(customPattern)}
                            aria-label={`路由 ${customPattern}`}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                              {customPattern}
                            </code>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTriggerSlot(customPattern);
                              }}
                              className="text-[11px] text-rose-500 hover:underline cursor-pointer"
                            >
                              移除
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">自定义关键词</td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
                            → 路由到本软件（双模型）
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500">添加自定义模型关键词：</span>
              <input
                value={customSlot}
                onChange={(e) => setCustomSlot(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomTriggerSlot()}
                placeholder="输入模型名或前缀关键词..."
                className="w-48 rounded-lg border border-slate-200 px-2.5 py-1 text-xs outline-none focus:border-indigo-400"
              />
              <button
                onClick={addCustomTriggerSlot}
                className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 cursor-pointer"
              >
                + 添加到分流表
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. 一键接入我的 AI 工具 */}
      <div className="surface-card rounded-2xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Wrench className="h-4 w-4 text-indigo-600" />
              一键接入我的 AI 编程工具
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              开启前会自动备份原配置；关闭开关可 100% 无损恢复原状。也可直接在终端运行{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                orch run claude
              </code>
              。
            </p>
            <p className="mt-1 text-[11px] text-indigo-700 bg-indigo-50/70 inline-block rounded-lg px-2.5 py-1">
              提示：这里只决定「哪个前台工具连入本软件」，与上方选哪家厂商的模型无关；在任意已接入工具（如 Codex CLI、OpenCode）里都能调度你配好的 Claude / OpenAI / Gemini / DeepSeek 官方 API 模型。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {harnesses.map((h) => (
            <div
              key={h.id}
              className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                h.enabled
                  ? 'border-emerald-300 bg-emerald-50/30'
                  : 'border-slate-200 bg-slate-50/40'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{h.name}</span>
                    {h.mode === 'one-click' && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          h.installed
                            ? 'bg-slate-200/70 text-slate-700'
                            : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {h.installed ? '已检测到本机环境' : '未检测到命令（可预配置）'}
                      </span>
                    )}
                  </div>

                  {h.mode === 'one-click' ? (
                    <button
                      disabled={busyHarness === h.id}
                      onClick={() => handleToggleHarness(h)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                        h.enabled
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {busyHarness === h.id
                        ? '处理中...'
                        : h.enabled
                          ? '已接入 · 点击还原'
                          : '一键接入'}
                    </button>
                  ) : (
                    <button
                      onClick={() => setGuideHarness(h)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      查看 3 步配置
                    </button>
                  )}
                </div>

                <p className="mt-1.5 text-xs text-slate-500">{h.description}</p>
              </div>

              {h.mode === 'one-click' && h.configPath && (
                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="truncate max-w-[300px]" title={h.configPath}>
                    配置：{h.configPath}
                  </span>
                  {h.hasBackup && (
                    <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                      <Sparkles className="h-3 w-3" /> 已安全备份原配置
                    </span>
                  )}
                </div>
              )}

              {h.mode === 'manual-guide' && h.copyConfig && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => copyText(`${h.id}-url`, h.copyConfig!.baseUrl)}
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 cursor-pointer"
                  >
                    {copiedKey === `${h.id}-url` ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    复制 Base URL
                  </button>
                  <button
                    onClick={() => copyText(`${h.id}-model`, h.copyConfig!.modelName)}
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 cursor-pointer"
                  >
                    {copiedKey === `${h.id}-model` ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    复制模型名 ({h.copyConfig.modelName})
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 手动配置指引弹窗 */}
      {guideHarness && guideHarness.copyConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h4 className="text-base font-semibold text-slate-900">
              {guideHarness.name} 接入指南
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              只需照抄下面 3 个参数填入插件设置，即可马上用上双模型编排：
            </p>

            <div className="mt-4 space-y-2.5 rounded-xl bg-slate-50 p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Provider 类型：</span>
                <span className="font-semibold text-slate-800">
                  {guideHarness.copyConfig.providerLabel}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Base URL：</span>
                <div className="flex items-center gap-1.5">
                  <code className="rounded bg-white px-2 py-0.5 border border-slate-200 text-slate-800">
                    {guideHarness.copyConfig.baseUrl}
                  </code>
                  <button
                    onClick={() =>
                      copyText('modal-url', guideHarness.copyConfig!.baseUrl)
                    }
                    className="text-indigo-600 hover:underline cursor-pointer"
                  >
                    {copiedKey === 'modal-url' ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Model ID：</span>
                <div className="flex items-center gap-1.5">
                  <code className="rounded bg-white px-2 py-0.5 border border-slate-200 text-slate-800">
                    {guideHarness.copyConfig.modelName}
                  </code>
                  <button
                    onClick={() =>
                      copyText('modal-model', guideHarness.copyConfig!.modelName)
                    }
                    className="text-indigo-600 hover:underline cursor-pointer"
                  >
                    {copiedKey === 'modal-model' ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">API Key（随便填非空字符）：</span>
                <code className="rounded bg-white px-2 py-0.5 border border-slate-200 text-slate-800">
                  {guideHarness.copyConfig.apiKeyPlaceholder}
                </code>
              </div>
            </div>

            {guideHarness.guideSteps && (
              <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-xs text-slate-600">
                {guideHarness.guideSteps.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ol>
            )}

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setGuideHarness(null)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
