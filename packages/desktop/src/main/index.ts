import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createOrchestratorServer,
  CUSTOM_PRESET_ID,
  type OrchestratorConfig,
  type OrchestratorServerHandle,
} from '@innerhop/core';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let quitInProgress = false;
let serverHandle: OrchestratorServerHandle | null = null;
let engineRunning = false;
let engineUrl = 'http://127.0.0.1:8787';
let detachConfigListener: (() => void) | null = null;

function resolveIconPath(): string {
  const candidates = [
    join(app.getAppPath(), 'resources/icon.png'),
    join(process.resourcesPath, 'resources/icon.png'),
    join(__dirname, '../../resources/icon.png'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function startEngine(): Promise<{ running: boolean; url: string }> {
  if (engineRunning && serverHandle) {
    return { running: true, url: engineUrl };
  }
  serverHandle = createOrchestratorServer();
  const cfg = serverHandle.configStore.getConfig();
  const info = await serverHandle.listen(cfg.port, cfg.host);
  engineRunning = true;
  engineUrl = info.url;

  const onCfgUpdate = () => refreshTrayMenu();
  serverHandle.configStore.on('config_update', onCfgUpdate);
  detachConfigListener = () => serverHandle?.configStore.off('config_update', onCfgUpdate);

  refreshTrayMenu();
  return { running: true, url: engineUrl };
}

async function stopEngine(): Promise<{ running: boolean; url: string }> {
  detachConfigListener?.();
  detachConfigListener = null;
  if (serverHandle) {
    await serverHandle.close();
    serverHandle = null;
  }
  engineRunning = false;
  refreshTrayMenu();
  return { running: false, url: engineUrl };
}

async function quitApplication(): Promise<void> {
  if (quitInProgress) return;
  quitInProgress = true;
  isQuitting = true;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    mainWindow = null;
    await stopEngine();
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
    }
    tray = null;
  } finally {
    app.exit(0);
  }
}

function updateConfigFromTray(mutator: (cfg: OrchestratorConfig) => OrchestratorConfig): void {
  if (!serverHandle) return;
  const next = mutator(serverHandle.configStore.getConfig());
  const saved = serverHandle.configStore.updateConfig(next);
  serverHandle.harnessManager.syncEnabledHarnesses(saved.activePresetId, saved.presets);
  refreshTrayMenu();
}

function refreshTrayMenu(): void {
  if (!tray) return;

  const cfg = serverHandle?.configStore.getConfig() ?? null;
  const activePreset = cfg ? serverHandle!.configStore.resolvePreset() : null;
  const isCustom = cfg?.activePresetId === CUSTOM_PRESET_ID;

  const statusLine = engineRunning && activePreset
    ? `● 运行中 · ${activePreset.planner.modelId} → ${activePreset.executor.modelId}`
    : engineRunning
      ? `● 引擎运行中 (${engineUrl})`
      : '○ 引擎已暂停';

  const presetSubmenu: Electron.MenuItemConstructorOptions[] = cfg
    ? [
        ...cfg.presets.map((p) => ({
          label: `${p.name}`,
          type: 'radio' as const,
          checked: cfg.activePresetId === p.id,
          click: () => {
            updateConfigFromTray((c) => ({ ...c, activePresetId: p.id }));
          },
        })),
        ...(isCustom
          ? [
              { type: 'separator' as const },
              {
                label: '自定义（当前首页搭配）',
                type: 'radio' as const,
                checked: true,
              },
            ]
          : []),
      ]
    : [{ label: '引擎未启动', enabled: false }];

  const routingSubmenu: Electron.MenuItemConstructorOptions[] = cfg
    ? [
        {
          label: '智能分流（推荐，不劫持原模型）',
          type: 'radio',
          checked: cfg.routing.mode === 'smart-split',
          click: () => {
            updateConfigFromTray((c) => ({
              ...c,
              routing: { ...c.routing, mode: 'smart-split' },
            }));
          },
        },
        {
          label: '全量接管（全部请求走编排）',
          type: 'radio',
          checked: cfg.routing.mode === 'all',
          click: () => {
            updateConfigFromTray((c) => ({
              ...c,
              routing: { ...c.routing, mode: 'all' },
            }));
          },
        },
      ]
    : [{ label: '引擎未启动', enabled: false }];

  const menu = Menu.buildFromTemplate([
    { label: statusLine, enabled: false },
    { type: 'separator' },
    {
      label: '打开 InnerHop 主界面',
      click: showMainWindow,
    },
    {
      label: '切换编排策略',
      enabled: Boolean(cfg),
      submenu: presetSubmenu,
    },
    {
      label: '模型分流模式',
      enabled: Boolean(cfg),
      submenu: routingSubmenu,
    },
    {
      label: `复制代理地址 (${engineUrl}/v1)`,
      click: () => {
        clipboard.writeText(`${engineUrl}/v1`);
      },
    },
    { type: 'separator' },
    {
      label: engineRunning ? '暂停编排引擎' : '启动编排引擎',
      click: async () => {
        if (engineRunning) await stopEngine();
        else await startEngine();
        mainWindow?.webContents.send('engine:stateChanged', {
          running: engineRunning,
          url: engineUrl,
        });
      },
    },
    {
      label: '退出 InnerHop',
      click: () => {
        void quitApplication();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(
    engineRunning && activePreset
      ? `InnerHop · 运行中\n${activePreset.planner.modelId} → ${activePreset.executor.modelId}`
      : 'InnerHop · 已暂停',
  );
}

function createWindow(): void {
  const icon = nativeImage.createFromPath(resolveIconPath());
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 650,
    title: 'InnerHop',
    icon,
    autoHideMenuBar: true,
    backgroundColor: '#F5F7FB',
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#F5F7FB',
            symbolColor: '#475569',
            height: 40,
          },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createTray(): void {
  const iconSize = process.platform === 'darwin' ? 18 : 16;
  const icon = nativeImage.createFromPath(resolveIconPath()).resize({ width: iconSize, height: iconSize });
  tray = new Tray(icon);
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  refreshTrayMenu();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    await startEngine().catch((err) => {
      console.error('Failed to start InnerHop engine:', err);
    });

    ipcMain.handle('engine:status', () => ({
      running: engineRunning,
      url: engineUrl,
    }));

    ipcMain.handle('engine:toggle', async () => {
      if (engineRunning) return stopEngine();
      return startEngine();
    });

    ipcMain.handle('app:openExternal', (_ev, targetUrl: string) => {
      try {
        const parsed = new URL(targetUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return Promise.resolve();
        }
        return shell.openExternal(parsed.toString());
      } catch {
        return Promise.resolve();
      }
    });

    createWindow();
    createTray();
  });

  app.on('activate', () => {
    showMainWindow();
  });

  app.on('before-quit', (event) => {
    if (!quitInProgress) {
      event.preventDefault();
      void quitApplication();
    }
  });

  app.on('window-all-closed', () => {
    // Keep alive in system tray until user explicitly quits
  });
}
