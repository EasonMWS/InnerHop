import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Globe,
  Home,
  KeyRound,
  Layers,
  Sliders,
} from 'lucide-react';
import {
  detectInitialLocale,
  saveLocale,
  type Locale,
} from './i18n';
import { CockpitPage } from './pages/CockpitPage';
import { HomePage } from './pages/HomePage';
import { ModelsPage } from './pages/ModelsPage';
import type {
  EngineState,
  HarnessStatus,
  OrchestratorConfig,
  SessionState,
} from './types';

type NavTab = 'home' | 'providers' | 'strategies' | 'cockpit';

const TAB_TITLES: Record<Locale, Record<NavTab, string>> = {
  zh: {
    home: '控制台 · 引擎状态与工具接入',
    providers: '模型 API Key · 供应商配置与连通测速',
    strategies: '编排策略 · 架构师与执行手配对',
    cockpit: '实时驾驶舱 · 会话流转与费用统计',
  },
  en: {
    home: 'Dashboard · Engine Status & Harnesses',
    providers: 'API Keys · Providers & Connection Test',
    strategies: 'Strategies · Planner-Executor Rules',
    cockpit: 'Live Cockpit · Sessions & Cost Savings',
  },
};

export const App: React.FC = () => {
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale());
  const [tab, setTab] = useState<NavTab>('home');
  const [engine, setEngine] = useState<EngineState>({
    running: true,
    url: 'http://127.0.0.1:8787',
  });
  const [config, setConfig] = useState<OrchestratorConfig | null>(null);
  const [harnesses, setHarnesses] = useState<HarnessStatus[]>([]);
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedSidebarUrl, setCopiedSidebarUrl] = useState(false);

  const apiBaseUrl = engine.url;
  const isWin32 =
    typeof window !== 'undefined' &&
    (window.orchestratorDesktop?.platform === 'win32' ||
      navigator.platform.toLowerCase().includes('win'));

  const toggleLocale = () => {
    const next: Locale = locale === 'zh' ? 'en' : 'zh';
    setLocale(next);
    saveLocale(next);
  };

  const fetchAll = useCallback(
    async (baseUrl: string) => {
      try {
        const [cfgRes, hRes, sRes] = await Promise.all([
          fetch(`${baseUrl}/api/config`),
          fetch(`${baseUrl}/api/harnesses`),
          fetch(`${baseUrl}/api/sessions`),
        ]);
        if (cfgRes.ok) setConfig(await cfgRes.json());
        if (hRes.ok) setHarnesses(await hRes.json());
        if (sRes.ok) setSessions(await sRes.json());
        setLoadError(null);
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : locale === 'zh'
              ? '无法连接本地编排引擎'
              : 'Unable to reach local engine',
        );
      }
    },
    [locale],
  );

  useEffect(() => {
    let cleanupListener: (() => void) | undefined;
    (async () => {
      if (window.orchestratorDesktop) {
        const status = await window.orchestratorDesktop.getEngineStatus();
        setEngine(status);
        cleanupListener = window.orchestratorDesktop.onEngineStateChanged((next) => {
          setEngine(next);
        });
        if (status.running) {
          await fetchAll(status.url);
        }
      } else {
        await fetchAll('http://127.0.0.1:8787');
      }
    })();
    return () => cleanupListener?.();
  }, [fetchAll]);

  useEffect(() => {
    if (!engine.running) return;
    fetchAll(engine.url);

    const es = new EventSource(`${engine.url}/api/events`);
    es.addEventListener('init', (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        sessions: SessionState[];
        config: OrchestratorConfig;
      };
      setSessions(data.sessions);
      setConfig(data.config);
    });
    es.addEventListener('session_update', (ev) => {
      const updated = JSON.parse((ev as MessageEvent).data) as SessionState;
      setSessions((prev) => {
        const rest = prev.filter((s) => s.id !== updated.id);
        return [updated, ...rest].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        );
      });
    });
    es.addEventListener('session_deleted', (ev) => {
      const { id } = JSON.parse((ev as MessageEvent).data) as { id: string };
      setSessions((prev) => prev.filter((s) => s.id !== id));
    });
    es.addEventListener('config_update', (ev) => {
      setConfig(JSON.parse((ev as MessageEvent).data) as OrchestratorConfig);
    });

    return () => es.close();
  }, [engine.running, engine.url, fetchAll]);

  const handleToggleEngine = async () => {
    if (window.orchestratorDesktop) {
      const next = await window.orchestratorDesktop.toggleEngine();
      setEngine(next);
      if (next.running) await fetchAll(next.url);
    }
  };

  const handleSaveConfig = async (next: OrchestratorConfig) => {
    const res = await fetch(`${apiBaseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      setConfig(await res.json());
      const hRes = await fetch(`${apiBaseUrl}/api/harnesses`);
      if (hRes.ok) setHarnesses(await hRes.json());
    }
  };

  const handleSelectPreset = async (presetId: string) => {
    if (!config) return;
    await handleSaveConfig({ ...config, activePresetId: presetId });
  };

  const handleToggleHarness = async (id: string, enable: boolean) => {
    const res = await fetch(
      `${apiBaseUrl}/api/harnesses/${encodeURIComponent(id)}/${
        enable ? 'enable' : 'disable'
      }`,
      { method: 'POST' },
    );
    if (res.ok) {
      setHarnesses(await res.json());
    }
  };

  const copySidebarUrl = async () => {
    await navigator.clipboard.writeText(`${engine.url}/v1`);
    setCopiedSidebarUrl(true);
    setTimeout(() => setCopiedSidebarUrl(false), 1600);
  };

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode; badge?: number }> =
    locale === 'zh'
      ? [
          { id: 'home', label: '首页 · 控制台', icon: <Home className="h-4 w-4" /> },
          { id: 'providers', label: '模型 API Key', icon: <KeyRound className="h-4 w-4" /> },
          { id: 'strategies', label: '编排策略', icon: <Sliders className="h-4 w-4" /> },
          {
            id: 'cockpit',
            label: '实时驾驶舱',
            icon: <Activity className="h-4 w-4" />,
            badge: sessions.length || undefined,
          },
        ]
      : [
          { id: 'home', label: 'Home · Console', icon: <Home className="h-4 w-4" /> },
          { id: 'providers', label: 'API Keys', icon: <KeyRound className="h-4 w-4" /> },
          { id: 'strategies', label: 'Strategies', icon: <Sliders className="h-4 w-4" /> },
          {
            id: 'cockpit',
            label: 'Live Cockpit',
            icon: <Activity className="h-4 w-4" />,
            badge: sessions.length || undefined,
          },
        ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#F5F7FB]">
      {/* Sidebar */}
      <aside className="flex w-[236px] shrink-0 flex-col border-r border-slate-200/80 bg-white/95 backdrop-blur-sm">
        <div className="app-drag flex h-14 items-center gap-3 border-b border-slate-100 px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-indigo-500 to-sky-500 text-white shadow-sm shadow-indigo-500/20">
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold tracking-tight text-slate-900">
                InnerHop
              </span>
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                v0.2.0
              </span>
            </div>
            <div className="truncate text-[11px] text-slate-400">
              {locale === 'zh'
                ? '强模型规划 · 快模型落地'
                : 'Strong Planner · Fast Executor'}
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`group relative flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition cursor-pointer ${
                  active
                    ? 'bg-indigo-50/90 text-indigo-700 shadow-xs ring-1 ring-indigo-100'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                }`}
              >
                {active && (
                  <span className="absolute left-1 top-2.5 bottom-2.5 w-1 rounded-full bg-indigo-600" />
                )}
                <span className="flex items-center gap-2.5 pl-1">
                  {item.icon}
                  {item.label}
                </span>
                {item.badge !== undefined && (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-indigo-700">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="px-3 pb-1">
          <button
            onClick={toggleLocale}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5" />
              {locale === 'zh' ? '界面语言' : 'Language'}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              {locale === 'zh' ? '中文 / EN' : 'EN / 中文'}
            </span>
          </button>
        </div>

        <div className="m-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 text-[11px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium text-slate-700">
              <span
                className={`h-2 w-2 rounded-full ${
                  engine.running ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                }`}
              />
              <span>
                {engine.running
                  ? locale === 'zh'
                    ? '本地服务运行中'
                    : 'Local Engine Running'
                  : locale === 'zh'
                    ? '引擎已暂停'
                    : 'Engine Paused'}
              </span>
            </div>
            <button
              onClick={copySidebarUrl}
              title={locale === 'zh' ? '复制 /v1 代理地址' : 'Copy /v1 proxy URL'}
              className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-indigo-600 cursor-pointer"
            >
              {copiedSidebarUrl ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-slate-500">
            {engine.url}/v1
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className={`app-drag flex h-10 shrink-0 items-center justify-between border-b border-slate-200/70 bg-[#F5F7FB]/90 px-6 ${
            isWin32 ? 'pr-36' : 'pr-6'
          } backdrop-blur-sm`}
        >
          <span className="text-xs font-medium text-slate-500">
            {TAB_TITLES[locale][tab]}
          </span>
          <span
            className={`app-no-drag inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              engine.running
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80'
                : 'bg-slate-200/70 text-slate-600'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                engine.running ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            {engine.running ? 'Proxy Ready' : 'Paused'}
          </span>
        </header>

        <main className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top_right,_rgba(99,102,241,0.06),_transparent_55%)] p-6">
          <div className="mx-auto max-w-5xl">
            {!engine.running ? (
              <div className="surface-card rounded-2xl p-8 text-center">
                <h3 className="text-base font-semibold text-slate-900">
                  {locale === 'zh'
                    ? 'Orchestrator 引擎当前已暂停'
                    : 'Orchestrator Engine is Paused'}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {locale === 'zh'
                    ? '点击下方按钮启动本地代理引擎即可恢复双模型编排与模型分流。'
                    : 'Click below to start the local proxy and resume dual-model orchestration.'}
                </p>
                <button
                  onClick={handleToggleEngine}
                  className="mt-4 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 cursor-pointer shadow-sm"
                >
                  {locale === 'zh' ? '启动引擎' : 'Start Engine'}
                </button>
              </div>
            ) : !config ? (
              <div className="surface-card rounded-2xl p-10 text-center text-sm text-slate-500">
                {loadError
                  ? `${locale === 'zh' ? '连接引擎失败：' : 'Connection error: '}${loadError}`
                  : locale === 'zh'
                    ? '正在加载配置...'
                    : 'Loading configuration...'}
              </div>
            ) : (
              <>
                {tab === 'home' && (
                  <HomePage
                    locale={locale}
                    engine={engine}
                    config={config}
                    harnesses={harnesses}
                    sessions={sessions}
                    onToggleEngine={handleToggleEngine}
                    onSelectPreset={handleSelectPreset}
                    onSaveConfig={handleSaveConfig}
                    onToggleHarness={handleToggleHarness}
                    onNavigate={setTab}
                  />
                )}
                {(tab === 'providers' || tab === 'strategies') && (
                  <ModelsPage
                    locale={locale}
                    section={tab}
                    config={config}
                    apiBaseUrl={apiBaseUrl}
                    onSaveConfig={handleSaveConfig}
                  />
                )}
                {tab === 'cockpit' && (
                  <CockpitPage
                    locale={locale}
                    config={config}
                    sessions={sessions}
                    apiBaseUrl={apiBaseUrl}
                    onRefresh={() => fetchAll(apiBaseUrl)}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
export default App;
