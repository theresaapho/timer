const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    setFullscreen: (value) => ipcRenderer.send('go-fullscreen', value),
    setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
    toggleMini: (isMini) => ipcRenderer.send('toggle-mini-mode', isMini),
    minimizeApp: () => ipcRenderer.send('minimize-app'),
    closeApp: () => ipcRenderer.send('close-app'),
    
    // API AUTO-SYNC CHO FILE WATCHER
    startWatching: (path) => ipcRenderer.send('start-watching', path),
    stopWatching: () => ipcRenderer.send('stop-watching'),
    onAutoSync: (callback) => ipcRenderer.on('auto-sync-trigger', (event, filename) => callback(filename))
});