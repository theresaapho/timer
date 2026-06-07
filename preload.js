const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    setFullscreen: (value) => ipcRenderer.send('go-fullscreen', value),
    setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
    toggleMini: (isMini) => ipcRenderer.send('toggle-mini-mode', isMini),
    minimizeApp: () => ipcRenderer.send('minimize-app'),
    maximizeApp: () => ipcRenderer.send('maximize-app'), // THÊM API PHÓNG TO
    closeApp: () => ipcRenderer.send('close-app'),
    
    startWatching: (path) => ipcRenderer.send('start-watching', path),
    stopWatching: () => ipcRenderer.send('stop-watching'),
    onAutoSync: (callback) => ipcRenderer.on('auto-sync-trigger', (event, filename) => callback(filename)),
    onMaximizeChange: (callback) => ipcRenderer.on('window-maximized', (event, isMaximized) => callback(isMaximized))
});