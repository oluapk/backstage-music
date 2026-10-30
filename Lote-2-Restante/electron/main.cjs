const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const entryUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
let win;
let updateState = { status: 'idle', version: app.getVersion() };
let updateTimer;

function sendUpdate(status, extra = {}) {
  updateState = { status, version: app.getVersion(), ...extra };
  if (win && !win.isDestroyed()) win.webContents.send('updates:state', updateState);
}
async function checkUpdates() {
  if (!app.isPackaged) { sendUpdate('development'); return updateState; }
  if (['checking', 'downloading', 'downloaded'].includes(updateState.status)) return updateState;
  try { await autoUpdater.checkForUpdates(); }
  catch { sendUpdate('error', { message: 'Não foi possível verificar atualizações. Confira a conexão e tente novamente.' }); }
  return updateState;
}
function installUpdate() {
  if (updateState.status === 'downloaded') setTimeout(() => autoUpdater.quitAndInstall(false, true), 100);
}
function assertLocalSender(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame?.url !== entryUrl) throw new Error('Origem não autorizada.');
}
function openDownloadOrWebsite(url) {
  try {
    const target = new URL(url);
    if (target.protocol === 'https:' && target.hostname === 'backstage-music.vercel.app') void shell.openExternal(target.href);
  } catch { /* Ignora esquemas e endereços não autorizados. */ }
}
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 800, minHeight: 600,
    backgroundColor: '#101510', title: 'Backstage Music',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(entryUrl);
  win.webContents.setWindowOpenHandler(({ url }) => { openDownloadOrWebsite(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== entryUrl) { event.preventDefault(); openDownloadOrWebsite(url); }
  });
  win.webContents.on('did-finish-load', () => sendUpdate(updateState.status, updateState));
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
autoUpdater.on('update-available', info => sendUpdate('downloading', { nextVersion: info.version, percent: 0 }));
autoUpdater.on('update-not-available', () => sendUpdate('current'));
autoUpdater.on('download-progress', info => sendUpdate('downloading', { nextVersion: updateState.nextVersion, percent: Math.round(info.percent) }));
autoUpdater.on('error', error => {
  console.warn('Atualização indisponível:', error.message);
  sendUpdate('error', { message: 'Não foi possível acessar a atualização. Confira a conexão e tente novamente.' });
});
autoUpdater.on('update-downloaded', async info => {
  sendUpdate('downloaded', { nextVersion: info.version });
  const options = { type: 'info', title: 'Atualização pronta', message: 'Backstage Music ' + info.version + ' está pronto para instalar.', detail: 'Reinicie quando terminar de ouvir. Suas preferências e downloads serão mantidos.', buttons: ['Reiniciar e atualizar', 'Depois'], defaultId: 1, cancelId: 1 };
  const result = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (result.response === 0) installUpdate();
});

ipcMain.handle('updates:get', event => { assertLocalSender(event); return updateState; });
ipcMain.handle('updates:check', event => { assertLocalSender(event); return checkUpdates(); });
ipcMain.handle('updates:install', event => { assertLocalSender(event); installUpdate(); });

app.whenReady().then(() => {
  createWindow();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Aplicativo', submenu: [{ role: 'quit', label: 'Sair' }] },
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Exibir', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'togglefullscreen', label: 'Tela cheia' }] },
    { label: 'Ajuda', submenu: [{ label: 'Verificar atualizações', click: async () => {
      const state = await checkUpdates();
      if (state.status === 'downloaded') installUpdate();
      else if (['current', 'error', 'development'].includes(state.status)) dialog.showMessageBox(win, { message: state.status === 'current' ? 'Você já está na versão mais recente.' : state.status === 'development' ? 'As atualizações funcionam na versão instalada.' : state.message });
    } }] },
  ]));
  const initialCheck = setTimeout(() => void checkUpdates(), 10000);
  initialCheck.unref();
  updateTimer = setInterval(() => void checkUpdates(), 6 * 60 * 60 * 1000);
  updateTimer.unref();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => clearInterval(updateTimer));
