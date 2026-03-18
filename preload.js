const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes a NativeBridge-compatible API to the renderer process.
 * The web app checks `typeof window.NativeBridge !== 'undefined'`
 * so by exposing it here, the app uses native file I/O seamlessly.
 */
contextBridge.exposeInMainWorld('NativeBridge', {
  getStoragePath: () => ipcRenderer.invoke('getStoragePath'),

  saveFile: (filename, base64Data) =>
    ipcRenderer.invoke('saveFile', filename, base64Data),

  saveText: (filename, text) =>
    ipcRenderer.invoke('saveText', filename, text),

  // Audio: save raw buffer from MediaRecorder
  saveAudioBuffer: (filename, arrayBuffer) =>
    ipcRenderer.invoke('saveAudioBuffer', filename, arrayBuffer),

  buildZipAndSave: (notesMd, claudeJson, audioFilename, transcriptText, zipFilename, callbackFn) => {
    ipcRenderer.invoke('buildZipAndSave', notesMd, claudeJson, audioFilename, transcriptText, zipFilename)
      .then(size => {
        if (typeof window[callbackFn] === 'function') window[callbackFn](size > 0 ? size : -1);
      })
      .catch(() => {
        if (typeof window[callbackFn] === 'function') window[callbackFn](-1);
      });
  },

  shareFile: (filename) => ipcRenderer.invoke('shareFile', filename),

  shareTextFile: (filename) => ipcRenderer.invoke('shareTextFile', filename),

  // Stubs for Whisper (not available on Mac version — transcription done externally)
  getWhisperModels: () => '[]',
  isWhisperModelDownloaded: () => false,
  downloadWhisperModel: () => {},
  deleteWhisperModel: () => {},
  getDiarizationModelStatus: () => '{"downloaded":false,"sizeMb":0}',
  downloadDiarizationModel: () => {},
  deleteDiarizationModel: () => {},
  startTranscription: () => {},
  stopTranscription: () => {},
  checkTranscriptionResult: () => '',
  clearTranscriptionResult: () => {},

  // Mac does not use native recording service — web MediaRecorder is used
  startNativeRecording: () => {},
  stopNativeRecording: () => {},
});

// Platform flag
contextBridge.exposeInMainWorld('__PLATFORM__', 'mac');
