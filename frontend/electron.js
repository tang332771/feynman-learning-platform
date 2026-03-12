/* eslint-env node */

import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

// 某些 Windows 环境（安全软件/受控文件夹访问）可能阻止默认缓存目录写入。
// 将 userData 放到临时目录，避免 “Unable to create cache / 拒绝访问(0x5)”。
app.setPath('userData', path.join(app.getPath('temp'), 'feynman-platform-electron'));

// 部分显卡/驱动环境下可能出现 GPU 进程崩溃，导致窗口无法显示。
// 先禁用硬件加速作为兜底（开发阶段足够用）。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

function createWindow() {
  // eslint-disable-next-line no-console
  console.log('[electron] createWindow');

  mainWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    x: 100,
    y: 100,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    // eslint-disable-next-line no-console
    console.log('[electron] ready-to-show');
    // Windows 上有时窗口会在后台/被遮挡；短暂置顶可避免“看不见”
    mainWindow.setAlwaysOnTop(true);
    mainWindow.center();
    mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(false);
      }
    }, 1500);
  });

  const prodIndexUrl = pathToFileURL(path.join(__dirname, './dist/index.html')).toString();
  const startUrl = process.env.ELECTRON_START_URL || prodIndexUrl;

  // eslint-disable-next-line no-console
  console.log('[electron] startUrl:', startUrl);

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    // eslint-disable-next-line no-console
    console.error('[electron] render-process-gone:', details);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // eslint-disable-next-line no-console
    console.error('[electron] did-fail-load:', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.loadURL(startUrl).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[electron] loadURL failed:', err);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_START_URL) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[electron] uncaughtException:', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
