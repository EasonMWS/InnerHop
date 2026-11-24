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
  getReasoningEffortOptions,
  localizeTier,
} from '../data/modelCatalog';
import {
  localizeHarnessText,
  localizePreset,
  localizeProviderName,
  type Locale,
} from '../i18n';

const CUSTOM_PRESET_ID = '__custom__';

interface SmartSplitRow {
  pattern: string;
  labelZh: string;
  labelEn: string;
  clientsZh: string;
  clientsEn: string;
}

const SMART_SPLIT_MODEL_ROWS: SmartSplitRow[] = [
  { pattern: 'opus', labelZh: 'Claude Opus 系列（如 claude-opus-5-5）', labelEn: 'Claude Opus series (e.g. claude-opus-5-5)', clientsZh: 'Claude Code', clientsEn: 'Claude Code' },
  { pattern: 'opusplan', labelZh: 'Claude OpusPlan（内置规划槽位）', labelEn: 'Claude OpusPlan (built-in plan alias)', clientsZh: 'Claude Code', clientsEn: 'Claude Code' },
  { pattern: 'fable', labelZh: 'Claude Fable 系列（如 claude-fable-5-2）', labelEn: 'Claude Fable series (e.g. claude-fable-5-2)', clientsZh: 'Claude Code', clientsEn: 'Claude Code' },
  { pattern: 'sonnet', labelZh: 'Claude Sonnet 系列（如 claude-sonnet-5-5）', labelEn: 'Claude Sonnet series (e.g. claude-sonnet-5-5)', clientsZh: 'Claude Code', clientsEn: 'Claude Code' },
  { pattern: 'haiku', labelZh: 'Claude Haiku 系列（如 claude-haiku-5-5）', labelEn: 'Claude Haiku series (e.g. claude-haiku-5-5)', clientsZh: 'Claude Code', clientsEn: 'Claude Code' },
  { pattern: 'gpt-6.2', labelZh: 'OpenAI GPT-6.2 系列（Astra / Sol）', labelEn: 'OpenAI GPT-6.2 series (Astra / Sol)', clientsZh: 'Codex CLI / OpenAI 兼容', clientsEn: 'Codex CLI / OpenAI Compat' },
  { pattern: 'gpt-6', labelZh: 'OpenAI GPT-6 / 6.1 系列（Astra / Sol / Luna）', labelEn: 'OpenAI GPT-6 / 6.1 series (Astra / Sol / Luna)', clientsZh: 'Codex CLI / OpenAI 兼容', clientsEn: 'Codex CLI / OpenAI Compat' },
  { pattern: 'gemini-4', labelZh: 'Google Gemini 4 系列（Carbon / Neon / Argon）', labelEn: 'Google Gemini 4 series (Carbon / Neon / Argon)', clientsZh: 'OpenCode / 其他', clientsEn: 'OpenCode / Others' },
];

const BUILTIN_SPLIT_PATTERNS = new Set(SMART_SPLIT_MODEL_ROWS.map((r) => r.pattern));

