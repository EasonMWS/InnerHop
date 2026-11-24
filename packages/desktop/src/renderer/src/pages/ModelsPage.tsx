import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  KeyRound,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  OrchestratorConfig,
  PresetConfig,
  ProviderConfig,
  ReasoningEffort,
} from '../types';
import {
  getCatalogForProvider,
  getDefaultModelForRole,
  getReasoningEffortOptions,
  localizeTier,
  type CatalogModel,
} from '../data/modelCatalog';
import {
  localizePreset,
  localizeProviderName,
  type Locale,
} from '../i18n';

const BUILTIN_PROVIDER_IDS = new Set([
  'anthropic-api',
  'openai-api',
  'google-gemini',
  'deepseek-api',
  'openrouter-api',
  'ollama-local',
]);

interface ModelsPageProps {
  locale: Locale;
  section: 'providers' | 'strategies';
  config: OrchestratorConfig;
  apiBaseUrl: string;
  onSaveConfig: (next: OrchestratorConfig) => Promise<void>;
}

const TIER_BADGE_STYLES: Record<CatalogModel['tier'], string> = {
  旗舰: 'bg-indigo-100 text-indigo-700',
  主力: 'bg-sky-100 text-sky-700',
  轻量: 'bg-emerald-100 text-emerald-700',
};

interface ModelRoleCardProps {
  locale: Locale;
  role: 'planner' | 'executor';
  value: PresetConfig['planner'];
  providers: ProviderConfig[];
  onChange: (next: PresetConfig['planner']) => void;
}

