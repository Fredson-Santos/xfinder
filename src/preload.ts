/**
 * XFinder — Electron Preload Script
 *
 * Exposes window.__TAURI__.core.invoke() so that js/app.js works
 * without any modifications (same API surface as the Tauri version).
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__TAURI__', {
  core: {
    invoke: (cmd: string, args?: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke(cmd, args),
  },
});
