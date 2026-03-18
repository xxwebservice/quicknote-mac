// === QuickNote Mac v1 ===

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // --- Platform detection ---
  const isNative  = typeof window.NativeBridge !== 'undefined';
  const isMac     = window.__PLATFORM__ === 'mac';
  const isAndroid = isNative && !isMac;

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function nativeBuildZip(notesMd, claudeJson, audioFilename, transcriptText, zipFilename) {
    return new Promise((resolve, reject) => {
      const cb = 'qnZip' + Date.now();
      window[cb] = (size) => { delete window[cb]; size > 0 ? resolve(size) : reject(new Error('ZIP build failed')); };
      NativeBridge.buildZipAndSave(notesMd, claudeJson, audioFilename || '', transcriptText || '', zipFilename, cb);
    });
  }

  // --- State ---
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let timerInterval = null;
  let currentSession = null;
  let sessions = [];
  let mergedDocFilename = null;

  const dom = {
    statusDot:      $('#status-dot'),
    timer:          $('#timer'),
    menuBtn:        $('#menu-btn'),
    menuDropdown:   $('#menu-dropdown'),
    menuExport:     $('#menu-export'),
    menuHistory:    $('#menu-history'),
    menuExports:    $('#menu-exports'),
    menuSettings:   $('#menu-settings'),
    startScreen:    $('#start-screen'),
    notesScreen:    $('#notes-screen'),
    reviewScreen:   $('#review-screen'),
    historyScreen:  $('#history-screen'),
    exportsScreen:  $('#exports-screen'),
    settingsScreen: $('#settings-screen'),
    meetingTitle:   $('#meeting-title'),
    startBtn:       $('#start-btn'),
    sessionList:    $('#session-list'),
    currentTitle:   $('#current-title'),
    notesEntries:   $('#notes-entries'),
    emptyHint:      $('#empty-hint'),
    noteInput:      $('#note-input'),
    sendBtn:        $('#send-btn'),
    stopBtn:        $('#stop-btn'),
    reviewTitle:    $('#review-title'),
    reviewDuration: $('#review-duration'),
    reviewCount:    $('#review-count'),
    reviewNotes:    $('#review-notes'),
    exportBtn:      $('#export-btn'),
    shareBtn:       $('#share-btn'),
    newBtn:         $('#new-btn'),
    backBtn:        $('#back-btn'),
    historyList:    $('#history-list'),
    backFromExports:  $('#back-from-exports'),
    exportsList:      $('#exports-list'),
    backFromSettings: $('#back-from-settings'),
    settingsModelList:$('#settings-model-list'),
    transcribeActionRow:      $('#transcribe-action-row'),
    transcribeEntryBtn:       $('#transcribe-entry-btn'),
    transcriptionScreen:      $('#transcription-screen'),
    backFromTranscription:    $('#back-from-transcription'),
    transcriptionNoModel:     $('#transcription-no-model'),
    transcriptionHasModel:    $('#transcription-has-model'),
    transcriptionModelSelect: $('#transcription-model-select'),
    whisperLangSelect:        $('#whisper-lang-select'),
    diarizeToggleRow:         $('#diarize-toggle-row'),
    diarizeToggle:            $('#diarize-toggle'),
    transcribeBtn:            $('#transcribe-btn'),
    cancelTranscribeBtn:      $('#cancel-transcribe-btn'),
    transcriptionProgressWrap:$('#transcription-progress-wrap'),
    transcriptionProgressBar: $('#transcription-progress-bar'),
    transcriptionStatus:      $('#transcription-status'),
    transcriptionResult:      $('#transcription-result'),
    transcriptText:           $('#transcript-text'),
    copyTranscriptBtn:        $('#copy-transcript-btn'),
    mergeNotesBtn:            $('#merge-notes-btn'),
    shareMergedBtn:           $('#share-merged-btn'),
    goToSettingsBtn:          $('#go-to-settings-btn'),
  };

  // --- Utilities ---
  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }
  function formatTimestamp(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`;
  }
  function formatTimestampSecs(secs) {
    const s = Math.floor(secs);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`;
  }
  function formatDate(ts) {
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2,5); }
  function sanitizeFilename(n) { return (n||'meeting').replace(/[^\w\u4e00-\u9fff-]/g,'_').substring(0,50); }
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function showToast(msg, ms = 2000) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // --- Storage ---
  function loadSessions() {
    try { sessions = JSON.parse(localStorage.getItem('quicknote_sessions') || '[]'); }
    catch { sessions = []; }
  }
  function saveSessions() {
    localStorage.setItem('quicknote_sessions', JSON.stringify(
      sessions.map(s => ({
        id:s.id, title:s.title, startTime:s.startTime, duration:s.duration,
        notes:s.notes, hasAudio:s.hasAudio||false,
        audioFilename:s.audioFilename||null,
        nativeAudioFile:s.nativeAudioFile||null,
        transcription:s.transcription||null,
      }))
    ));
  }

  // --- IndexedDB ---
  function openDB(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = upgrade;
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function openAudioDB() { return openDB('quicknote_audio', 1, e => e.target.result.createObjectStore('audio', { keyPath: 'id' })); }
  function openExportsDB() { return openDB('quicknote_exports', 1, e => e.target.result.createObjectStore('exports', { keyPath: 'id' })); }
  async function idbPut(db, store, obj) {
    return new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(obj); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  async function idbGet(db, store, key) {
    return new Promise((res, rej) => { const tx = db.transaction(store, 'readonly'); const r = tx.objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function idbGetAll(db, store) {
    return new Promise((res, rej) => { const tx = db.transaction(store, 'readonly'); const r = tx.objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function idbDelete(db, store, key) {
    return new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  async function saveAudio(id, blob) { const db = await openAudioDB(); return idbPut(db, 'audio', { id, blob, type: blob.type }); }
  async function getAudio(id) { const db = await openAudioDB(); return idbGet(db, 'audio', id); }
  async function deleteAudio(id) { const db = await openAudioDB(); return idbDelete(db, 'audio', id); }

  // --- Screens ---
  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $(`#${id}`).classList.add('active');
    dom.menuDropdown.classList.add('hidden');
  }

  // --- Session List ---
  function renderSessionList(container, showDelete) {
    container.innerHTML = '';
    const sorted = [...sessions].sort((a,b) => b.startTime - a.startTime);
    if (!sorted.length) { container.innerHTML = '<p class="empty-list-hint">暂无记录</p>'; return; }
    sorted.forEach(s => {
      const card = document.createElement('div');
      card.className = 'session-card';
      card.innerHTML = `
        <div class="session-info">
          <span class="session-name">${escapeHtml(s.title||'未命名会议')}</span>
          <span class="session-meta">${formatDate(s.startTime)} · ${formatTime(s.duration)} · ${s.notes.length}条笔记</span>
        </div>
        <div class="session-actions">
          ${showDelete ? `<button class="delete-btn" data-id="${s.id}">✕</button>` : ''}
          <span class="session-arrow">›</span>
        </div>`;
      card.addEventListener('click', e => {
        if (e.target.classList.contains('delete-btn')) { e.stopPropagation(); deleteSession(s.id); return; }
        openReview(s);
      });
      container.appendChild(card);
    });
  }

  function deleteSession(id) {
    if (!confirm('确定删除此记录？')) return;
    sessions = sessions.filter(s => s.id !== id);
    saveSessions();
    deleteAudio(id).catch(() => {});
    renderSessionList(dom.sessionList, false);
    renderSessionList(dom.historyList, true);
  }

  // --- Recording ---
  async function startRecording() {
    const id = generateId();
    const audioFilename = id + '_recording.webm';
    currentSession = {
      id,
      title: dom.meetingTitle.value.trim() || `会议 ${formatDate(Date.now())}`,
      startTime: Date.now(), duration: 0, notes: [], hasAudio: false,
      audioFilename: audioFilename,
      nativeAudioFile: audioFilename, // for ZIP builder compat
    };

    // On Mac: always use web MediaRecorder, save to file via IPC
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 }
      });
      let mimeType = '';
      for (const mt of ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus']) {
        if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
      }
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (audioChunks.length) {
          const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          // Save to IDB for web export
          await saveAudio(currentSession.id, blob);
          // Also save to disk for ZIP builder
          if (isMac && isNative) {
            const buf = await blob.arrayBuffer();
            await NativeBridge.saveAudioBuffer(currentSession.audioFilename, buf);
          }
          currentSession.hasAudio = true;
        }
        finishRecording();
      };
      mediaRecorder.start(1000);
    } catch (err) {
      console.warn('Mic denied, notes-only mode:', err);
    }

    recordingStartTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
    dom.statusDot.classList.remove('hidden');
    dom.timer.classList.remove('hidden');
    dom.stopBtn.classList.remove('hidden');
    dom.currentTitle.textContent = currentSession.title;
    dom.notesEntries.innerHTML = '';
    dom.notesEntries.appendChild(dom.emptyHint);
    dom.emptyHint.classList.remove('hidden');
    dom.noteInput.value = '';
    dom.sendBtn.disabled = true;
    showScreen('notes-screen');
    setTimeout(() => dom.noteInput.focus(), 200);
  }

  function updateTimer() {
    if (recordingStartTime) dom.timer.textContent = formatTime(Date.now() - recordingStartTime);
  }

  function stopRecording() {
    clearInterval(timerInterval); timerInterval = null;
    if (currentSession) currentSession.duration = Date.now() - recordingStartTime;
    dom.statusDot.classList.add('hidden');
    dom.timer.classList.add('hidden');
    dom.stopBtn.classList.add('hidden');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      finishRecording();
    }
  }

  function finishRecording() {
    sessions.push(currentSession);
    saveSessions();
    openReview(currentSession);
    mediaRecorder = null; audioChunks = []; recordingStartTime = null;
    renderSessionList(dom.sessionList, false);
  }

  // --- Notes ---
  function addNote(text) {
    if (!text.trim() || !currentSession) return;
    const note = { timestamp: Date.now() - recordingStartTime, text: text.trim(), createdAt: Date.now() };
    currentSession.notes.push(note);
    dom.emptyHint.classList.add('hidden');
    renderNoteEntry(note);
    dom.noteInput.value = '';
    dom.sendBtn.disabled = true;
    autoResize();
    dom.notesEntries.scrollTop = dom.notesEntries.scrollHeight;
  }

  function renderNoteEntry(note) {
    const entry = document.createElement('div');
    entry.className = 'note-entry';
    entry.innerHTML = `
      <span class="note-timestamp">${formatTimestamp(note.timestamp)}</span>
      <span class="note-text">${escapeHtml(note.text)}</span>`;
    dom.notesEntries.appendChild(entry);
  }

  // --- Review ---
  function openReview(session) {
    dom.reviewTitle.textContent = session.title || '未命名会议';
    dom.reviewDuration.textContent = `时长 ${formatTime(session.duration)}`;
    dom.reviewCount.textContent = `${session.notes.length} 条笔记`;
    dom.reviewNotes.innerHTML = '';
    if (!session.notes.length) {
      dom.reviewNotes.innerHTML = '<p class="empty-list-hint">没有笔记</p>';
    }
    session.notes.forEach(n => {
      const e = document.createElement('div');
      e.className = 'review-note-entry';
      e.innerHTML = `<span class="review-timestamp">${formatTimestamp(n.timestamp)}</span><span class="review-text">${escapeHtml(n.text)}</span>`;
      dom.reviewNotes.appendChild(e);
    });
    // Mac: hide transcribe button (no local Whisper)
    if (dom.transcribeActionRow) dom.transcribeActionRow.classList.add('hidden');
    currentSession = session;
    showScreen('review-screen');
  }

  // --- ZIP builder ---
  function buildZip(files) {
    const enc = new TextEncoder();
    function u16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0,n,true); return b; }
    function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0,n,true); return b; }
    function crc32(data) {
      if (!crc32.t) { crc32.t = new Uint32Array(256); for (let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xEDB88320^(c>>>1):c>>>1;crc32.t[i]=c;} }
      let c=0xFFFFFFFF; for(let i=0;i<data.length;i++) c=crc32.t[(c^data[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0;
    }
    function cat(arrays) { const n=arrays.reduce((s,a)=>s+a.length,0); const o=new Uint8Array(n); let p=0; for(const a of arrays){o.set(a,p);p+=a.length;} return o; }
    const parts=[], cd=[]; let off=0;
    for (const f of files) {
      const nb=enc.encode(f.name), crc=crc32(f.data);
      const lh=cat([new Uint8Array([0x50,0x4B,0x03,0x04]),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(f.data.length),u32(f.data.length),u16(nb.length),u16(0),nb]);
      cd.push({nb,crc,sz:f.data.length,off}); off+=lh.length+f.data.length;
      parts.push(lh,f.data);
    }
    const cdStart=off;
    for (const {nb,crc,sz,off:fo} of cd) {
      parts.push(cat([new Uint8Array([0x50,0x4B,0x01,0x02]),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(sz),u32(sz),u16(nb.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(fo),nb]));
    }
    const cdSz=parts.slice(files.length * 2).reduce((s,a)=>s+a.length,0);
    parts.push(cat([new Uint8Array([0x50,0x4B,0x05,0x06]),u16(0),u16(0),u16(files.length),u16(files.length),u32(cdSz),u32(cdStart),u16(0)]));
    return cat(parts);
  }

  async function buildSessionZip(session) {
    const prefix = sanitizeFilename(session.title);
    const zipFilename = `${prefix}_quicknote.zip`;
    let md = `# ${session.title||'未命名会议'}\n\n`;
    md += `- 日期: ${new Date(session.startTime).toLocaleString('zh-CN')}\n`;
    md += `- 时长: ${formatTime(session.duration)}\n`;
    md += `- 笔记数: ${session.notes.length}\n\n## 笔记\n\n`;
    session.notes.forEach(n => { md += `**[${formatTimestamp(n.timestamp)}]** ${n.text}\n\n`; });
    const analysis = JSON.stringify({
      session: { title:session.title, date:new Date(session.startTime).toISOString(), duration:formatTime(session.duration) },
      notes: session.notes.map(n => ({ t:formatTimestamp(n.timestamp), text:n.text })),
      instructions: ['1. 将录音转为完整transcript','2. 与笔记按时间戳对齐','3. 笔记是重点，transcript是上下文','输出: 会议纪要 + 重点标注 + 笔记未记但重要的内容']
    }, null, 2);

    if (isMac && isNative) {
      // Use Electron IPC for ZIP (via preload bridge)
      const size = await nativeBuildZip(md, analysis, session.audioFilename || '', session.transcription || '', zipFilename);
      return { zipFilename, fileSize: size, native: true };
    }

    // Fallback: in-browser ZIP
    const enc = new TextEncoder();
    const files = [
      { name: `${prefix}_notes.md`, data: enc.encode(md) },
      { name: `${prefix}_for_claude.json`, data: enc.encode(analysis) },
    ];
    try {
      const audioData = await getAudio(session.id);
      if (audioData && audioData.blob) {
        const buf = await audioData.blob.arrayBuffer();
        const ext = audioData.type.includes('mp4') ? 'm4a' : audioData.type.includes('webm') ? 'webm' : 'ogg';
        files.push({ name: `${prefix}_recording.${ext}`, data: new Uint8Array(buf) });
      }
    } catch(e) { console.warn('No audio:', e); }
    const zip = buildZip(files);
    return { blob: new Blob([zip], { type:'application/zip' }), zipFilename, fileCount: files.length };
  }

  async function exportSession() {
    if (!currentSession) return;
    showToast('正在打包...', 60000);
    try {
      const result = await buildSessionZip(currentSession);
      document.querySelector('.toast')?.remove();
      if (result.native) {
        await saveExportRecord(currentSession, result.zipFilename, result.fileSize);
        showToast('已保存到 ~/Documents/QuickNote/');
        if (isNative) NativeBridge.shareFile(result.zipFilename); // reveal in Finder
      } else {
        await saveExport(currentSession, result.blob, result.zipFilename);
        await downloadBlob(result.blob, result.zipFilename);
      }
    } catch(e) {
      document.querySelector('.toast')?.remove();
      showToast('导出失败: ' + e.message);
    }
  }

  async function shareSession() {
    if (!currentSession) return;
    showToast('正在打包...', 60000);
    try {
      const result = await buildSessionZip(currentSession);
      document.querySelector('.toast')?.remove();
      if (result.native) {
        await saveExportRecord(currentSession, result.zipFilename, result.fileSize);
        NativeBridge.shareFile(result.zipFilename); // reveal in Finder
        return;
      }
      await saveExport(currentSession, result.blob, result.zipFilename);
      await downloadBlob(result.blob, result.zipFilename);
    } catch(e) {
      document.querySelector('.toast')?.remove();
      if (e.name !== 'AbortError') showToast('操作失败: ' + e.message);
    }
  }

  async function saveExportRecord(session, filename, fileSize) {
    try {
      const db = await openExportsDB();
      await idbPut(db, 'exports', {
        id: generateId(), sessionId: session.id,
        title: session.title || '未命名会议',
        filename, blob: null, nativeFile: true,
        exportedAt: Date.now(), fileSize: fileSize || 0,
      });
    } catch(e) { console.warn('Could not save export record:', e); }
  }

  async function saveExport(session, blob, filename) {
    try {
      const db = await openExportsDB();
      await idbPut(db, 'exports', {
        id: generateId(), sessionId: session.id,
        title: session.title || '未命名会议',
        filename, blob, exportedAt: Date.now(), fileSize: blob.size,
      });
    } catch(e) { console.warn('Could not save export:', e); }
  }

  async function renderExportsList() {
    dom.exportsList.innerHTML = '<p class="empty-list-hint">加载中...</p>';
    try {
      const db = await openExportsDB();
      const exports = await idbGetAll(db, 'exports');
      exports.sort((a,b) => b.exportedAt - a.exportedAt);
      dom.exportsList.innerHTML = '';
      if (!exports.length) { dom.exportsList.innerHTML = '<p class="empty-list-hint">还没有导出记录</p>'; return; }
      for (const ex of exports) {
        const card = document.createElement('div');
        card.className = 'export-card';
        const kb = (ex.fileSize / 1024).toFixed(0);
        card.innerHTML = `
          <div class="export-info">
            <span class="export-name">${escapeHtml(ex.title)}</span>
            <span class="export-meta">${formatDate(ex.exportedAt)} · ${kb} KB</span>
          </div>
          <div class="export-actions">
            <button class="export-action-btn share-export-btn" data-id="${ex.id}">Finder</button>
            <button class="export-action-btn del-export-btn" data-id="${ex.id}">✕</button>
          </div>`;
        card.querySelector('.share-export-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          const data = await idbGet(await openExportsDB(), 'exports', ex.id);
          if (!data) { showToast('文件已丢失'); return; }
          if (data.nativeFile && isNative) { NativeBridge.shareFile(data.filename); return; }
          if (data.blob) await downloadBlob(data.blob, data.filename);
        });
        card.querySelector('.del-export-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('删除此导出记录？')) return;
          const db2 = await openExportsDB();
          await idbDelete(db2, 'exports', ex.id);
          card.remove();
          if (!dom.exportsList.querySelectorAll('.export-card').length)
            dom.exportsList.innerHTML = '<p class="empty-list-hint">还没有导出记录</p>';
        });
        dom.exportsList.appendChild(card);
      }
    } catch(e) {
      dom.exportsList.innerHTML = '<p class="empty-list-hint">加载失败</p>';
    }
  }

  // --- Download helper ---
  async function downloadBlob(blob, filename) {
    if (isMac && isNative) {
      const b64 = await blobToBase64(blob);
      await NativeBridge.saveFile(filename, b64);
      NativeBridge.shareFile(filename); // reveal in Finder
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function autoResize() {
    const el = dom.noteInput;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  // --- Events ---
  function init() {
    loadSessions();
    renderSessionList(dom.sessionList, false);

    dom.startBtn.addEventListener('click', startRecording);
    dom.meetingTitle.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); startRecording(); } });

    dom.noteInput.addEventListener('input', () => {
      autoResize();
      dom.sendBtn.disabled = !dom.noteInput.value.trim();
    });
    dom.noteInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(dom.noteInput.value); }
    });
    dom.sendBtn.addEventListener('click', () => addNote(dom.noteInput.value));

    dom.stopBtn.addEventListener('click', () => {
      if (currentSession && !currentSession.notes.length && !confirm('还没有笔记，确定结束？')) return;
      stopRecording();
    });

    dom.exportBtn.addEventListener('click', exportSession);
    dom.shareBtn.addEventListener('click', shareSession);

    dom.newBtn.addEventListener('click', () => {
      currentSession = null;
      dom.meetingTitle.value = '';
      showScreen('start-screen');
      renderSessionList(dom.sessionList, false);
    });

    dom.menuBtn.addEventListener('click', e => { e.stopPropagation(); dom.menuDropdown.classList.toggle('hidden'); });
    document.addEventListener('click', () => dom.menuDropdown.classList.add('hidden'));

    dom.menuExport.addEventListener('click', () => { if (currentSession) exportSession(); });
    dom.menuHistory.addEventListener('click', () => { renderSessionList(dom.historyList, true); showScreen('history-screen'); });
    dom.menuExports.addEventListener('click', () => { renderExportsList(); showScreen('exports-screen'); });
    dom.menuSettings?.addEventListener('click', () => showScreen('settings-screen'));

    dom.backBtn.addEventListener('click', () => { showScreen('start-screen'); renderSessionList(dom.sessionList, false); });
    dom.backFromExports.addEventListener('click', () => showScreen('start-screen'));
    dom.backFromSettings?.addEventListener('click', () => showScreen('start-screen'));

    // Keyboard shortcut: Cmd+N = new recording
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        if (currentSession && recordingStartTime) return; // already recording
        dom.meetingTitle.value = '';
        showScreen('start-screen');
        dom.meetingTitle.focus();
      }
    });
  }

  init();
})();
