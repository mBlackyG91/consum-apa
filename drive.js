/* Sincronizare cu Google Drive (scope drive.file) prin Google Identity Services.
 *
 * Model:
 *  - datele locale (localStorage) sunt sursa imediată; fiecare modificare
 *    crește un contor "rev". Drive primește datele după SAVE_DEBOUNCE_MS.
 *  - ținem minte "version" a fișierului din Drive la ultima sincronizare.
 *    Dacă la următoarea sincronizare versiunea din Drive e alta, fișierul a
 *    fost modificat de pe alt dispozitiv: dacă nici local nu avem modificări,
 *    preluăm versiunea din Drive; altfel cerem utilizatorului să aleagă.
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

  const hooks = { getData: null, setData: null, onStatus: null, onConflict: null, isPristine: null };

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
  }, readLS(LS_META) || {});
  let token = readLS(LS_TOKEN); // { access_token, expires_at }

  let tokenClient = null;
  let gisState = 'idle'; // idle | loading | ready | failed
  let tokenWaiters = [];
  let timer = null;
  let busy = false;
  let again = false;
  let needAuth = false;
  let lastError = null;
  let conflict = null;   // { remoteData, remoteMeta }
  let lastRunAt = 0;

  function saveMeta() { writeLS(LS_META, meta); }
  function isConfigured() { return !!CFG.GOOGLE_CLIENT_ID && !/PUNE_AICI/.test(CFG.GOOGLE_CLIENT_ID); }
  function hasToken() { return !!(token && token.access_token && token.expires_at > Date.now()); }
  function isDirty() { return meta.rev !== meta.syncedRev; }

  // ---------- stare afișată ----------
  function status() {
    if (!isConfigured()) return { code: 'local', text: 'Doar local (Drive neconfigurat)' };
    if (!meta.connected) return { code: 'local', text: 'Doar pe acest dispozitiv' };
    if (conflict) return { code: 'conflict', text: 'Conflict: alege versiunea' };
    if (!navigator.onLine) return isDirty()
      ? { code: 'offline', text: 'Offline, se va sincroniza' }
      : { code: 'offline', text: 'Offline' };
    if (needAuth || !hasToken()) return { code: 'auth', text: 'Reconectează Google Drive' };
    if (busy || timer || isDirty()) return lastError && !busy && !timer
      ? { code: 'error', text: 'Eroare de sincronizare, încearcă din nou' }
      : { code: 'saving', text: 'Se salvează…' };
    if (lastError) return { code: 'error', text: 'Eroare de sincronizare, încearcă din nou' };
    return { code: 'ok', text: 'Sincronizat' };
  }
  function emit() { if (hooks.onStatus) hooks.onStatus(status(), info()); }
  function info() {
    return { connected: meta.connected, configured: isConfigured(), lastSyncAt: meta.lastSyncAt,
      dirty: isDirty(), hasToken: hasToken(), error: lastError ? lastError.message : null, conflict: !!conflict };
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
    return isConfigured() && meta.connected && !conflict && navigator.onLine && hasToken();
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
      const created = await createFile(hooks.getData());
      meta.fileId = created.id; meta.version = String(created.version); meta.modifiedTime = created.modifiedTime;
      meta.syncedRev = rev; saveMeta();
      return;
    }

    // 2. Drive modificat de altcineva de la ultima sincronizare?
    if (String(remote.version) !== String(meta.version)) {
      const remoteData = await download(remote.id);
      const local = hooks.getData();
      const firstOnDevice = meta.version === null;
      if (sameContent(remoteData, local)) {
        meta.version = String(remote.version); meta.modifiedTime = remote.modifiedTime; meta.syncedRev = meta.rev;
        saveMeta();
        return;
      }
      if ((!firstOnDevice && !isDirty()) || (firstOnDevice && hooks.isPristine && hooks.isPristine(local))) {
        hooks.setData(remoteData);
        meta.version = String(remote.version); meta.modifiedTime = remote.modifiedTime; meta.syncedRev = meta.rev;
        saveMeta();
        return;
      }
      conflict = { remoteData, remoteMeta: remote };
      emit();
      if (hooks.onConflict) hooks.onConflict({
        remoteData, local, remoteModifiedTime: remote.modifiedTime, firstOnDevice,
      });
      return;
    }

    // 3. Avem modificări locale: le scriem.
    if (isDirty()) {
      const rev = meta.rev;
      const updated = await updateFile(meta.fileId, hooks.getData());
      meta.version = String(updated.version); meta.modifiedTime = updated.modifiedTime;
      meta.syncedRev = rev; saveMeta();
    }
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
        if (document.visibilityState === 'visible' && Date.now() - lastRunAt > 20000) run();
      });
      emit();
      if (canRun()) run();
    },
    status,
    info,
    isConfigured,
    /** Apelat după fiecare modificare locală. */
    markDirty() {
      meta.rev++; saveMeta();
      if (timer) clearTimeout(timer);
      if (meta.connected) timer = setTimeout(() => { timer = null; run(); }, CFG.SAVE_DEBOUNCE_MS || 2000);
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
      conflict = null; needAuth = false; lastError = null;
      emit();
    },
    syncNow() { lastError = null; return run(); },
    resolveConflict(choice) {
      if (!conflict) return;
      const c = conflict; conflict = null;
      if (choice === 'remote') {
        hooks.setData(c.remoteData);
        meta.version = String(c.remoteMeta.version); meta.modifiedTime = c.remoteMeta.modifiedTime;
        meta.syncedRev = meta.rev; saveMeta();
        emit();
      } else {
        // Păstrăm local: considerăm versiunea din Drive "văzută" și o suprascriem.
        meta.version = String(c.remoteMeta.version);
        meta.rev++; saveMeta();
        run();
      }
    },
    _debug: () => ({ meta: Object.assign({}, meta), token, needAuth, busy, conflict: !!conflict }),
  };
  window.Sync = Sync;
})();
