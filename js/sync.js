/* Zenkai – Sync zwischen Geräten über Supabase (REST, ohne Zusatzbibliothek)
   Alle Daten eines Nutzers liegen als ein JSON-Dokument in der Tabelle zenkai_data.
   Ablauf: herunterladen → mit lokalem Stand zusammenführen → hochladen, falls sich etwas geändert hat.
   Gleichzeitige Schreibvorgänge werden über eine Revisionsnummer erkannt und neu zusammengeführt. */
const Sync = (() => {
  const KEY = 'zenkai.sync';
  let cfg = loadCfg();
  let status = 'off', lastError = '', running = null, again = false, timer = null;
  const statusFns = [], remoteFns = [];

  function loadCfg() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function saveCfg() { localStorage.setItem(KEY, JSON.stringify(cfg)); }

  const conf = () => {
    const c = window.ZENKAI_CONFIG || {};
    return { url: (cfg.url || c.supabaseUrl || '').replace(/\/+$/, ''), key: cfg.key || c.supabaseKey || '', fromFile: !!(c.supabaseUrl && c.supabaseKey) };
  };
  const configured = () => { const c = conf(); return !!(c.url && c.key); };
  const loggedIn = () => !!(cfg.session && cfg.session.refresh_token);

  function setStatus(s, err = '') {
    status = s; lastError = err;
    statusFns.forEach(fn => fn(s, err));
  }

  /* ---------- HTTP ---------- */
  async function call(path, { method = 'GET', body, auth = true, prefer } = {}) {
    const c = conf();
    const headers = { apikey: c.key, 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = 'Bearer ' + await token();
    if (prefer) headers.Prefer = prefer;
    let res;
    try { res = await fetch(c.url + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { const err = new Error('Keine Verbindung zum Sync-Server.'); err.offline = true; throw err; }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { }
    if (!res.ok) {
      const msg = (json && (json.msg || json.message || json.error_description || json.error)) || res.status + ' ' + res.statusText;
      const err = new Error(translate(msg)); err.status = res.status; throw err;
    }
    return json;
  }

  function translate(m) {
    const map = {
      'Invalid login credentials': 'E-Mail oder Passwort falsch.',
      'Email not confirmed': 'E-Mail-Adresse noch nicht bestätigt – bitte den Link in der Bestätigungs-Mail öffnen.',
      'User already registered': 'Für diese E-Mail gibt es schon ein Konto – bitte anmelden.',
      'New password should be different from the old password.': 'Das neue Passwort muss sich vom alten unterscheiden.',
    };
    if (/rate limit|too many|security purposes/i.test(m)) return 'Zu viele Versuche – bitte ein paar Minuten warten.';
    if (/relation .*zenkai_data.* does not exist|Could not find the table/i.test(m)) return 'Tabelle „zenkai_data“ fehlt – bitte supabase.sql im Supabase-SQL-Editor ausführen.';
    if (/Password should be at least/i.test(m)) return 'Das Passwort ist zu kurz (mindestens 6 Zeichen).';
    if (/signups? not allowed|signup.*disabled/i.test(m)) return 'Neue Konten sind abgeschaltet – bitte mit deinem bestehenden Konto anmelden.';
    return map[m] || m;
  }

  /* ---------- Anmeldung ---------- */
  function keepSession(j) {
    cfg.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, user_id: j.user.id };
    cfg.email = j.user.email; saveCfg();
  }
  async function token() {
    const s = cfg.session;
    if (!s) throw new Error('Nicht angemeldet.');
    if (Date.now() < s.expires_at - 60000) return s.access_token;
    try {
      const j = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token }, auth: false });
      keepSession(j); return j.access_token;
    } catch (e) {
      if (!e.offline && (e.status === 400 || e.status === 401)) { cfg.session = null; saveCfg(); setStatus('login', 'Anmeldung abgelaufen – bitte neu anmelden.'); }
      throw e;
    }
  }
  // Meldet sich auf diesem Gerät ein anderes Konto an als zuletzt, werden die lokalen Daten
  // des vorherigen Kontos entfernt (sie liegen ja in dessen Cloud) – sonst würden sie vermischt.
  function startSession(j) {
    if (cfg.lastUserId && cfg.lastUserId !== j.user.id) { Store.clearLocal(); if (window.Images) Images.clearAll(); }
    keepSession(j);
    cfg.lastUserId = j.user.id; saveCfg();
  }
  async function login(email, password) {
    startSession(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false }));
    setStatus('ok');
    syncNow().catch(() => { });
  }
  async function signup(email, password) {
    const j = await call('/auth/v1/signup?redirect_to=' + encodeURIComponent(appUrl()), { method: 'POST', body: { email, password }, auth: false });
    if (j && j.access_token) { startSession(j); setStatus('ok'); syncNow().catch(() => { }); return 'ok'; }
    return 'confirm'; // E-Mail-Bestätigung erforderlich
  }
  async function logout() {
    try { if (cfg.session) await call('/auth/v1/logout', { method: 'POST' }); } catch (e) { }
    cfg.session = null; cfg.lastSync = null; saveCfg(); setStatus(configured() ? 'login' : 'off');
  }

  /* Passwort vergessen: Supabase schickt eine Mail mit Link zurück zur App */
  const appUrl = () => location.origin + location.pathname;
  async function recover(email) {
    await call('/auth/v1/recover?redirect_to=' + encodeURIComponent(appUrl()), { method: 'POST', body: { email }, auth: false });
  }
  async function updatePassword(password) {
    await call('/auth/v1/user', { method: 'PUT', body: { password } });
  }

  /* Links aus Bestätigungs-/Reset-Mails: Supabase hängt die Anmeldung als #access_token=… an die Adresse */
  async function handleRedirect() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const clean = () => history.replaceState(null, '', location.pathname + location.search);
    if (h.get('error_description')) { clean(); return { error: h.get('error_description').replace(/\+/g, ' ') }; }
    const at = h.get('access_token'), rt = h.get('refresh_token');
    if (!at || !rt || !configured()) return null;
    clean();
    try {
      const c = conf();
      const res = await fetch(c.url + '/auth/v1/user', { headers: { apikey: c.key, Authorization: 'Bearer ' + at } });
      if (!res.ok) return { error: 'Der Link ist abgelaufen oder ungültig – bitte erneut anfordern.' };
      const user = await res.json();
      startSession({ access_token: at, refresh_token: rt, expires_in: +h.get('expires_in') || 3600, user });
      setStatus('ok');
      return { type: h.get('type') || 'login' }; // 'recovery' → neues Passwort setzen; 'signup' → bestätigt
    } catch (e) { return { error: 'Keine Verbindung – bitte den Link nochmal öffnen.' }; }
  }
  function setServer(url, key) { cfg.url = url.trim(); cfg.key = key.trim(); saveCfg(); setStatus(configured() ? (loggedIn() ? 'ok' : 'login') : 'off'); }

  /* ---------- Bilder im privaten Storage-Ordner (Bucket „zenkai“, Unterordner = Nutzer-ID) ---------- */
  const imgPath = id => `zenkai/${cfg.session.user_id}/${encodeURIComponent(id)}.jpg`;
  async function storage(method, path, body, type) {
    const c = conf();
    const headers = { apikey: c.key, Authorization: 'Bearer ' + await token() };
    if (type) { headers['Content-Type'] = type; headers['x-upsert'] = 'true'; }
    let res;
    try { res = await fetch(c.url + path, { method, headers, body }); }
    catch (e) { const err = new Error('Keine Verbindung zum Sync-Server.'); err.offline = true; throw err; }
    return res;
  }
  async function uploadImage(id, blob) {
    const res = await storage('POST', '/storage/v1/object/' + imgPath(id), blob, blob.type || 'image/jpeg');
    if (!res.ok) {
      const t = await res.text();
      throw new Error(/bucket not found/i.test(t) ? 'Bildspeicher „zenkai“ fehlt in Supabase – bitte supabase.sql erneut ausführen.' : 'Bild-Upload fehlgeschlagen: ' + res.status + ' ' + t.slice(0, 120));
    }
  }
  async function downloadImage(id) {
    const res = await storage('GET', '/storage/v1/object/authenticated/' + imgPath(id));
    if (!res.ok) return null;
    return res.blob();
  }
  async function deleteImage(id) { await storage('DELETE', '/storage/v1/object/' + imgPath(id)); }

  /* ---------- Abgleich ---------- */
  async function doSync() {
    const uid = cfg.session.user_id;
    for (let attempt = 0; attempt < 4; attempt++) {
      Store.save(); // offene lokale Änderungen stempeln
      const rows = await call(`/rest/v1/zenkai_data?select=data,rev&user_id=eq.${uid}`);
      const remote = rows && rows[0];
      const before = Store.stable(Store.syncable());
      const merged = remote ? Store.applySynced(remote.data) : Store.syncable();
      const mergedJson = Store.stable(merged);
      if (mergedJson !== before) remoteFns.forEach(fn => fn());

      // Server ist schon aktuell? (normalisiert vergleichen: sortiert, Löschungen angewendet)
      if (remote && Store.stable(Store.mergeSynced(remote.data, {})) === mergedJson) return;
      if (!remote) {
        try { await call('/rest/v1/zenkai_data', { method: 'POST', body: { user_id: uid, data: merged, rev: 1 }, prefer: 'return=minimal' }); return; }
        catch (e) { if (e.status === 409) continue; throw e; } // anderes Gerät war schneller → neu zusammenführen
      }
      const upd = await call(`/rest/v1/zenkai_data?user_id=eq.${uid}&rev=eq.${remote.rev}`, {
        method: 'PATCH', body: { data: merged, rev: remote.rev + 1, updated_at: new Date().toISOString() }, prefer: 'return=representation',
      });
      if (upd && upd.length) return;
      // Revision hat sich inzwischen geändert → nochmal
    }
    throw new Error('Sync-Konflikt – bitte später erneut versuchen.');
  }

  async function syncNow() {
    if (!configured()) { setStatus('off'); return; }
    if (!loggedIn()) { setStatus('login'); return; }
    if (running) { again = true; return running; }
    setStatus('syncing');
    running = (async () => {
      try {
        await doSync();
        cfg.lastSync = Date.now(); saveCfg();
        setStatus('ok');
        if (window.Images) Images.flush(); // offline erstellte Bilder nachträglich hochladen
      } catch (e) {
        console.warn('Sync', e);
        if (status !== 'login') setStatus(e.offline ? 'offline' : 'error', e.message);
        throw e;
      } finally {
        running = null;
        if (again) { again = false; setTimeout(() => syncNow().catch(() => { }), 100); }
      }
    })();
    return running;
  }
  const quiet = () => syncNow().catch(() => { });
  function soon() { clearTimeout(timer); timer = setTimeout(quiet, 2500); }

  function init() {
    // Geräte, die schon vor der Kontowechsel-Prüfung angemeldet waren: aktuelles Konto als „zuletzt angemeldet“ merken
    if (cfg.session && !cfg.lastUserId) { cfg.lastUserId = cfg.session.user_id; saveCfg(); }
    setStatus(!configured() ? 'off' : loggedIn() ? 'ok' : 'login');
    Store.onChange(() => { if (configured() && loggedIn()) soon(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) quiet(); else if (timer) { clearTimeout(timer); quiet(); } });
    window.addEventListener('online', quiet);
    setInterval(() => { if (!document.hidden) quiet(); }, 120000);
    quiet();
  }

  return {
    init, syncNow, login, signup, logout, recover, updatePassword, handleRedirect, setServer, configured, loggedIn, conf,
    uploadImage, downloadImage, deleteImage,
    get status() { return status; }, get error() { return lastError; },
    get email() { return cfg.email; }, get lastSync() { return cfg.lastSync; },
    onStatus: fn => statusFns.push(fn), onRemoteChange: fn => remoteFns.push(fn),
  };
})();
