const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { TextDecoder } = require('node:util');
const { createWindowLayout } = require('./desktop/window-layout.cjs');
const { Speech } = require('./desktop/speech.cjs');
const { OBSWebSocket } = require('obs-websocket-js/json');

const APP_ID = 'fr.novaia.novaprompter';
const profile = app.commandLine.getSwitchValue('user-data-dir')
  || path.join(app.getPath('appData'), 'novaprompter');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setName('NovaPrompter');
app.setAppUserModelId(APP_ID);

const editorFile = path.join(__dirname, 'windows/editor/index.html');
const readerFile = path.join(__dirname, 'windows/prompter/index.html');
const editorURL = pathToFileURL(editorFile).href;
const icon = path.join(__dirname, 'windows/shared/novaiaweb-icon.ico');
const preferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false,
  autoplayPolicy: 'no-user-gesture-required'
};
const editorMinimum = { width: 820, height: 610 };
const readerMinimum = { width: 340, height: 218 };

let editor;
let reader;
let layout;
let documentState;
let frame;
let resizeGesture;
let obs;
const speech = new Speech(
  path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build'), 'speech'),
  message => send(editor, 'speech:event', message)
);

function send(window, channel, value) {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(channel, value);
  }
}

function protect(window) {
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createEditor() {
  editor = new BrowserWindow({
    ...layout.bounds('editor', { width: 1420, height: 880 }, editorMinimum, screen.getPrimaryDisplay()),
    minWidth: editorMinimum.width,
    minHeight: editorMinimum.height,
    icon,
    title: 'NovaPrompter by novaiaweb',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#10131d', symbolColor: '#bac1d6', height: 46 },
    backgroundColor: '#11141e',
    show: false,
    webPreferences: preferences
  });
  layout.track('editor', editor);
  protect(editor);
  editor.once('ready-to-show', () => editor?.show());
  editor.on('closed', () => {
    editor = null;
    documentState = null;
    frame = null;
    speech.stop();
    obs?.disconnect().catch(() => {});
    reader?.close();
  });
  editor.loadFile(editorFile);
}

function readerState() {
  return reader && !reader.isDestroyed() ? {
    open: true,
    minimized: reader.isMinimized(),
    maximized: reader.isMaximized(),
    fullScreen: reader.isFullScreen(),
    pinned: reader.isAlwaysOnTop()
  } : { open: false };
}

function publishReaderState() {
  const status = readerState();
  send(editor, 'reader:status', status);
  send(reader, 'reader:status', status);
}

function applyReaderOptions() {
  if (!reader || !documentState?.settings) return;
  const { alwaysTop, opacity } = documentState.settings;
  reader.setAlwaysOnTop(alwaysTop !== false);
  reader.setOpacity(Math.min(1, Math.max(0.5, Number(opacity) || 1)));
}

function showReader() {
  if (reader && !reader.isDestroyed()) {
    if (reader.isMinimized()) reader.restore();
    reader.show();
    reader.focus();
    return;
  }
  const display = screen.getDisplayMatching(editor.getBounds());
  reader = new BrowserWindow({
    ...layout.bounds('prompter', { width: 748, height: 410 }, readerMinimum, display),
    alwaysOnTop: documentState?.settings?.alwaysTop !== false,
    minWidth: readerMinimum.width,
    minHeight: readerMinimum.height,
    frame: false,
    transparent: false,
    resizable: true,
    movable: true,
    backgroundColor: '#10121a',
    icon,
    title: 'Prompteur · NovaPrompter by novaiaweb',
    show: false,
    webPreferences: preferences
  });
  layout.track('prompter', reader);
  protect(reader);
  applyReaderOptions();
  for (const event of ['minimize', 'restore', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    reader.on(event, publishReaderState);
  }
  reader.once('ready-to-show', () => {
    reader?.show();
    applyReaderOptions();
    publishReaderState();
  });
  reader.on('closed', () => { reader = null; resizeGesture = null; publishReaderState(); });
  reader.loadFile(readerFile);
  publishReaderState();
}

function changeReader(action) {
  if (!reader) return;
  if (action === 'close') reader.close();
  if (action === 'minimize' && reader.isFullScreen()) reader.setFullScreen(false);
  if (action === 'minimize') reader.minimize();
  if (action === 'maximize' && reader.isFullScreen()) reader.setFullScreen(false);
  else if (action === 'maximize') {
    if (reader.isMaximized()) reader.unmaximize();
    else reader.maximize();
  }
  if (action === 'fullscreen') reader.setFullScreen(!reader.isFullScreen());
  publishReaderState();
}

function resizeReader(action, axis) {
  if (!reader || reader.isMaximized() || reader.isFullScreen()) return;
  if (action === 'end') { resizeGesture = null; return; }
  const cursor = screen.getCursorScreenPoint();
  if (action === 'begin') {
    resizeGesture = { cursor, bounds: reader.getBounds() };
    return;
  }
  const start = action === 'move' ? resizeGesture : { cursor, bounds: reader.getBounds() };
  if (!start) return;
  const { x, y, width, height } = start.bounds;
  const area = screen.getDisplayMatching(start.bounds).workArea;
  const dx = action === 'move' ? cursor.x - start.cursor.x : (axis === 'wider' ? 24 : axis === 'narrower' ? -24 : 0);
  const dy = action === 'move' ? cursor.y - start.cursor.y : (axis === 'taller' ? 24 : axis === 'shorter' ? -24 : 0);
  reader.setSize(
    Math.max(readerMinimum.width, Math.min(area.x + area.width - x, width + dx)),
    Math.max(readerMinimum.height, Math.min(area.y + area.height - y, height + dy))
  );
}

function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

function requireEditor(event) {
  if (!editor || event.sender !== editor.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Cette commande est réservée à l’éditeur.');
  }
}

function handleEditor(channel, handler) {
  ipcMain.handle(channel, (event, value) => {
    requireEditor(event);
    return handler(value);
  });
}

function handleAudio(channel, handler) {
  ipcMain.on(channel, (event, value) => {
    if (event.sender === editor?.webContents && event.senderFrame === event.sender.mainFrame) handler(value);
  });
}

app.on('second-instance', () => {
  if (!editor) return;
  if (editor.isMinimized()) editor.restore();
  editor.show();
  editor.focus();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    layout = createWindowLayout(app.getPath('userData'), screen);
    const isEditorContent = (contents, url) => contents && contents === editor?.webContents
      && contents.getURL() === editorURL && (!url || url === editorURL || url === 'file://');
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
      permission === 'media' && details.mediaType !== 'video' && isEditorContent(contents, details.requestingUrl));
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(permission === 'media' && isEditorContent(contents, details.requestingUrl)
        && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio'));

    handleEditor('reader:open', showReader);
    ipcMain.handle('reader:command', (event, action) => {
      if (event.sender === reader?.webContents || event.sender === editor?.webContents) changeReader(action);
    });
    ipcMain.on('reader:resize', (event, { action, axis }) => {
      if (event.sender === reader?.webContents && event.senderFrame === event.sender.mainFrame
        && ['begin', 'move', 'end', 'step'].includes(action)) resizeReader(action, axis);
    });
    ipcMain.handle('reader:snapshot', event => {
      if (event.sender === reader?.webContents) return { document: documentState, frame, status: readerState() };
      return { status: readerState() };
    });
    ipcMain.on('reader:sync', (event, message) => {
      if (!message || event.senderFrame !== event.sender.mainFrame) return;
      if (event.sender === editor?.webContents) {
        if (message.type === 'document') {
          documentState = message;
          applyReaderOptions();
        } else if (message.type === 'frame') {
          frame = message;
        } else return;
        send(reader, 'reader:sync', message);
      } else if (event.sender === reader?.webContents && ['command', 'seek'].includes(message.type)) {
        send(editor, 'reader:sync', message);
      }
    });

    handleEditor('speech:start', ({ session: id, generation, sampleRate }) => {
      if (typeof id !== 'string' || id.length > 80 || !Number.isSafeInteger(generation)
        || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
        throw new Error('Format audio invalide.');
      }
      return speech.start({ session: id, generation, sampleRate });
    });
    handleAudio('speech:stop', id => speech.stop(id));
    handleAudio('speech:seek', value => speech.seek(value));
    handleAudio('speech:audio', value => {
      if (value?.bytes instanceof ArrayBuffer && value.bytes.byteLength > 0 && value.bytes.byteLength <= 16000) {
        speech.audio(value);
      }
    });

    handleEditor('files:import', async () => {
      const result = await dialog.showOpenDialog(editor, {
        title: 'Importer des scripts',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Scripts et sauvegardes', extensions: ['txt', 'md', 'srt', 'vtt', 'json'] }]
      });
      if (result.canceled) return [];
      const imported = [];
      let totalSize = 0;
      for (const file of result.filePaths) {
        const stat = await fsp.stat(file);
        totalSize += stat.size;
        if (totalSize > 8 * 1024 * 1024) throw new Error('L’import ne peut pas dépasser 8 Mo par sélection.');
        imported.push({ name: path.basename(file), text: decodeText(await fsp.readFile(file)) });
      }
      return imported;
    });
    handleEditor('files:export', async ({ name, text, format }) => {
      if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) throw new Error('Contenu à exporter trop volumineux.');
      const extension = format === 'json' ? 'json' : 'txt';
      const safeName = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().slice(0, 100) || 'Script';
      const result = await dialog.showSaveDialog(editor, {
        title: 'Exporter depuis NovaPrompter',
        defaultPath: path.join(app.getPath('documents'), `${safeName}.${extension}`),
        filters: [{ name: extension === 'json' ? 'Sauvegarde NovaPrompter' : 'Texte brut', extensions: [extension] }]
      });
      if (result.canceled) return false;
      await fsp.writeFile(result.filePath, text, 'utf8');
      return true;
    });
    handleEditor('microphone:privacy', () => shell.openExternal('ms-settings:privacy-microphone'));

    handleEditor('obs:connect', async ({ url, password }) => {
      let endpoint;
      try { endpoint = new URL(url); } catch {}
      if (!endpoint || !['ws:', 'wss:'].includes(endpoint.protocol)) throw new Error('Adresse OBS WebSocket invalide.');
      if (obs) await obs.disconnect();
      const client = new OBSWebSocket();
      obs = client;
      client.on('ConnectionClosed', () => {
        if (obs !== client) return;
        obs = null;
        send(editor, 'obs:closed');
      });
      let timer;
      try {
        const handshake = async () => {
          await client.connect(endpoint.href, password || undefined, { rpcVersion: 1 });
          return client.call('GetSceneList');
        };
        const result = await Promise.race([
          handshake(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Délai OBS dépassé.')), 5500); })
        ]);
        return {
          scenes: result.scenes.map(scene => scene.sceneName).reverse(),
          current: result.currentProgramSceneName
        };
      } catch {
        await client.disconnect().catch(() => {});
        if (obs === client) obs = null;
        throw new Error('OBS indisponible. Vérifiez l’adresse, le mot de passe et le serveur WebSocket dans OBS.');
      } finally { clearTimeout(timer); }
    });
    handleEditor('obs:scene', async sceneName => {
      if (!obs) throw new Error('Connectez OBS avant de changer de scène.');
      await obs.call('SetCurrentProgramScene', { sceneName });
    });
    handleEditor('obs:disconnect', async () => { await obs?.disconnect(); });

    createEditor();
    app.on('activate', () => { if (!editor) createEditor(); });
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => speech.dispose());