const ModelRoleCard: React.FC<ModelRoleCardProps> = ({
  locale,
  role,
  value,
  providers,
  onChange,
}) => {
  const zh = locale === 'zh';
  const isPlanner = role === 'planner';
  const activeProvider = providers.find((p) => p.id === value.providerId) ?? providers[0];
  const catalog = getCatalogForProvider(activeProvider, locale);
  const effortOptions = getReasoningEffortOptions(locale);

  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-xs ${
        isPlanner ? 'border-indigo-200' : 'border-sky-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={`flex items-center gap-2 text-sm font-semibold ${
            isPlanner ? 'text-indigo-700' : 'text-sky-700'
          }`}
        >
          {isPlanner ? <Brain className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
          {isPlanner
            ? zh
              ? '强模型 · 架构师 (Planner)'
              : 'Frontier Model · Planner'
            : zh
              ? '次级模型 · 执行手 (Executor)'
              : 'Fast Model · Executor'}
        </div>
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
            isPlanner ? 'bg-indigo-50 text-indigo-700' : 'bg-sky-50 text-sky-700'
          }`}
        >
          {isPlanner
            ? zh
              ? '重推理 · 消耗少'
              : 'Deep Reasoning · Low Token Use'
            : zh
              ? '高速度 · 省费用'
              : 'High Speed · Cost Saver'}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {isPlanner
          ? zh
            ? '选推理强、架构稳的模型：只读看代码与定方案，遇连续报错时也会由它出面复盘。'
            : 'Pick a strong reasoning model for read-only exploration, architecture planning, and error recovery.'
          : zh
            ? '选速度快、单价低、工具调用稳的模型：承担 80%+ 写代码、改文件与跑测试。'
            : 'Pick a fast, low-cost model with reliable tool calling to execute edits and run tests.'}
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-600">
            {zh ? '1. 选择供应商' : '1. Provider'}
          </label>
          <select
            value={value.providerId}
            onChange={(e) => {
              const nextProv = providers.find((p) => p.id === e.target.value);
              const defModel = getDefaultModelForRole(nextProv, role);
              onChange({
                ...value,
                providerId: e.target.value,
                modelId: defModel.id,
                inputPricePerM: defModel.inPrice,
                outputPricePerM: defModel.outPrice,
              });
            }}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:bg-white"
          >
            {providers.map((prov) => (
              <option key={prov.id} value={prov.id}>
                {localizeProviderName(prov.id, prov.name, locale)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600">
            {zh
              ? '2. 模型 ID（从下方目录点选，或手动输入任意模型名）'
              : '2. Model ID (Pick from catalog below or type any ID)'}
          </label>
          <input
            value={value.modelId}
            onChange={(e) => onChange({ ...value, modelId: e.target.value })}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400"
          />

          <div className="mt-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
              <span>
                {activeProvider
                  ? localizeProviderName(activeProvider.id, activeProvider.name, locale)
                  : ''}{' '}
                {zh ? '可选模型（按旗舰 → 轻量排序）' : 'models (Flagship → Fast)'}
              </span>
              <span>{zh ? '点击即填入' : 'Click to select'}</span>
            </div>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/70 p-1.5">
              {catalog.map((item) => {
                const selected = value.modelId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        modelId: item.id,
                        inputPricePerM: item.inPrice,
                        outputPricePerM: item.outPrice,
                      })
                    }
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition cursor-pointer ${
                      selected
                        ? isPlanner
                          ? 'bg-indigo-50 ring-1 ring-indigo-300'
                          : 'bg-sky-50 ring-1 ring-sky-300'
                        : 'bg-white/80 hover:bg-white'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${TIER_BADGE_STYLES[item.tier]}`}
                        >
                          {localizeTier(item.tier, locale)}
                        </span>
                        {item.vendor && (
                          <span className="shrink-0 text-[10px] font-medium text-slate-400">
                            [{item.vendor}]
                          </span>
                        )}
                        <span className="truncate font-mono text-xs font-semibold text-slate-800">
                          {item.id}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        {item.note}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600">
            {zh
              ? '3. 思考强度（自动适配各厂商官方协议）'
              : '3. Reasoning Effort (Auto-mapped per vendor)'}
          </label>
          <select
            value={value.reasoningEffort ?? 'default'}
            onChange={(e) =>
              onChange({
                ...value,
                reasoningEffort: e.target.value as ReasoningEffort,
              })
            }
            className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:bg-white"
          >
            {effortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export const ModelsPage: React.FC<ModelsPageProps> = ({
  locale,
  section,
  config,
  apiBaseUrl,
  onSaveConfig,
}) => {
  const zh = locale === 'zh';
  const [draft, setDraft] = useState<OrchestratorConfig>(() => structuredClone(config));
  const [editingPresetId, setEditingPresetId] = useState<string>(() => {
    const found = config.presets.find((p) => p.id === config.activePresetId);
    return found ? found.id : config.presets[0]?.id ?? '';
  });
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { loading: boolean; ok?: boolean; message?: string; latencyMs?: number }>
  >({});

  useEffect(() => {
    setDraft(structuredClone(config));
  }, [config]);

  useEffect(() => {
    setDeleteWarning(null);
  }, [section]);

  const selectedPreset =
    draft.presets.find((p) => p.id === editingPresetId) ?? draft.presets[0];

  const updatePreset = (patch: Partial<PresetConfig>) => {
    if (!selectedPreset) return;
    setDraft((prev) => ({
      ...prev,
      presets: prev.presets.map((p) =>
        p.id === selectedPreset.id ? { ...p, ...patch } : p,
      ),
    }));
  };

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    setDraft((prev) => ({
      ...prev,
      providers: prev.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  };

  const addCustomProvider = () => {
    setDeleteWarning(null);
    const id = `custom-${Date.now().toString(36)}`;
    setDraft((prev) => ({
      ...prev,
      providers: [
        ...prev.providers,
        {
          id,
          name: zh ? '自定义中转站 (OpenAI 兼容)' : 'Custom Relay (OpenAI Compat)',
          type: 'openai-compat',
          baseUrl: 'https://api.example.com/v1',
          apiKey: '',
        },
      ],
    }));
  };

  const deleteCustomProvider = async (id: string) => {
    setDeleteWarning(null);
    const usedByPreset = draft.presets.find(
      (p) => p.planner.providerId === id || p.executor.providerId === id,
    );
    const usedByCustomPair =
      draft.customPair &&
      (draft.customPair.planner.providerId === id ||
        draft.customPair.executor.providerId === id);

    if (usedByPreset || usedByCustomPair) {
      setDeleteWarning(
        usedByPreset
          ? zh
            ? `无法删除：该中转站正被策略「${usedByPreset.name}」使用，请先切换该策略的供应商。`
            : `Cannot delete: used by strategy "${usedByPreset.name}". Switch its provider first.`
          : zh
            ? '无法删除：该中转站正被当前「自定义」组合使用，请先在首页切换供应商。'
            : 'Cannot delete: currently used by the active Custom Pair on Home.',
      );
      return;
    }

    const nextDraft: OrchestratorConfig = {
      ...draft,
      providers: draft.providers.filter((p) => p.id !== id),
    };
    setDraft(nextDraft);
    await onSaveConfig(nextDraft);
  };

  const addCustomPreset = () => {
    setDeleteWarning(null);
    const id = `custom-${Date.now().toString(36)}`;
    const base = selectedPreset ?? draft.presets[0];
    const newPreset: PresetConfig = {
      id,
      name: zh ? '我的自定义策略' : 'My Custom Strategy',
      description: zh
        ? '自定义强模型规划 + 快模型执行组合'
        : 'Custom Planner + Executor orchestration pair',
      planner: { ...base.planner },
      executor: { ...base.executor },
      rules: { ...base.rules },
    };
    setEditingPresetId(id);
    setDraft((prev) => ({
      ...prev,
      activePresetId: id,
      presets: [...prev.presets, newPreset],
    }));
  };

  const deletePreset = async (id: string) => {
    setDeleteWarning(null);
    if (draft.presets.length <= 1) {
      setDeleteWarning(zh ? '至少需要保留 1 个策略。' : 'At least 1 strategy must be kept.');
      return;
    }
    const remaining = draft.presets.filter((p) => p.id !== id);
    const nextActive =
      draft.activePresetId === id ? remaining[0].id : draft.activePresetId;
    if (editingPresetId === id) {
      setEditingPresetId(remaining[0].id);
    }
    const nextDraft: OrchestratorConfig = {
      ...draft,
      activePresetId: nextActive,
      presets: remaining,
    };
    setDraft(nextDraft);
    await onSaveConfig(nextDraft);
  };

  const handleSave = async () => {
    setSaving(true);
    setDeleteWarning(null);
    try {
      await onSaveConfig(draft);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestProvider = async (provider: ProviderConfig) => {
    const catalog = getCatalogForProvider(provider, 'zh');
    const defaultModel =
      catalog.find((m) => m.tier === '轻量')?.id ??
      catalog[catalog.length - 1]?.id ??
      catalog[0]?.id ??
      'gpt-6-luna';

    setTestResults((prev) => ({ ...prev, [provider.id]: { loading: true } }));
    try {
      await onSaveConfig(draft);
      const res = await fetch(`${apiBaseUrl}/api/providers/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: provider.id, modelId: defaultModel }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        latencyMs: number;
        message: string;
      };
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: {
          loading: false,
          ok: data.ok,
          latencyMs: data.latencyMs,
          message: data.message,
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: {
          loading: false,
          ok: false,
          message: err instanceof Error ? err.message : zh ? '测试失败' : 'Test failed',
        },
      }));
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Bar */}
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {section === 'providers'
              ? zh
                ? '模型供应商与 API Key 配置'
                : 'LLM Providers & API Keys'
              : zh
                ? '编排策略与双模型协作规则'
                : 'Orchestration Strategies & Rules'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {section === 'providers'
              ? zh
                ? '请先在此填好官方开发者 API Key 并测速，再前往首页或编排策略选择对应模型。'
                : 'Enter your official developer API Keys and test connectivity before picking models.'
              : zh
                ? '预先编排「架构师 + 执行手」模型组合与报错回退阈值，首页可直接下拉切换。'
                : 'Configure saved Planner + Executor pairs and automatic escalation thresholds.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />{' '}
              {zh ? '配置已保存生效' : 'Saved'}
            </span>
          )}
          <button
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 cursor-pointer"
          >
            <Save className="h-4 w-4" />
            {saving ? (zh ? '保存中...' : 'Saving...') : zh ? '保存配置' : 'Save'}
          </button>
        </div>
      </div>

      {deleteWarning && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{deleteWarning}</span>
        </div>
      )}

      {section === 'strategies' && selectedPreset && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {draft.presets.map((p) => {
                  const isEditing = p.id === selectedPreset.id;
                  const canDelete = draft.presets.length > 1 && p.id.startsWith('custom-');
                  const lp = localizePreset(p.id, p.name, p.description, locale);
                  return (
                    <div
                      key={p.id}
                      className={`inline-flex items-center rounded-xl border transition ${
                        isEditing
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPresetId(p.id);
                          setDraft((prev) => ({ ...prev, activePresetId: p.id }));
                        }}
                        className="px-3.5 py-2 text-xs font-semibold cursor-pointer"
                      >
                        {lp.name}
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          title={zh ? '删除该自建策略' : 'Delete custom strategy'}
                          onClick={() => deletePreset(p.id)}
                          className="pr-2.5 pl-1 py-2 text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  onClick={addCustomPreset}
                  className="inline-flex items-center gap-1 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-indigo-400 hover:text-indigo-600 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" /> {zh ? '新建策略' : 'New Strategy'}
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-500">
                  {zh ? '策略名称' : 'Strategy Name'}
                </label>
                <input
                  value={selectedPreset.name}
                  onChange={(e) => updatePreset({ name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500">
                  {zh ? '一句话说明' : 'Description'}
                </label>
                <input
                  value={selectedPreset.description}
                  onChange={(e) => updatePreset({ description: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <ModelRoleCard
              locale={locale}
              role="planner"
              value={selectedPreset.planner}
              providers={draft.providers}
              onChange={(planner) => updatePreset({ planner })}
            />
            <ModelRoleCard
              locale={locale}
              role="executor"
              value={selectedPreset.executor}
              providers={draft.providers}
              onChange={(executor) => updatePreset({ executor })}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              {zh
                ? '协作规则（不用写 JSON，拖动即可）'
                : 'Collaboration & Escalation Rules'}
            </h3>

            <div className="mt-4 space-y-4">
              <label className="flex items-center justify-between rounded-xl bg-slate-50 p-3.5 cursor-pointer">
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    {zh
                      ? '规划阶段锁定只读，禁止修改文件'
                      : 'Enforce read-only toolset during PLANNING'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {zh
                      ? '推荐开启。防止强模型没想清楚就动手改代码，方案定稿后再交给执行手改。'
                      : 'Recommended. Prevents writes until the Planner hands off a verified plan.'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={selectedPreset.rules.readOnlyPlanning}
                  onChange={(e) =>
                    updatePreset({
                      rules: {
                        ...selectedPreset.rules,
                        readOnlyPlanning: e.target.checked,
                      },
                    })
                  }
                  className="h-5 w-5 accent-indigo-600"
                />
              </label>

              <div className="rounded-xl bg-slate-50 p-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-800">
                      {zh
                        ? '执行手连续报错几次后，自动请架构师救场？'
                        : 'Auto-escalate to Planner after N consecutive tool errors'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {zh
                        ? '设为 2 次最均衡（第 1 次报错允许执行手自己小修，第 2 次仍挂就交回强模型）。'
                        : '2 is optimal: lets Executor self-recover once before escalating.'}
                    </div>
                  </div>
                  <span className="rounded-lg bg-white px-3 py-1 text-sm font-bold text-indigo-600 border border-slate-200">
                    {selectedPreset.rules.maxConsecutiveErrors === 0
                      ? zh
                        ? '关闭'
                        : 'Off'
                      : zh
                        ? `${selectedPreset.rules.maxConsecutiveErrors} 次`
                        : `${selectedPreset.rules.maxConsecutiveErrors} errors`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  value={selectedPreset.rules.maxConsecutiveErrors}
                  onChange={(e) =>
                    updatePreset({
                      rules: {
                        ...selectedPreset.rules,
                        maxConsecutiveErrors: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-3 w-full accent-indigo-600"
                />
              </div>

              <div className="rounded-xl bg-slate-50 p-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-800">
                      {zh
                        ? '执行手连续跑几步后，请架构师巡检一次？'
                        : 'Periodic Planner checkpoint every N Executor steps'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {zh
                        ? '防止小模型在长任务里越跑越偏（0 表示仅在报错或主动上报时才回退）。'
                        : 'Prevents drift on long tasks (0 = escalate on errors/handoff only).'}
                    </div>
                  </div>
                  <span className="rounded-lg bg-white px-3 py-1 text-sm font-bold text-indigo-600 border border-slate-200">
                    {selectedPreset.rules.reviewEverySteps === 0
                      ? zh
                        ? '关闭'
                        : 'Off'
                      : zh
                        ? `${selectedPreset.rules.reviewEverySteps} 步`
                        : `${selectedPreset.rules.reviewEverySteps} steps`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={selectedPreset.rules.reviewEverySteps}
                  onChange={(e) =>
                    updatePreset({
                      rules: {
                        ...selectedPreset.rules,
                        reviewEverySteps: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-3 w-full accent-indigo-600"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {section === 'providers' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs text-emerald-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                {zh ? (
                  <>
                    合规模式：仅使用官方开发者 API Key 或本地 Ollama；严禁接入消费级 ChatGPT / Claude 订阅会话，绝不混用官方 API 与订阅额度。所有 Key 仅保存在本机 <code>~/.orchestrator/config.json</code>。
                  </>
                ) : (
                  <>
                    Compliance Mode: Developer API Keys & local Ollama only. Consumer subscriptions (ChatGPT Plus/Pro, Claude Pro/Max) are strictly excluded. Keys stay locally in <code>~/.orchestrator/config.json</code>.
                  </>
                )}
              </span>
            </div>
            <button
              onClick={addCustomProvider}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />{' '}
              {zh ? '添加自定义中转站' : 'Add Custom Relay'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {draft.providers.map((prov) => {
              const test = testResults[prov.id];
              const isCustomProvider = !BUILTIN_PROVIDER_IDS.has(prov.id);
              return (
                <div
                  key={prov.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <KeyRound className="h-4 w-4 shrink-0 text-indigo-500" />
                      <input
                        value={localizeProviderName(prov.id, prov.name, locale)}
                        onChange={(e) =>
                          updateProvider(prov.id, { name: e.target.value })
                        }
                        className="w-full font-semibold text-sm text-slate-900 bg-transparent border-b border-transparent focus:border-indigo-400 outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        disabled={test?.loading}
                        onClick={() => handleTestProvider(prov)}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 cursor-pointer"
                      >
                        <Wifi className="h-3.5 w-3.5" />
                        {test?.loading
                          ? zh
                            ? '测试中...'
                            : 'Testing...'
                          : zh
                            ? '测速验 Key'
                            : 'Test Key'}
                      </button>
                      {isCustomProvider && (
                        <button
                          type="button"
                          title={zh ? '删除该自定义中转站' : 'Delete custom relay'}
                          onClick={() => deleteCustomProvider(prov.id)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500">
                        {zh ? '接口地址 (Base URL)' : 'Base URL'}
                      </label>
                      <input
                        value={prov.baseUrl}
                        onChange={(e) =>
                          updateProvider(prov.id, { baseUrl: e.target.value })
                        }
                        className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-indigo-400"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-500">
                        API Key
                      </label>
                      <input
                        type="password"
                        placeholder="sk-..."
                        value={prov.apiKey}
                        onChange={(e) =>
                          updateProvider(prov.id, { apiKey: e.target.value })
                        }
                        className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-indigo-400"
                      />
                    </div>

                    {prov.id === 'ollama-local' ? (
                      <div className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
                        {zh
                          ? '本地离线运行 · 零费用、无隐私外泄、无平台风控'
                          : 'Offline local runtime · Zero cost, private, no rate limits'}
                      </div>
                    ) : prov.id === 'openai-api' ? (
                      <div className="rounded-lg bg-emerald-50/70 px-2.5 py-1.5 text-[11px] text-emerald-700">
                        {zh
                          ? '标准 API Key 模式 · 若含 ChatGPT Pro 赠金额度，按 OpenAI 条款仅限非 Codex 客户端使用'
                          : 'Developer API Key mode · If using ChatGPT Pro promotional API credits, OpenAI terms restrict usage to non-Codex clients'}
                      </div>
                    ) : (
                      <div className="rounded-lg bg-emerald-50/70 px-2.5 py-1.5 text-[11px] text-emerald-700">
                        {zh
                          ? '标准 API Key 模式 · 符合开发者条款、无订阅封号风险'
                          : 'Developer API Key mode · ToS-compliant, zero subscription ban risk'}
                      </div>
                    )}
                  </div>

                  {test && !test.loading && (
                    <div
                      className={`mt-3 flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-xs ${
                        test.ok
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {test.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <span>{test.message}</span>
                        {test.latencyMs !== undefined && (
                          <span className="ml-1.5 opacity-75">
                            ({test.latencyMs}ms)
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
