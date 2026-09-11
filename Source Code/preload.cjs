const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  pickFolder: kind => ipcRenderer.invoke('pick-folder', kind),
  settings: input => ipcRenderer.invoke('settings', input),
  mapLayers: input => ipcRenderer.invoke('map-layers', input),
  progress: change => ipcRenderer.invoke('progress', change),
  raidPreferences: input => ipcRenderer.invoke('raid-preferences', input),
  mode: value => ipcRenderer.invoke('mode', value),
  refreshLogs: () => ipcRenderer.invoke('refresh-logs'),
  loadCatalog: mode => ipcRenderer.invoke('load-catalog', mode),
  importCatalog: mode => ipcRenderer.invoke('import-catalog', mode),
  inspectCatalog: mode => ipcRenderer.invoke('inspect-catalog', mode),
  applyCatalog: input => ipcRenderer.invoke('apply-catalog', input),
  scanTasks: mode => ipcRenderer.invoke('scan-task-screenshot', mode),
  scanItem: mode => ipcRenderer.invoke('scan-item-screenshot', mode),
  loadItems: mode => ipcRenderer.invoke('load-items', mode),
  refreshItemPrices: mode => ipcRenderer.invoke('refresh-item-prices', mode),
  itemHotkey: enabled => ipcRenderer.invoke('item-hotkey-settings', enabled),
  itemValueThreshold: value => ipcRenderer.invoke('item-value-settings', value),
  questMeta: input => ipcRenderer.invoke('quest-meta', input),
  customMarkers: input => ipcRenderer.invoke('custom-markers', input),
  raidEvent: input => ipcRenderer.invoke('raid-event', input),
  exportBackup: () => ipcRenderer.invoke('export-backup'),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  openData: () => ipcRenderer.invoke('open-data'),
  onObserver: callback => {
    const handler = (_e, state) => callback(state);
    ipcRenderer.on('observer', handler);
    return () => ipcRenderer.removeListener('observer', handler);
  },
  onQuestProgress: callback => {
    const handler = (_e, event) => callback(event);
    ipcRenderer.on('quest-progress', handler);
    return () => ipcRenderer.removeListener('quest-progress', handler);
  },
  onOcrProgress: callback => {
    const handler = (_e, event) => callback(event);
    ipcRenderer.on('ocr-progress', handler);
    return () => ipcRenderer.removeListener('ocr-progress', handler);
  },
  onItemHotkey: callback => {
    const handler = (_e, event) => callback(event);
    ipcRenderer.on('item-hotkey-status', handler);
    return () => ipcRenderer.removeListener('item-hotkey-status', handler);
  },
  onItemHotkeyResult: callback => {
    const handler = (_e, event) => callback(event);
    ipcRenderer.on('item-hotkey-result', handler);
    return () => ipcRenderer.removeListener('item-hotkey-result', handler);
  }
});
