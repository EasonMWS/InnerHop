import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Brain,
  Clock,
  Eraser,
  RotateCcw,
  Trash2,
  Zap,
} from 'lucide-react';
import type { OrchestratorConfig, SessionState } from '../types';
import { localizeHarnessLabel, localizePreset, type Locale } from '../i18n';

interface CockpitPageProps {
  locale: Locale;
  config: OrchestratorConfig;
  sessions: SessionState[];
  apiBaseUrl: string;
  onRefresh: () => Promise<void>;
}

function formatTokenCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

function formatClockTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function resolveStrategyInfo(
  session: SessionState,
  config: OrchestratorConfig,
  locale: Locale,
): {
  strategyName: string;
  plannerModel: string;
  executorModel: string;
} {
  const zh = locale === 'zh';
  const matched = config.presets.find((p) => p.id === session.presetId);
  const localizedMatched = matched
    ? localizePreset(matched.id, matched.name, matched.description, locale).name
    : undefined;
  const strategyName =
    session.presetId === '__custom__'
      ? zh
        ? '自定义组合'
        : 'Custom Pair'
      : localizedMatched ?? session.presetName ?? session.presetId;
  const plannerModel =
    session.plannerModel ??
    (session.presetId === '__custom__'
      ? config.customPair?.planner.modelId
      : matched?.planner.modelId) ??
    (zh ? '架构师模型' : 'Planner');
  const executorModel =
    session.executorModel ??
    (session.presetId === '__custom__'
      ? config.customPair?.executor.modelId
      : matched?.executor.modelId) ??
    (zh ? '执行手模型' : 'Executor');

  return { strategyName, plannerModel, executorModel };
}

function getTimelineBadge(
  type: SessionState['timeline'][number]['type'],
  locale: Locale,
): { label: string; cls: string } {
  const zh = locale === 'zh';
  switch (type) {
    case 'handoff':
      return {
        label: zh ? '交棒执行手' : 'Handoff',
        cls: 'bg-emerald-100 text-emerald-700',
      };
    case 'escalation':
      return {
        label: zh ? '回退架构师' : 'Escalate',
        cls: 'bg-amber-100 text-amber-800',
      };
    case 'turn_complete':
      return {
        label: zh ? '本轮完成' : 'Turn Done',
        cls: 'bg-indigo-100 text-indigo-700',
      };
    case 'tool_error':
      return {
        label: zh ? '调用异常' : 'Error',
        cls: 'bg-rose-100 text-rose-700',
      };
    case 'phase_change':
      return {
        label: zh ? '状态切换' : 'Phase',
        cls: 'bg-sky-100 text-sky-700',
      };
    case 'manual_override':
      return {
        label: zh ? '手动干预' : 'Override',
        cls: 'bg-slate-200 text-slate-700',
      };
  }
}

