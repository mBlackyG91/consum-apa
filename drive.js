/* Sincronizare cu Google Drive (scope drive.file) prin Google Identity Services.
 *
 * Model:
 *  - datele locale (localStorage) sunt sursa imediată; fiecare modificare
 *    crește un contor "rev". Drive primește datele abia după ce utilizatorul
 *    face o pauză (SAVE_DEBOUNCE_MS), când pleacă din pagină sau apasă
 *    „Sincronizează acum”. Sincronizarea nu întrerupe niciodată introducerea.
 *  - ținem minte "version" a fișierului din Drive la ultima sincronizare și
 *    o copie a datelor la acel moment ("baza").
 *    Dacă versiunea din Drive e alta, fișierul a fost modificat de pe alt
 *    dispozitiv: dacă local nu avem modificări, preluăm versiunea din Drive;
 *    altfel ÎMBINĂM automat (merge.js) pe baza celor 3 versiuni: bază, local,
 *    Drive. Fără ferestre și fără alegeri manuale.
 */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const META_FIELDS = 'id,name,modifiedTime,version,trashed';
  const LS_META = 'evidenta-apa:sync';
  const LS_TOKEN = 'evidenta-apa:token';
  const LS_BASE = 'evidenta-apa:base';
  const BACKUP_PREFIX = 'evidenta-apa-backup-';

  const hooks = { getData: null, setData: null, onStatus: null, onMerge: null, isPristine: null, merge: null };

  function readLS(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeLS(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* plin sau blocat */ } }

  const meta = Object.assign({
    connected: false,   // utilizatorul a ales să folosească Drive pe acest dispozitiv
    fileId: null,
    version: null,      // versiunea din Drive la ultima sincronizare reușită
    modifiedTime: null,
    rev: 0,             // contor local de modificări
    syncedRev: 0,       // ultimul "rev" ajuns în Drive
    lastSyncAt: null,
    lastBackupDay: null, // ziua (AAAA-LL-ZZ) în care s-a făcut ultima copie de siguranță în Drive
  }, readLS(LS_META) || {});
  let token = readLS(LS_TOKEN); // { access_token, expires_at }
  let base = readLS(LS_BASE);   // datele la ultima sincronizare (strămoșul comun pentru îmbinare)
  function setBase(d) { base = d ? JSON.parse(JSON.stringify(d)) : null; writeLS(LS_BASE, base); }

  let tokenClient = null;
  let gisState = 'idle'; // idle | loading | ready | failed
  let tokenWaiters = [];
  let timer = null;
  let busy = false;
  let again = false;
  let needAuth = false;
  let lastError = null;
  let lastRunAt = 0;

  function saveMeta() { writeLS(LS_META, meta); }
  function isConfigured() { return !!CFG.GOOGLE_CLIENT_ID && !/PUNE_AICI/.test(CFG.GOOGLE_CLIENT_ID); }
  function hasToken() { return !!(token && token.access_token && token.expires_at > Date.now()); }
  function isDirty() { return meta.rev !== meta.syncedRev; }

  // ---------- stare afișată ----------
  function status() {
    if (!isConfigured()) return { code: 'local', text: 'Doar local (Drive neconfigurat)' };
    if (!meta.connected) return { code: 'local', text: 'Doar pe acest dispozitiv' };
    if (!navigator.onLine) return isDirty()
      ? { code: 'offline', text: 'Offline, se va sincroniza' }
      : { code: 'offline', text: 'Offline' };
    if (needAuth || !hasToken()) return { code: 'auth', text: 'Reconectează Google Drive' };
    if (busy) return { code: 'saving', text: 'Se sincronizează…' };
    if (timer || isDirty()) return lastError && !timer
      ? { code: 'error', text: 'Eroare de sincronizare, încearcă din nou' }
      : { code: 'pending', text: 'Salvat aici · se trimite după ce termini' };
    if (lastError) return { code: 'error', text: 'Eroare de sincronizare, încearcă din nou' };
    return { code: 'ok', text: 'Sincronizat' };
  }
  function emit() { if (hooks.onStatus) hooks.onStatus(status(), info()); }
  function info() {
    return { connected: meta.connected, configured: isConfigured(), lastSyncAt: meta.lastSyncAt,
      dirty: isDirty(), hasToken: hasToken(), error: lastError ? lastError.message : null, lastBackupDay: meta.lastBackupDay };
  }

  // ---------- Google Identity Services ----------
  function loadGis() {
    if (gisState === 'ready' || gisState === 'loading') return;
    if (!isConfigured()) return;
    if (window.google && google.accounts && google.accounts.oauth2) { initTokenClient(); return; }
    gisState = 'loading';
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = initTokenClient;
    s.onerror = () => { gisState = 'failed'; s.remove(); };
    document.head.appendChild(s);
  }
  function initTokenClient() {
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CFG.GOOGLE_CLIENT_ID,
        scope: SCOPE,
        callback: onTokenResponse,
        error_callback: (err) => finishToken(new Error(err && err.type === 'popup_closed'
          ? 'Fereastra de autentificare a fost închisă.' : 'Autentificarea nu a reușit.')),
      });
      gisState = 'ready';
    } catch (e) { gisState = 'failed'; }
  }
  function onTokenResponse(resp) {
    if (!resp || resp.error || !resp.access_token) { finishToken(new Error('Autentificarea nu a reușit.')); return; }
    if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
      finishToken(new Error('Nu ai acordat acces la fișierele aplicației din Drive.')); return;
    }
    token = { access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in || 3600) - 120) * 1000 };
    writeLS(LS_TOKEN, token);
    needAuth = false;
    finishToken(null);
  }
  function finishToken(err) {
    const w = tokenWaiters; tokenWaiters = [];
    w.forEach((fn) => fn(err));
  }
  /** Trebuie apelat dintr-un clic (deschide fereastra Google). */
  function requestToken() {
    return new Promise((resolve, reject) => {
      if (gisState !== 'ready' || !tokenClient) {
        loadGis();
        reject(new Error(navigator.onLine
          ? 'Biblioteca Google nu s-a încărcat încă. Încearcă din nou peste câteva secunde.'
          : 'Ești offline. Conectarea la Google necesită internet.'));
        return;
      }
      tokenWaiters.push((err) => (err ? reject(err) : resolve()));
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  // ---------- Drive REST ----------
  async function api(method, url, body, contentType) {
    if (!hasToken()) { needAuth = true; throw Object.assign(new Error('Autentificarea a expirat.'), { code: 'auth' }); }
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: Object.assign({ Authorization: 'Bearer ' + token.access_token }, contentType ? { 'Content-Type': contentType } : {}),
        body,
      });
    } catch (e) {
      throw Object.assign(new Error('Fără conexiune la internet.'), { code: 'offline' });
    }
    if (res.status === 401) {
      token = null; writeLS(LS_TOKEN, null); needAuth = true;
      throw Object.assign(new Error('Autentificarea a expirat.'), { code: 'auth' });
    }
    if (res.status === 404) throw Object.assign(new Error('Fișierul nu a fost găsit în Drive.'), { code: 'notfound' });
    if (!res.ok) {
      let msg = 'Eroare Drive (' + res.status + ')';
      try { const j = await res.json(); if (j.error && j.error.message) msg += ': ' + j.error.message; } catch (e) { /* */ }
      throw Object.assign(new Error(msg), { code: 'http', status: res.status });
    }
    return res;
  }
  async function findFile() {
    const q = encodeURIComponent("name = '" + CFG.DRIVE_FILE_NAME.replace(/'/g, "\\'") + "' and trashed = false");
    const r = await api('GET', API + '?q=' + q + '&spaces=drive&orderBy=modifiedTime%20desc&pageSize=10&fields=files(' + META_FIELDS + ')');
    const j = await r.json();
    return (j.files && j.files[0]) || null;
  }
  async function getMeta(id) {
    const r = await api('GET', API + '/' + encodeURIComponent(id) + '?fields=' + META_FIELDS);
    return r.json();
  }
  async function download(id) {
    const r = await api('GET', API + '/' + encodeURIComponent(id) + '?alt=media');
    const text = await r.text();
    try { return JSON.parse(text); } catch (e) { throw Object.assign(new Error('Fișierul din Drive nu este JSON valid.'), { code: 'http' }); }
  }
  async function createFile(data) {
    const boundary = 'apa' + Math.random().toString(36).slice(2);
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name: CFG.DRIVE_FILE_NAME, mimeType: 'application/json' }) + '\r\n--' + boundary +
      '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(data, null, 1) + '\r\n--' + boundary + '--';
    const r = await api('POST', UPLOAD + '?uploadType=multipart&fields=' + META_FIELDS, body, 'multipart/related; boundary=' + boundary);
    return r.json();
  }
  async function updateFile(id, data) {
    const r = await api('PATCH', UPLOAD + '/' + encodeURIComponent(id) + '?uploadType=media&fields=' + META_FIELDS,
      JSON.stringify(data, null, 1), 'application/json; charset=UTF-8');
    return r.json();
  }

  // ---------- copii de siguranță ----------
  const pad2 = (n) => String(n).padStart(2, '0');
  function localDay() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  /** Toate copiile create de aplicație (drive.file vede doar fișierele ei). */
  async function listBackups() {
    const q = encodeURIComponent("mimeType = 'application/json' and trashed = false");
    const r = await api('GET', API + '?q=' + q + '&spaces=drive&orderBy=name%20desc&pageSize=200&fields=files(id,name,modifiedTime)');
    const j = await r.json();
    return (j.files || []).filter((f) => window.Backup.NAME_RE.test(f.name));
  }
  async function trashFile(id) {
    await api('PATCH', API + '/' + encodeURIComponent(id), JSON.stringify({ trashed: true }), 'application/json');
  }
  /** O copie pe zi: o copie făcută chiar de Drive, a fișierului ÎNAINTE să fie suprascris
   *  (deci starea de la ultima sincronizare, înaintea modificărilor de azi). */
  async function maybeBackup() {
    const day = localDay();
    if (meta.lastBackupDay === day || !meta.fileId) return;
    try {
      const files = await listBackups();
      const name = BACKUP_PREFIX + day + '.json';
      if (!files.some((f) => f.name === name)) {
        const r = await api('POST', API + '/' + encodeURIComponent(meta.fileId) + '/copy?fields=id,name,modifiedTime',
          JSON.stringify({ name }), 'application/json');
        files.push(await r.json());
      }
      meta.lastBackupDay = day; saveMeta();
      for (const n of window.Backup.toDelete(files.map((f) => f.name), day)) {
        const f = files.find((x) => x.name === n);
        if (f) await trashFile(f.id);
      }
    } catch (e) {
      if (e.code === 'auth' || e.code === 'offline') throw e;
      // O copie eșuată nu trebuie să blocheze salvarea datelor; se reîncearcă la următoarea sincronizare.
    }
  }

  // ---------- comparare conținut ----------
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).filter((k) => k !== 'updatedAt' && v[k] !== undefined).sort()
        .map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  function sameContent(a, b) { return stable(a) === stable(b); }

  // ---------- sincronizare ----------
  function canRun() {
    return isConfigured() && meta.connected && navigator.onLine && hasToken();
  }

  async function run() {
    if (busy) { again = true; return; }
    if (timer) { clearTimeout(timer); timer = null; }
    if (!canRun()) { if (meta.connected && !hasToken()) needAuth = true; emit(); return; }
    busy = true; lastError = null; lastRunAt = Date.now(); emit();
    try {
      await syncOnce();
      meta.lastSyncAt = new Date().toISOString();
      saveMeta();
    } catch (e) {
      if (e.code === 'auth' || e.code === 'offline') { /* starea afișată explică */ }
      else lastError = e;
    } finally {
      busy = false;
      emit();
      if (again) { again = false; if (canRun() && (isDirty())) run(); }
    }
  }

  async function syncOnce() {
    // 1. Găsim (sau creăm) fișierul.
    let remote = null;
    if (meta.fileId) {
      try {
        remote = await getMeta(meta.fileId);
        if (remote.trashed) remote = null;
      } catch (e) { if (e.code !== 'notfound') throw e; remote = null; }
      if (!remote) { meta.fileId = null; meta.version = null; }
    }
    if (!remote) {
      remote = await findFile();
      if (remote) { meta.fileId = remote.id; meta.version = null; saveMeta(); }
    }
    if (!remote) {
      const rev = meta.rev;
      const snap = hooks.getData();
      const created = await createFile(snap);
      meta.fileId = created.id; meta.version = String(created.version); meta.modifiedTime = created.modifiedTime;
      meta.syncedRev = rev; setBase(snap); saveMeta();
      return;
    }

    // 2. Drive modificat de altcineva de la ultima sincronizare?
    if (String(remote.version) !== String(meta.version)) {
      const remoteData = await download(remote.id);
      // De aici până la setData nu există niciun „await”: ce îmbinăm este exact ce e pe ecran.
      const local = hooks.getData();
      const firstOnDevice = meta.version === null;
      const seen = () => { meta.version = String(remote.version); meta.modifiedTime = remote.modifiedTime; };
      if (sameContent(remoteData, local)) {
        seen(); meta.syncedRev = meta.rev; setBase(remoteData); saveMeta();
        return;
      }
      if ((!firstOnDevice && !isDirty()) || (firstOnDevice && hooks.isPristine && hooks.isPristine(local))) {
        hooks.setData(remoteData);
        seen(); meta.syncedRev = meta.rev; setBase(remoteData); saveMeta();
        return;
      }
      // Ambele părți au modificări: îmbinare automată, apoi trimitem rezultatul.
      const res = hooks.merge(base, local, remoteData);
      hooks.setData(res.data);
      seen(); setBase(remoteData); meta.rev++; saveMeta();
      if (res.notes && res.notes.length && hooks.onMerge) hooks.onMerge(res.notes, res.data);
      // continuă la pasul 3: rezultatul îmbinat ajunge în Drive
    }

    // 3. Avem modificări locale: le scriem.
    if (isDirty()) {
      await maybeBackup();
      const rev = meta.rev;
      const snap = hooks.getData();
      const updated = await updateFile(meta.fileId, snap);
      meta.version = String(updated.version); meta.modifiedTime = updated.modifiedTime;
      meta.syncedRev = rev; setBase(snap); saveMeta();
    }
  }

  function flush() {
    if (!meta.connected || !isDirty()) return;
    if (timer) { clearTimeout(timer); timer = null; }
    if (canRun()) run();
  }

  // ---------- API public ----------
  const Sync = {
    init(h) {
      Object.assign(hooks, h);
      if (meta.connected && !hasToken()) needAuth = true;
      loadGis();
      window.addEventListener('online', () => { emit(); run(); });
      window.addEventListener('offline', emit);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { if (Date.now() - lastRunAt > 20000) run(); }
        else flush();
      });
      window.addEventListener('pagehide', flush);
      emit();
      if (canRun()) run();
    },
    status,
    info,
    isConfigured,
    /** Trimite acum, fără să mai aștepte pauza (la plecarea din pagină). */
    flush,
    /** Apelat după fiecare modificare locală. */
    markDirty() {
      meta.rev++; saveMeta();
      if (timer) clearTimeout(timer);
      if (meta.connected) timer = setTimeout(() => { timer = null; run(); }, CFG.SAVE_DEBOUNCE_MS || 8000);
      emit();
    },
    /** Conectare / reconectare (din clic). */
    async connect() {
      await requestToken();
      meta.connected = true; saveMeta();
      lastError = null;
      emit();
      await run();
    },
    disconnect() {
      try { if (token && window.google && google.accounts.oauth2.revoke) google.accounts.oauth2.revoke(token.access_token, () => {}); } catch (e) { /* */ }
      token = null; writeLS(LS_TOKEN, null);
      meta.connected = false; meta.fileId = null; meta.version = null; saveMeta();
      needAuth = false; lastError = null; setBase(null);
      emit();
    },
    syncNow() { lastError = null; return run(); },
    /** Lista copiilor de siguranță din Drive, cele mai noi primele. */
    async listBackups() {
      const files = await listBackups();
      return files.map((f) => ({ id: f.id, name: f.name, day: f.name.slice(BACKUP_PREFIX.length, -5) })).sort((a, b) => (a.day < b.day ? 1 : -1));
    },
    fetchBackup(id) { return download(id); },
    _debug: () => ({ meta: Object.assign({}, meta), token, needAuth, busy, base }),
  };
  window.Sync = Sync;
})();
