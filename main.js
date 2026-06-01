const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// ==========================================================================
// CẤU HÌNH GIẢI PHÁP LAI (HYBRID CONFIGURATION)
// ==========================================================================
const USE_ONLINE_SERVER = true; // Đổi thành TRUE sau khi bạn đã deploy thành công lên Render
const ONLINE_RENDER_URL = 'https://timer-for-tohotopia.onrender.com'; // Đường dẫn Render của bạn
// ==========================================================================

// Nếu chạy offline, tự động khởi tạo server chạy ngầm
if (!USE_ONLINE_SERVER) {
    require('./server.js');
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 850,
        minHeight: 650,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    const targetURL = USE_ONLINE_SERVER ? ONLINE_RENDER_URL : 'http://localhost:3000';
    mainWindow.loadURL(targetURL);

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

ipcMain.on('go-fullscreen', (event, value) => {
    if (mainWindow) mainWindow.setFullScreen(value);
});

ipcMain.on('set-always-on-top', (event, value) => {
    if (mainWindow) {
        mainWindow.setAlwaysOnTop(value, value ? 'screen-saver' : 'normal');
    }
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