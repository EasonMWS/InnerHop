import { contextBridge, ipcRenderer } from 'electron';

export interface EngineState {
  running: boolean;
  url: string;
}

contextBridge.exposeInMainWorld('orchestratorDesktop', {
  platform: process.platform,
  getEngineStatus: (): Promise<EngineState> => ipcRenderer.invoke('engine:status'),
  toggleEngine: (): Promise<EngineState> => ipcRenderer.invoke('engine:toggle'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  onEngineStateChanged: (cb: (state: EngineState) => void) => {
    const listener = (_ev: unknown, state: EngineState) => cb(state);
    ipcRenderer.on('engine:stateChanged', listener);
    return () => ipcRenderer.removeListener('engine:stateChanged', listener);
  },
});
