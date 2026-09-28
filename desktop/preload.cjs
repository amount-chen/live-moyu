const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('moyu', {
  initialTheme: process.argv.includes('--moyu-theme=dark') ? 'dark' : 'light',
  initialCompact: process.argv.includes('--moyu-compact=true'),
  toggleCompact: () => ipcRenderer.invoke('toggle-compact'),
  toggleTheme: () => ipcRenderer.invoke('toggle-theme'),
  state: () => ipcRenderer.invoke('state'),
  send: text => ipcRenderer.invoke('send', text),
  hide: () => ipcRenderer.invoke('hide'),
  acknowledge: () => ipcRenderer.invoke('acknowledge'),
  shortcut: value => ipcRenderer.invoke('shortcut', value),
  installBridge: () => ipcRenderer.invoke('install-bridge'),
  openExtension: () => ipcRenderer.invoke('open-extension'),
  onState: callback => ipcRenderer.on('state', (_event, value) => callback(value)),
  onFocus: callback => ipcRenderer.on('input-focus', () => callback())
});
