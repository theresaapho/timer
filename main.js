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

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 260,
        minHeight: 140,
        frame: false, // ẨN THANH VIỀN MẶC ĐỊNH ĐỂ LÀM APP NỔI CAO CẤP
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
        mainWindow = null;
    });
}

// LẮNG NGHE CÁC SỰ KIỆN ĐIỀU KHIỂN NATIVE OS
ipcMain.on('go-fullscreen', (event, value) => {
    if (mainWindow) mainWindow.setFullScreen(value);
});

ipcMain.on('set-always-on-top', (event, value) => {
    if (mainWindow) {
        mainWindow.setAlwaysOnTop(value, value ? 'screen-saver' : 'normal');
    }
});

// Điều khiển kích thước khi chuyển sang chế độ Cửa sổ nổi (Mini Mode)
ipcMain.on('toggle-mini-mode', (event, isMini) => {
    if (mainWindow) {
        if (isMini) {
            mainWindow.setResizable(true);
            mainWindow.setSize(260, 140);
            mainWindow.setAlwaysOnTop(true, 'screen-saver'); // Luôn đè lên mọi game khác
            mainWindow.setResizable(false);
        } else {
            mainWindow.setResizable(true);
            mainWindow.setSize(1000, 700);
            mainWindow.setAlwaysOnTop(false);
            mainWindow.center();
        }
    }
});

// Các nút tắt/thu nhỏ của thanh tiêu đề tùy chỉnh
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