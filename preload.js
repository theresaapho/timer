const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    setFullscreen: (value) => ipcRenderer.send('go-fullscreen', value),
    setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
    toggleMini: (isMini) => ipcRenderer.send('toggle-mini-mode', isMini),
    minimizeApp: () => ipcRenderer.send('minimize-app'),
    closeApp: () => ipcRenderer.send('close-app')
});