export const CockpitPage: React.FC<CockpitPageProps> = ({
  locale,
  config,
  sessions,
  apiBaseUrl,
  onRefresh,
}) => {
  const zh = locale === 'zh';
  const [selectedId, setSelectedId] = useState<string | null>(
    sessions[0]?.id ?? null,
  );
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (sessions.length > 0 && !sessions.some((s) => s.id === selectedId)) {
      setSelectedId(sessions[0].id);
    }
  }, [sessions, selectedId]);

  const active = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;

  const handleForcePlanner = async (id: string) => {
    await fetch(`${apiBaseUrl}/api/sessions/${encodeURIComponent(id)}/force-planner`, {
      method: 'POST',
    });
    await onRefresh();
  };

  const handleReset = async (id: string) => {
    await fetch(`${apiBaseUrl}/api/sessions/${encodeURIComponent(id)}/reset`, {
      method: 'POST',
    });
    await onRefresh();
  };

  const handleDelete = async (id: string) => {
    await fetch(`${apiBaseUrl}/api/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    await onRefresh();
  };

  const handleClearAll = async () => {
    setClearing(true);
    try {
      await fetch(`${apiBaseUrl}/api/sessions`, { method: 'DELETE' });
      setSelectedId(null);
      await onRefresh();
    } finally {
      setClearing(false);
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
        <Activity className="h-10 w-10 text-slate-300" />
        <h3 className="mt-3 text-base font-semibold text-slate-700">
          {zh ? '暂无对话编排记录' : 'No Orchestrated Sessions Yet'}
        </h3>
        <p className="mt-1 max-w-md text-xs text-slate-500">
          {zh
            ? '当你通过已接入的 AI 工具发起对话后，这里会展示每次是哪个模型在工作、具体执行方案、Token 消耗以及帮你省下的费用。'
            : 'Send a prompt from any connected AI coding tool to see Planner/Executor handoffs, active plans, token counts, and real-time cost savings here.'}
        </p>
      </div>
    );
  }

  const savedUsd = active
    ? Math.max(0, active.usage.baselinePlannerCostUsd - active.usage.actualCostUsd)
    : 0;
  const savedPct =
    active && active.usage.baselinePlannerCostUsd > 0
      ? Math.round((savedUsd / active.usage.baselinePlannerCostUsd) * 100)
      : 0;
  const activeMeta = active ? resolveStrategyInfo(active, config, locale) : null;

  return (
    <div className="space-y-4">
      <div className="surface-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {zh
              ? '实时驾驶舱 · 对话分工与费用明细'
              : 'Live Cockpit · Model Handoffs & Cost Savings'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {zh
              ? '左侧按对话标题选择记录，右侧查看架构师与执行手的分工详情、方案内容与 Token 账单。'
              : 'Select a session on the left to inspect model split, active plans, and token savings.'}
          </p>
        </div>
        <button
          disabled={clearing}
          onClick={handleClearAll}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
        >
          <Eraser className="h-3.5 w-3.5" />
          {clearing ? (zh ? '清空中...' : 'Clearing...') : zh ? '清空记录' : 'Clear All'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Session list */}
        <div className="lg:col-span-4 space-y-2.5">
          {sessions.map((s, idx) => {
            const isSelected = s.id === active?.id;
            const meta = resolveStrategyInfo(s, config, locale);
            const displayTitle =
              s.title ||
              (zh ? `历史对话 #${sessions.length - idx}` : `Session #${sessions.length - idx}`);
            return (
              <div
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`rounded-xl border p-3.5 transition cursor-pointer ${
                  isSelected
                    ? 'border-indigo-400 bg-indigo-50/50 shadow-xs'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    {localizeHarnessLabel(s.harnessHint, locale)}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      s.phase === 'PLANNING'
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-sky-100 text-sky-700'
                    }`}
                  >
                    {s.phase === 'PLANNING' ? (
                      <>
                        <Brain className="h-3 w-3" /> {zh ? '架构师规划' : 'Planning'}
                      </>
                    ) : (
                      <>
                        <Zap className="h-3 w-3" />{' '}
                        {zh ? `执行中 (${s.execSteps}步)` : `Executing (${s.execSteps})`}
                      </>
                    )}
                  </span>
                </div>

                <div
                  className="mt-2 line-clamp-2 text-xs font-semibold leading-snug text-slate-900"
                  title={displayTitle}
                >
                  {displayTitle}
                </div>

                <div className="mt-1.5 truncate font-mono text-[11px] text-slate-500">
                  {meta.plannerModel} → {meta.executorModel}
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    {s.planVersion > 0
                      ? zh
                        ? `方案 v${s.planVersion}`
                        : `Plan v${s.planVersion}`
                      : zh
                        ? '直接对话'
                        : 'Direct Q&A'}{' '}
                    · {zh ? `回退 ${s.escalationCount} 次` : `Escalations: ${s.escalationCount}`}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatClockTime(s.updatedAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail */}
        {active && activeMeta && (
          <div className="lg:col-span-8 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                        active.phase === 'PLANNING'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-sky-100 text-sky-700'
                      }`}
                    >
                      {active.phase === 'PLANNING' ? (
                        <>
                          <Brain className="h-3.5 w-3.5" />{' '}
                          {zh ? '当前：架构师主导' : 'Phase: Planner'}
                        </>
                      ) : (
                        <>
                          <Zap className="h-3.5 w-3.5" />{' '}
                          {zh
                            ? `当前：执行手工作中（第 ${active.execSteps} 步）`
                            : `Phase: Executor (Step ${active.execSteps})`}
                        </>
                      )}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                      {zh ? '来源：' : 'Client: '}
                      {localizeHarnessLabel(active.harnessHint, locale)}
                    </span>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
                      {zh ? '策略：' : 'Strategy: '}
                      {activeMeta.strategyName}
                    </span>
                    {active.forcePlannerNext && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                        {zh ? '已预约下轮交回架构师' : 'Planner forced on next turn'}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2.5 text-sm font-semibold text-slate-900">
                    {active.title ||
                      (zh ? '历史对话记录（未提取到首句标题）' : 'Historical Session')}
                  </h3>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleForcePlanner(active.id)}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                  >
                    {zh ? '下轮交回架构师' : 'Force Planner Next'}
                  </button>
                  <button
                    onClick={() => handleReset(active.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> {zh ? '重置状态' : 'Reset'}
                  </button>
                  <button
                    onClick={() => handleDelete(active.id)}
                    title={zh ? '删除此会话记录' : 'Delete session'}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3.5 py-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-indigo-700">
                      {zh ? '架构师 (Planner)' : 'Planner'}
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-slate-700">
                      {activeMeta.plannerModel}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {zh ? '累计消耗：输入 ' : 'Usage: In '}
                    <span className="font-semibold text-slate-700">
                      {formatTokenCount(active.usage.plannerInput)}
                    </span>
                    {zh ? ' · 输出 ' : ' · Out '}
                    <span className="font-semibold text-slate-700">
                      {formatTokenCount(active.usage.plannerOutput)}
                    </span>{' '}
                    tokens
                  </div>
                </div>

                <div className="rounded-xl border border-sky-100 bg-sky-50/40 px-3.5 py-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sky-700">
                      {zh ? '执行手 (Executor)' : 'Executor'}
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-slate-700">
                      {activeMeta.executorModel}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {zh ? '累计消耗：输入 ' : 'Usage: In '}
                    <span className="font-semibold text-slate-700">
                      {formatTokenCount(active.usage.executorInput)}
                    </span>
                    {zh ? ' · 输出 ' : ' · Out '}
                    <span className="font-semibold text-slate-700">
                      {formatTokenCount(active.usage.executorOutput)}
                    </span>{' '}
                    tokens
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3.5 text-xs">
                <div>
                  <div className="text-slate-500">{zh ? '实际花费' : 'Actual Cost'}</div>
                  <div className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">
                    ${active.usage.actualCostUsd.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">
                    {zh ? '全程强模型估算' : 'All-Planner Baseline'}
                  </div>
                  <div className="mt-0.5 text-sm font-bold tabular-nums text-slate-500 line-through">
                    ${active.usage.baselinePlannerCostUsd.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">{zh ? '本会话节省' : 'Session Savings'}</div>
                  <div className="mt-0.5 text-sm font-bold tabular-nums text-emerald-600">
                    ${savedUsd.toFixed(4)} ({savedPct}%)
                  </div>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
                <span className="truncate">
                  {zh ? '内部标识：' : 'Session ID: '}
                  {active.id}
                </span>
                <span className="shrink-0">
                  {zh ? '更新于 ' : 'Updated '}
                  {formatClockTime(active.updatedAt)}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-900">
                  {zh
                    ? `架构师交付方案 ${active.planVersion > 0 ? `(第 ${active.planVersion} 版)` : ''}`
                    : `Planner Handoff Plan ${active.planVersion > 0 ? `(v${active.planVersion})` : ''}`}
                </h4>
              </div>
              {active.activePlan ? (
                <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-700 font-sans">
                  {active.activePlan}
                </pre>
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  {zh
                    ? '本会话当前为直接问答或只读调研，尚未触发「架构师定方案 → 交棒执行手写代码」的切换流程。'
                    : 'No handoff plan yet (direct Q&A or still in read-only planning phase).'}
                </p>
              )}
              {active.replanIf && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">
                      {zh ? '自动回退条件：' : 'Re-plan triggers:'}{' '}
                    </span>
                    {active.replanIf}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <h4 className="text-sm font-semibold text-slate-900">
                {zh ? '模型协作与每轮执行记录' : 'Collaboration & Turn Timeline'}
              </h4>
              <div className="mt-3 space-y-2.5">
                {active.timeline.length === 0 && (
                  <p className="text-xs text-slate-400">
                    {zh ? '暂无明细记录' : 'No timeline events recorded yet.'}
                  </p>
                )}
                {[...active.timeline].reverse().map((ev) => {
                  const badge = getTimelineBadge(ev.type, locale);
                  return (
                    <div
                      key={ev.id}
                      className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3"
                    >
                      <span
                        className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-800">
                              {ev.summary}
                            </span>
                            {ev.model && (
                              <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 border border-slate-200">
                                {ev.model}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 shrink-0">
                            {new Date(ev.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        {ev.detail && (
                          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">
                            {ev.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
