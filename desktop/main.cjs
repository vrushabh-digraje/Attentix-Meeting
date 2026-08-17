const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 800,
        minHeight: 600,
        title: "Attentix Desktop",
        backgroundColor: "#000000",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            webSecurity: true
        }
    });

    // Hide native menu bar for a premium, clean layout
    mainWindow.setMenuBarVisibility(false);

    // Switch between dev server and production dist files
    const isDev = !app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        // Open DevTools in dev mode
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Automatically grant camera, microphone, and screen access permissions
app.on('web-contents-created', (event, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'audioCapture', 'videoCapture', 'openExternal'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });
});

app.whenReady().then(() => {
    // IPC bridge to fetch screen sources for custom React source-selector dialog
    ipcMain.handle('get-screen-sources', async () => {
        const sources = await desktopCapturer.getSources({ 
            types: ['window', 'screen'],
            thumbnailSize: { width: 320, height: 180 } 
        });
        return sources.map(source => ({
            id: source.id,
            name: source.name,
            thumbnail: source.thumbnail.toDataURL()
        }));
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
