const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// ==========================================================================
// CẤU HÌNH GIẢI PHÁP LAI (HYBRID CONFIGURATION)
// ==========================================================================
const USE_ONLINE_SERVER = true; // Đổi thành TRUE sau khi bạn đã deploy thành công lên Render
const ONLINE_RENDER_URL = 'https://timer-for-tohotopia.onrender.com'; // Đường dẫn Render của bạn
// ==========================================================================

if (!USE_ONLINE_SERVER) {
    require('./server.js');
}

let mainWindow;
let fsWatcher = null; 
let lastWatchTrigger = 0;
const WATCH_DEBOUNCE = 1500; 
let watchStartTime = 0;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 250,
        minHeight: 130,
        frame: false, 
        hasShadow: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    const targetURL = USE_ONLINE_SERVER ? ONLINE_RENDER_URL : 'http://localhost:3000';
    mainWindow.loadURL(targetURL);

    mainWindow.on('closed', function () {
        if (fsWatcher) {
            fsWatcher.close();
        }
        mainWindow = null;
    });

    // Tự động báo cho giao diện đổi biểu tượng nút Phóng to/Thu nhỏ khi thay đổi trạng thái cửa sổ ngoài đời thực
    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window-maximized', true);
    });
    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('window-maximized', false);
    });
}

// LẮNG NGHE TỰ ĐỘNG THEO DÕI FILE (AUTO-SYNC VỚI TOHOTOPIA)
ipcMain.on('start-watching', (event, watchPath) => {
    if (fsWatcher) {
        fsWatcher.close();
        fsWatcher = null;
    }

    const fs = require('fs');
    watchStartTime = Date.now();

    try {
        fsWatcher = fs.watch(watchPath, (eventType, filename) => {
            if (Date.now() - watchStartTime < 5000) return;

            if (filename && filename.endsWith('.dat') && filename.includes('map_archive_continue')) {
                const now = Date.now();
                if (now - lastWatchTrigger > WATCH_DEBOUNCE) {
                    lastWatchTrigger = now;
                    if (mainWindow) {
                        mainWindow.webContents.send('auto-sync-trigger', filename);
                    }
                }
            }
        });
        console.log("Successfully started watching directory:", watchPath);
    } catch (err) {
        console.error("Failed to start file watcher:", err.message);
    }
});

ipcMain.on('stop-watching', () => {
    if (fsWatcher) {
        fsWatcher.close();
        fsWatcher = null;
        console.log("Stopped watching directory.");
    }
});

// Các sự kiện điều khiển cửa sổ khác
ipcMain.on('go-fullscreen', (event, value) => {
    if (mainWindow) mainWindow.setFullScreen(value);
});

ipcMain.on('set-always-on-top', (event, value) => {
    if (mainWindow) {
        mainWindow.setAlwaysOnTop(value, value ? 'screen-saver' : 'normal');
    }
});

ipcMain.on('toggle-mini-mode', (event, isMini) => {
    if (mainWindow) {
        if (isMini) {
            mainWindow.setResizable(true);
            mainWindow.setSize(260, 140);
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
            mainWindow.setResizable(false);
        } else {
            mainWindow.setResizable(true);
            mainWindow.setSize(1000, 700);
            mainWindow.setAlwaysOnTop(false);
            mainWindow.center();
        }
    }
});

// ĐIỀU KHIỂN PHÓNG TO / THU NHỎ CỦA HỆ ĐIỀU HÀNH (MAXIMIZE / UNMAXIMIZE)
ipcMain.on('maximize-app', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('minimize-app', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('close-app', () => {
    if (mainWindow) mainWindow.close();
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});