interface HomePageProps {
  locale: Locale;
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
  locale,
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
  const zh = locale === 'zh';
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
  const plannerCatalog = getCatalogForProvider(plannerProvider, locale);
  const executorCatalog = getCatalogForProvider(executorProvider, locale);
  const effortOptions = getReasoningEffortOptions(locale);

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
    await applyManualPair({ ...currentPlanner, reasoningEffort }, currentExecutor);
  };

  const handleExecutorEffortChange = async (reasoningEffort: ReasoningEffort) => {
    await applyManualPair(currentPlanner, { ...currentExecutor, reasoningEffort });
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

  const activePresetMeta = matchedPreset ?? fallbackPreset;
  const activePresetText = localizePreset(
    activePresetMeta.id,
    activePresetMeta.name,
    activePresetMeta.description,
    locale,
  );

  const modalHarnessText = guideHarness
    ? localizeHarnessText(
        guideHarness.id,
        guideHarness.name,
        guideHarness.description,
        guideHarness.guideSteps,
        locale,
      )
    : null;

  return (
    <div className="space-y-6">
      {/* 3-step onboarding */}
      {showOnboarding && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-indigo-800">
              {zh
                ? '3 步上手：填好 API Key → 选定规划/执行模型 → 一键接入你的 AI 工具'
                : '3-Step Quick Start: Add API Keys → Pair Planner & Executor → Connect Your Tool'}
            </span>
            <button
              onClick={dismissOnboarding}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100 cursor-pointer"
            >
              {zh ? '收起引导' : 'Dismiss'}
            </button>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-xs">
            <button
              onClick={() => onNavigate('providers')}
              className="rounded-xl bg-white/90 p-3 text-left border border-indigo-100 hover:border-indigo-300 transition cursor-pointer"
            >
              <div className="font-semibold text-slate-900">
                {zh ? '1. 填入官方 API Key' : '1. Configure Official API Keys'}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {zh
                  ? '在左侧「模型 API Key」填好官方 Key 并测速（仅支持开发者 API Key 与本地 Ollama）。'
                  : 'Open API Keys in the sidebar to add developer keys & test latency (Developer Keys & local Ollama only).'}
              </div>
            </button>
            <div className="rounded-xl bg-white/90 p-3 border border-indigo-100">
              <div className="font-semibold text-slate-900">
                {zh ? '2. 选择策略或自由搭配' : '2. Pick Strategy or Custom Pair'}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {zh
                  ? '直接在下方卡片挑架构师与执行手模型；不匹配预设策略时会自动切为「自定义」。'
                  : 'Choose Planner & Executor models and reasoning effort below; unmatched pairs switch to Custom automatically.'}
              </div>
            </div>
            <div className="rounded-xl bg-white/90 p-3 border border-indigo-100">
              <div className="font-semibold text-slate-900">
                {zh ? '3. 接入原工具直接用' : '3. Connect Any Coding Harness'}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {zh
                  ? '在下方一键开启 Claude Code / Codex / OpenCode，或复制地址到其他 Harness 后回原工具对话。'
                  : 'Enable Claude Code / Codex / OpenCode in one click below, or copy the local URL into any OpenAI-compatible client.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1. InnerHop Engine + KPIs */}
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
                  {zh ? 'InnerHop 编排引擎' : 'InnerHop Engine'}
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
                  {engine.running
                    ? zh
                      ? '运行中'
                      : 'Running'
                    : zh
                      ? '已暂停'
                      : 'Paused'}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {zh ? '本地监听地址：' : 'Local endpoint: '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                  {engine.url}
                </code>
                <span className="ml-2 text-slate-400">
                  {zh
                    ? '（关闭窗口保留在系统托盘后台运行）'
                    : '(Minimizes to system tray when closed)'}
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
              {engine.running
                ? zh
                  ? '暂停引擎'
                  : 'Pause Engine'
                : zh
                  ? '立即启动'
                  : 'Start Engine'}
            </button>
            {!showOnboarding && (
              <button
                onClick={reopenOnboarding}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 hover:text-indigo-600 cursor-pointer"
              >
                {zh ? '新手引导' : 'Quick Guide'}
              </button>
            )}
          </div>
        </div>

        {/* Integrated KPI metrics */}
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                {zh ? '预估已省模型费用' : 'Estimated Cost Saved'}
              </span>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Coins className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-emerald-600">
                ${savedCost.toFixed(4)}
              </span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-emerald-700">
                {zh ? `省 ${savedPct}%` : `-${savedPct}%`}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {zh
                ? '对比全程使用架构师强模型'
                : 'Compared to running Planner for all turns'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                {zh ? '自动救场复盘次数' : 'Auto Escalations'}
              </span>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <RefreshCw className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="mt-1.5 text-xl font-bold tabular-nums text-indigo-600">
              {totalEscalations}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {zh
                ? '执行遇阻自动交回强模型修正方案'
                : 'Auto-returned to Planner when Executor hits friction'}
            </p>
          </div>

          <div
            onClick={() => onNavigate('cockpit')}
            className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/30 transition cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                {zh ? '累计编排会话' : 'Orchestrated Sessions'}
              </span>
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                <Activity className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="text-xl font-bold tabular-nums text-slate-900">
                {sessions.length}
              </span>
              <span className="text-xs font-medium text-indigo-600">
                {zh ? '打开驾驶舱 →' : 'Open Cockpit →'}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {zh
                ? '所有 AI 工具会话集中实时监控'
                : 'Live monitoring across all connected tools'}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Active Workflow Mode */}
      <div className="surface-card rounded-2xl p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">
                {zh
                  ? '当前工作模式：强模型设计 + 次级模型落地'
                  : 'Active Workflow: Frontier Planner + Fast Executor'}
              </h3>
              {isCustomMode && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                  {zh ? '自定义组合' : 'Custom Pair'}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {isCustomMode
                ? zh
                  ? '当前手动选择的模型未命中预设策略，已自动切换为「自定义」编排运行。'
                  : 'Manual model or reasoning selection differs from saved strategies; running as Custom.'
                : activePresetText.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">
              {zh ? '当前策略：' : 'Strategy:'}
            </span>
            <select
              value={activePresetValue}
              onChange={(e) => {
                if (e.target.value !== CUSTOM_PRESET_ID) {
                  onSelectPreset(e.target.value);
                }
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-400"
            >
              {config.presets.map((p) => {
                const lp = localizePreset(p.id, p.name, p.description, locale);
                return (
                  <option key={p.id} value={p.id}>
                    {lp.name}
                  </option>
                );
              })}
              {isCustomMode && (
                <option value={CUSTOM_PRESET_ID}>{zh ? '自定义' : 'Custom'}</option>
              )}
            </select>
            <button
              onClick={() => onNavigate('providers')}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {zh ? '配置 API Key' : 'API Keys'}
            </button>
            <button
              onClick={() => onNavigate('strategies')}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {zh ? '管理策略' : 'Manage Strategies'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-11">
          {/* Planner Card */}
          <div className="md:col-span-5 rounded-xl border border-indigo-200/80 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                <Brain className="h-3.5 w-3.5" />
                {zh ? '架构师 Planner' : 'Planner'}
              </span>
              <span className="text-xs text-slate-400">
                {zh ? '只读调研 · 定方案' : 'Read-only · Architecture'}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  {zh ? '供应商' : 'Provider'}
                </label>
                <select
                  value={currentPlanner.providerId}
                  onChange={(e) => handlePlannerProviderChange(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-indigo-400 focus:bg-white"
                >
                  {config.providers.map((prov) => (
                    <option key={prov.id} value={prov.id}>
                      {localizeProviderName(prov.id, prov.name, locale)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  {zh ? '模型（旗舰优先）' : 'Model (Flagship First)'}
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
                      [{localizeTier(m.tier, locale)}] {m.id} — {m.note}
                    </option>
                  ))}
                  {!plannerCatalog.some((m) => m.id === currentPlanner.modelId) && (
                    <option value="__manual__">
                      {zh ? `自定义: ${currentPlanner.modelId}` : `Custom: ${currentPlanner.modelId}`}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  {zh ? '思考强度（推理深度）' : 'Reasoning Effort'}
                </label>
                <select
                  value={currentPlanner.reasoningEffort ?? 'default'}
                  onChange={(e) => handlePlannerEffortChange(e.target.value as ReasoningEffort)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-indigo-400 focus:bg-white"
                >
                  {effortOptions.map((opt) => (
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
                ? zh
                  ? '规划期已锁定只读，绝不乱改文件'
                  : 'Read-only enforced during planning'
                : zh
                  ? '规划期允许常规工具'
                  : 'Standard tools enabled during planning'}
            </div>
          </div>

          {/* Arrow */}
          <div className="md:col-span-1 flex flex-col items-center justify-center gap-1.5 py-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-indigo-600 shadow-sm ring-1 ring-indigo-100">
              <ArrowLeftRight className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-medium text-slate-400 text-center leading-tight">
              {zh ? (
                <>
                  自动接力
                  <br />
                  遇错回退
                </>
              ) : (
                <>
                  Handoff
                  <br />
                  Escalate
                </>
              )}
            </span>
          </div>

          {/* Executor Card */}
          <div className="md:col-span-5 rounded-xl border border-sky-200/80 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
                <Zap className="h-3.5 w-3.5" />
                {zh ? '执行手 Executor' : 'Executor'}
              </span>
              <span className="text-xs text-slate-400">
                {zh ? '高速低价 · 写代码' : 'Fast · Edits & Tests'}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  {zh ? '供应商' : 'Provider'}
                </label>
                <select
                  value={currentExecutor.providerId}
                  onChange={(e) => handleExecutorProviderChange(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-sky-400 focus:bg-white"
                >
                  {config.providers.map((prov) => (
                    <option key={prov.id} value={prov.id}>
                      {localizeProviderName(prov.id, prov.name, locale)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  {zh ? '模型（旗舰优先）' : 'Model (Flagship First)'}
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
                      [{localizeTier(m.tier, locale)}] {m.id} — {m.note}
                    </option>
                  ))}
                  {!executorCatalog.some((m) => m.id === currentExecutor.modelId) && (
                    <option value="__manual__">
                      {zh ? `自定义: ${currentExecutor.modelId}` : `Custom: ${currentExecutor.modelId}`}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  {zh ? '思考强度（推理深度）' : 'Reasoning Effort'}
                </label>
                <select
                  value={currentExecutor.reasoningEffort ?? 'default'}
                  onChange={(e) => handleExecutorEffortChange(e.target.value as ReasoningEffort)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-sky-400 focus:bg-white"
                >
                  {effortOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.shortLabel}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 text-[11px] text-slate-600">
              {zh ? (
                <>
                  连续报错{' '}
                  <span className="font-semibold text-amber-600">
                    {currentRules.maxConsecutiveErrors} 次
                  </span>{' '}
                  自动交回架构师复盘
                </>
              ) : (
                <>
                  Auto-escalates to Planner after{' '}
                  <span className="font-semibold text-amber-600">
                    {currentRules.maxConsecutiveErrors}
                  </span>{' '}
                  consecutive errors
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Smart-Split Routing */}
      <div className="surface-card rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <GitBranch className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {zh
                  ? '模型分流模式（保护原工具里的模型选择器）'
                  : 'Model Routing Mode (Preserve Native Model Selectors)'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {routing.mode === 'smart-split'
                  ? zh
                    ? '当前为智能分流：只有选 ih:* 或下方触发槽位时才启用双模型，在原 Agent 里选其他模型将 100% 原样直通官方。'
                    : 'Smart-Split active: only checked models or ih:* enter InnerHop; all others pass straight through to official APIs.'
                  : zh
                    ? '当前为全量接管：接入后的工具所有请求都会经过 InnerHop 编排引擎。'
                    : 'Route All active: all requests from connected tools go through InnerHop.'}
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
              {zh ? '智能分流（推荐）' : 'Smart-Split (Recommended)'}
            </button>
            <button
              onClick={() => setRoutingMode('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                routing.mode === 'all'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {zh ? '全量接管' : 'Route All'}
            </button>
          </div>
        </div>

        {routing.mode === 'smart-split' && (
          <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-600">
                {zh ? (
                  <>
                    勾选客户端模型路由规则（已启用{' '}
                    <span className="font-semibold text-indigo-600">
                      {routing.triggerModelPatterns.length}
                    </span>{' '}
                    项关键字触发 + 固定{' '}
                    <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">
                      innerhop / ih:*
                    </code>
                    ）：
                  </>
                ) : (
                  <>
                    Client trigger rules (
                    <span className="font-semibold text-indigo-600">
                      {routing.triggerModelPatterns.length}
                    </span>{' '}
                    keyword rules + fixed{' '}
                    <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">
                      innerhop / ih:*
                    </code>
                    ):
                  </>
                )}
              </span>
              <span className="text-[11px] text-slate-400">
                {zh
                  ? '未勾选的模型在原工具中被选中时，将 100% 原样直通官方 API'
                  : 'Unchecked client models pass directly to official APIs untouched'}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/90 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="w-12 px-3 py-2.5 text-center">{zh ? '路由' : 'Route'}</th>
                    <th className="px-3 py-2.5">
                      {zh ? '客户端模型 / 匹配关键词' : 'Client Model / Pattern'}
                    </th>
                    <th className="px-3 py-2.5">{zh ? '适用客户端' : 'Target Clients'}</th>
                    <th className="px-3 py-2.5">{zh ? '当前去向' : 'Destination'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="bg-indigo-50/35">
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        aria-label="innerhop and ih:*"
                        className="h-4 w-4 rounded border-indigo-300 text-indigo-600 opacity-75"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono font-semibold text-slate-800">
                        innerhop / ih:*
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {zh
                          ? '专属策略代号（始终由编排引擎接管）'
                          : 'Dedicated strategy aliases (always orchestrated)'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {zh ? '所有接入工具' : 'All Harnesses'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                        {zh ? '→ 路由到本软件（固定）' : '→ InnerHop (Always)'}
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
                            aria-label={`Route ${row.pattern}`}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                              {row.pattern}
                            </code>
                            <span className="text-slate-700">
                              {zh ? row.labelZh : row.labelEn}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">
                          {zh ? row.clientsZh : row.clientsEn}
                        </td>
                        <td className="px-3 py-2.5">
                          {checked ? (
                            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
                              {zh ? '→ 路由到本软件（双模型）' : '→ InnerHop (Dual-Model)'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                              {zh ? '→ 原样直通官方 API' : '→ Direct Official API'}
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
                            aria-label={`Route ${customPattern}`}
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
                              {zh ? '移除' : 'Remove'}
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">
                          {zh ? '自定义关键词' : 'Custom Pattern'}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
                            {zh ? '→ 路由到本软件（双模型）' : '→ InnerHop (Dual-Model)'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500">
                {zh ? '添加自定义模型关键词：' : 'Add custom model keyword:'}
              </span>
              <input
                value={customSlot}
                onChange={(e) => setCustomSlot(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomTriggerSlot()}
                placeholder={zh ? '输入模型名或前缀关键词...' : 'Model name or prefix...'}
                className="w-48 rounded-lg border border-slate-200 px-2.5 py-1 text-xs outline-none focus:border-indigo-400"
              />
              <button
                onClick={addCustomTriggerSlot}
                className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 cursor-pointer"
              >
                {zh ? '+ 添加到分流表' : '+ Add Rule'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Harnesses */}
      <div className="surface-card rounded-2xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Wrench className="h-4 w-4 text-indigo-600" />
              {zh ? '一键接入我的 AI 编程工具' : 'Connect My AI Coding Harnesses'}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {zh ? (
                <>
                  开启前会自动备份原配置；关闭开关可 100% 无损恢复原状。也可直接在终端运行{' '}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                    innerhop run claude
                  </code>
                  。
                </>
              ) : (
                <>
                  Automatically backs up existing configs before modifying and restores byte-for-byte when disabled. Or launch directly via{' '}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                    innerhop run claude
                  </code>
                  .
                </>
              )}
            </p>
            <p className="mt-1 text-[11px] text-indigo-700 bg-indigo-50/70 inline-block rounded-lg px-2.5 py-1">
              {zh
                ? '提示：这里只决定「哪个前台工具连入本软件」，与上方选哪家厂商的模型无关；在任意已接入工具（如 Codex CLI、OpenCode）里都能调度你配好的 Claude / OpenAI / Gemini / DeepSeek 官方 API 模型。'
                : 'Note: This section only picks which frontend tool connects to InnerHop — independent from the backend LLM providers selected above (any connected harness can run Claude / OpenAI / Gemini / DeepSeek).'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {harnesses.map((h) => {
            const lh = localizeHarnessText(h.id, h.name, h.description, h.guideSteps, locale);
            return (
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{lh.name}</span>
                      {h.surface === 'gui-and-cli' && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200/80">
                          {zh ? '桌面端 + 终端' : 'Desktop + CLI'}
                        </span>
                      )}
                      {h.surface === 'cli-only' && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200/80">
                          {zh ? '仅限终端 CLI' : 'CLI Only'}
                        </span>
                      )}
                      {h.surface === 'gui-manual' && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200/80">
                          {zh ? 'IDE / GUI 插件' : 'IDE / GUI'}
                        </span>
                      )}
                      {h.mode === 'one-click' && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            h.installed
                              ? 'bg-slate-200/70 text-slate-700'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {h.installed
                            ? zh
                              ? '已检测到本机环境'
                              : 'Detected'
                            : zh
                              ? '未检测到命令（可预配置）'
                              : 'Not detected (Pre-config)'}
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
                          ? zh
                            ? '处理中...'
                            : 'Working...'
                          : h.enabled
                            ? zh
                              ? '已接入 · 点击还原'
                              : 'Connected · Restore'
                            : zh
                              ? '一键接入'
                              : 'One-Click Connect'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setGuideHarness(h)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        {zh ? '查看 3 步配置' : 'Setup Guide'}
                      </button>
                    )}
                  </div>

                  <p className="mt-1.5 text-xs text-slate-500">{lh.description}</p>
                </div>

                {h.mode === 'one-click' && h.configPath && (
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate max-w-[300px]" title={h.configPath}>
                      {zh ? `配置：${h.configPath}` : `Config: ${h.configPath}`}
                    </span>
                    {h.hasBackup && (
                      <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                        <Sparkles className="h-3 w-3" />{' '}
                        {zh ? '已安全备份原配置' : 'Backup saved'}
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
                      {zh ? '复制 Base URL' : 'Copy Base URL'}
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
                      {zh
                        ? `复制模型名 (${h.copyConfig.modelName})`
                        : `Copy Model (${h.copyConfig.modelName})`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Setup modal */}
      {guideHarness && guideHarness.copyConfig && modalHarnessText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h4 className="text-base font-semibold text-slate-900">
              {zh ? `${modalHarnessText.name} 接入指南` : `${modalHarnessText.name} Setup Guide`}
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              {zh
                ? '只需照抄下面 3 个参数填入插件设置，即可马上用上双模型编排：'
                : 'Copy these 3 settings into your tool’s OpenAI-Compatible provider settings:'}
            </p>

            <div className="mt-4 space-y-2.5 rounded-xl bg-slate-50 p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  {zh ? 'Provider 类型：' : 'Provider Type:'}
                </span>
                <span className="font-semibold text-slate-800">
                  {guideHarness.copyConfig.providerLabel}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Base URL:</span>
                <div className="flex items-center gap-1.5">
                  <code className="rounded bg-white px-2 py-0.5 border border-slate-200 text-slate-800">
                    {guideHarness.copyConfig.baseUrl}
                  </code>
                  <button
                    onClick={() => copyText('modal-url', guideHarness.copyConfig!.baseUrl)}
                    className="text-indigo-600 hover:underline cursor-pointer"
                  >
                    {copiedKey === 'modal-url' ? (zh ? '已复制' : 'Copied') : zh ? '复制' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Model ID:</span>
                <div className="flex items-center gap-1.5">
                  <code className="rounded bg-white px-2 py-0.5 border border-slate-200 text-slate-800">
                    {guideHarness.copyConfig.modelName}
                  </code>
                  <button
                    onClick={() => copyText('modal-model', guideHarness.copyConfig!.modelName)}
                    className="text-indigo-600 hover:underline cursor-pointer"
                  >
                    {copiedKey === 'modal-model' ? (zh ? '已复制' : 'Copied') : zh ? '复制' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  {zh ? 'API Key（随便填非空字符）：' : 'API Key (any non-empty string):'}
                </span>
                <code className="rounded bg-white px-2 py-0.5 border border-slate-200 text-slate-800">
                  {guideHarness.copyConfig.apiKeyPlaceholder}
                </code>
              </div>
            </div>

            {modalHarnessText.guideSteps && (
              <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-xs text-slate-600">
                {modalHarnessText.guideSteps.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ol>
            )}

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setGuideHarness(null)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
              >
                {zh ? '我知道了' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
