const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { createWriteStream } = require('fs');
const archiver = require('archiver');

// ── Storage dir ──────────────────────────────────────────────────────────────
const storageDir = path.join(os.homedir(), 'Documents', 'QuickNote');
function ensureStorageDir() {
  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 480,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'under-window',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'www', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC Handlers (mirror NativeBridge API) ───────────────────────────────────

ipcMain.handle('getStoragePath', () => {
  ensureStorageDir();
  return storageDir;
});

ipcMain.handle('saveFile', (_, filename, base64Data) => {
  try {
    ensureStorageDir();
    const filePath = path.join(storageDir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return true;
  } catch (e) {
    console.error('saveFile error:', e);
    return false;
  }
});

ipcMain.handle('saveText', (_, filename, text) => {
  try {
    ensureStorageDir();
    const filePath = path.join(storageDir, filename);
    fs.writeFileSync(filePath, text, 'utf-8');
    return true;
  } catch (e) {
    console.error('saveText error:', e);
    return false;
  }
});

ipcMain.handle('saveAudioBuffer', (_, filename, arrayBuffer) => {
  try {
    ensureStorageDir();
    const filePath = path.join(storageDir, filename);
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
    return true;
  } catch (e) {
    console.error('saveAudioBuffer error:', e);
    return false;
  }
});

ipcMain.handle('buildZipAndSave', async (_, notesMd, claudeJson, audioFilename, transcriptText, zipFilename) => {
  ensureStorageDir();
  const zipPath = path.join(storageDir, zipFilename);
  const prefix  = zipFilename.endsWith('_quicknote.zip')
    ? zipFilename.slice(0, -'_quicknote.zip'.length)
    : zipFilename.replace('.zip', '');

  return new Promise((resolve, reject) => {
    const output  = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 5 } });

    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', err => reject(err));
    archive.pipe(output);

    archive.append(notesMd, { name: prefix + '_notes.md' });
    archive.append(claudeJson, { name: prefix + '_for_claude.json' });

    if (transcriptText) {
      archive.append(transcriptText, { name: prefix + '_transcript.txt' });
    }

    if (audioFilename) {
      const audioPath = path.join(storageDir, audioFilename);
      if (fs.existsSync(audioPath)) {
        const ext = audioFilename.endsWith('.m4a') ? 'm4a' : 'webm';
        archive.file(audioPath, { name: prefix + '_recording.' + ext });
      }
    }

    archive.finalize();
  });
});

ipcMain.handle('shareFile', async (_, filename) => {
  const filePath = path.join(storageDir, filename);
  if (!fs.existsSync(filePath)) return false;
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('shareTextFile', async (_, filename) => {
  const filePath = path.join(storageDir, filename);
  if (!fs.existsSync(filePath)) return false;
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('showSaveDialog', async (_, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('revealInFinder', (_, filename) => {
  const filePath = path.join(storageDir, filename);
  if (fs.existsSync(filePath)) shell.showItemInFolder(filePath);
});
