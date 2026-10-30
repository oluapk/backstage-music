import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);

test('updater baixa sem interromper e só instala depois da escolha do usuário', async () => {
  const autoUpdater = new EventEmitter();
  let installed = 0;
  autoUpdater.checkForUpdates = async () => { autoUpdater.emit('checking-for-update'); autoUpdater.emit('update-not-available'); };
  autoUpdater.quitAndInstall = () => { installed++; };
  const app = new EventEmitter();
  Object.assign(app, { getVersion: () => '1.0.2', isPackaged: true, whenReady: () => Promise.resolve(), quit() {} });
  const handlers = new Map();
  let window;
  class FakeWindow {
    constructor(options) { this.options = options; this.webContents = new EventEmitter(); this.webContents.send = () => {}; this.webContents.setWindowOpenHandler = () => {}; window = this; }
    loadURL(url) { this.url = url; }
    isDestroyed() { return false; }
    static getAllWindows() { return [window]; }
  }
  const electron = { app, BrowserWindow: FakeWindow, Menu: { buildFromTemplate: x => x, setApplicationMenu() {} }, dialog: { showMessageBox: async () => ({ response: 1 }) }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, shell: { openExternal() {} } };
  const code = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(code, { require: id => id === 'electron' ? electron : id === 'electron-updater' ? { autoUpdater } : require(id), __dirname: 'D:/app/electron', process: { platform: 'win32' }, console, setTimeout: callback => ({ unref() {} }), setInterval: () => ({ unref() {} }), clearInterval() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  assert.throws(() => handlers.get('updates:get')({ sender: {}, senderFrame: { url: 'https://malicioso.test' } }), /Origem/);
  const event = { sender: window.webContents, senderFrame: { url: window.url } };
  await handlers.get('updates:check')(event);
  assert.equal(handlers.get('updates:get')(event).status, 'current');
  autoUpdater.emit('update-available', { version: '1.0.3' });
  autoUpdater.emit('download-progress', { percent: 53.3 });
  assert.equal(handlers.get('updates:get')(event).percent, 53);
  autoUpdater.emit('update-downloaded', { version: '1.0.3' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(handlers.get('updates:get')(event).status, 'downloaded');
  assert.equal(installed, 0, 'escolher Depois não instala');
});
