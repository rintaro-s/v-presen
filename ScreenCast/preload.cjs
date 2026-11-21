// 窓 (ui.html) と見えない取り込み窓 (capture.html) が使う最小限の橋
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screencast', {
  // 取り込み窓
  onStart: (cb) => ipcRenderer.on('capture:start', (_e, cfg) => cb(cfg)),
  onStop: (cb) => ipcRenderer.on('capture:stop', () => cb()),
  sendFrame: (name, bytes, width, height) => ipcRenderer.send('capture:frame', name, bytes, width, height),
  sendState: (name, state) => ipcRenderer.send('capture:state', name, state),
  // 設定の窓
  settings: () => ipcRenderer.invoke('ui:settings'),
  status: () => ipcRenderer.invoke('ui:status'),
  pick: (slot, kind) => ipcRenderer.invoke('ui:pick', slot, kind),
  choose: (slot, source) => ipcRenderer.invoke('ui:choose', slot, source),
  clear: (slot) => ipcRenderer.invoke('ui:clear', slot),
  quality: (slot, q) => ipcRenderer.invoke('ui:quality', slot, q),
  server: (s) => ipcRenderer.invoke('ui:server', s),
  firewall: () => ipcRenderer.invoke('ui:firewall'),
  language: (l) => ipcRenderer.invoke('ui:language', l),
  control: (action) => ipcRenderer.invoke('ui:control', action),
  open: (url) => ipcRenderer.invoke('ui:open', url),
  copy: (text) => ipcRenderer.invoke('ui:copy', text),
});
