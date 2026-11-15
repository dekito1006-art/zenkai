/* Zenkai – Datenspeicher (localStorage + JSON-Backup + Änderungsverfolgung für den Sync) */
const Store = (() => {
  const KEY = 'zenkai.v1';
  const COLLECTIONS = ['myChars', 'people', 'sessions'];
  // Einstellungen, die zwischen Geräten abgeglichen werden.
  // API-Schlüssel nur, wenn „Schlüssel über den Sync übertragen“ (syncKeys) eingeschaltet ist.
  const BASE_SYNC = ['diaryFormat', 'diaryLength', 'creativity', 'expeditionDivisions', 'lists', 'provider', 'openaiModel', 'openaiSttModel', 'geminiModel', 'speechMode', 'syncKeys'];
  const syncSettings = () => data.settings.syncKeys ? [...BASE_SYNC, 'geminiKey', 'openaiKey'] : BASE_SYNC;

  const DEFAULT_LISTS = {
    ranks: ['Akademist', 'Genin', 'Chunin', 'Tokubetsu Jonin', 'Jonin', 'ANBU', 'Kage', 'Nukenin', 'Zivilist', 'Unbekannt'],
    villages: ['Konohagakure', 'Sunagakure', 'Kirigakure', 'Kumogakure', 'Iwagakure', 'Amegakure', 'Otogakure',
      'Takigakure', 'Kusagakure', 'Yugakure', 'Ohne Dorf', 'Unbekannt'],
    divisions: ['Keine', 'Archäologie', 'Medizin', 'Aufklärung', 'ANBU', 'Militärpolizei', 'Forschung', 'Unbekannt'],
  };

  const defaults = () => ({
    version: 1,
    settings: {
      provider: 'gemini',            // 'gemini' | 'openai' | 'none'
      openaiKey: '', openaiModel: 'gpt-4o-mini', openaiSttModel: 'gpt-4o-mini-transcribe',
      geminiKey: '', geminiModel: 'auto', // 'auto' = neuestes kostenloses Flash-Modell
      speechMode: 'browser',         // 'browser' (Live-Diktat) | 'ai' (Aufnahme + KI-Transkription)
      diaryFormat: 'fliesstext',     // 'fliesstext' | 'gegliedert'
      diaryLength: 'kurz',           // 'sehr kurz' | 'kurz' | 'mittel'
      creativity: 'treu',            // 'treu' | 'ausschmuecken'
      syncKeys: false,               // API-Schlüssel über den Sync auf eigene Geräte übertragen
      expeditionDivisions: ['Archäologie'],
      lists: JSON.parse(JSON.stringify(DEFAULT_LISTS)),
    },
    settingsUpdatedAt: 0,
    myChars: [],   // eigene Charaktere
    people: [],    // Verzeichnis
    sessions: [],
    deleted: {},   // id -> Zeitpunkt der Löschung (damit Löschungen synchronisiert werden)
  });

  function merge(base, d) {
    const out = { ...base, ...d };
    out.settings = { ...base.settings, ...(d.settings || {}) };
    out.settings.lists = { ...base.settings.lists, ...((d.settings || {}).lists || {}) };
    out.deleted = d.deleted || {};
    // Umstellung auf Gemini: wer nie einen OpenAI-Schlüssel eingetragen hat, bekommt Gemini; abgekündigtes Modell → automatisch
    if (out.settings.provider === 'openai' && !out.settings.openaiKey) out.settings.provider = 'gemini';
    if (!out.settings.geminiModel || /^gemini-(1\.|2\.0|2\.5-flash$|2\.5-pro$)/.test(out.settings.geminiModel)) out.settings.geminiModel = 'auto';
    COLLECTIONS.forEach(c => (out[c] || []).forEach(x => { if (!x.updatedAt) x.updatedAt = x.createdAt || 1; }));
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return merge(defaults(), JSON.parse(raw));
    } catch (e) { console.error('Laden fehlgeschlagen', e); }
    return defaults();
  }

  let data = load();
  let timer = null;
  const listeners = [];

  /* --- Änderungsverfolgung: vergleicht jeden Datensatz mit dem Stand beim letzten Speichern --- */
  let snap = {};
  // JSON mit sortierten Schlüsseln – Postgres (jsonb) ändert die Reihenfolge, der Inhalt zählt
  const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
    : JSON.stringify(v === undefined ? null : v);
  const fp = x => { const { updatedAt, ...rest } = x; return stable(rest); };
  const settingsFp = () => stable(syncSettings().map(k => data.settings[k]));
  function takeSnapshot() {
    snap = { items: {}, at: {}, settings: settingsFp() };
    COLLECTIONS.forEach(c => data[c].forEach(x => { snap.items[x.id] = fp(x); snap.at[x.id] = x.updatedAt || 0; }));
  }
  function stamp() {
    // Eine Änderung ist immer jünger als die Version, auf der sie beruht – auch wenn die Uhr eines Geräts vorgeht
    const now = Date.now(), seen = new Set();
    const after = id => Math.max(now, (snap.at[id] || 0) + 1);
    let changed = false;
    COLLECTIONS.forEach(c => data[c].forEach(x => {
      seen.add(x.id);
      if (snap.items[x.id] !== fp(x)) { x.updatedAt = after(x.id); changed = true; }
    }));
    Object.keys(snap.items).forEach(id => { if (!seen.has(id)) { data.deleted[id] = after(id); changed = true; } });
    if (snap.settings !== settingsFp()) { data.settingsUpdatedAt = Math.max(now, (data.settingsUpdatedAt || 0) + 1); changed = true; }
    takeSnapshot();
    return changed;
  }
  takeSnapshot();

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { console.error(e); alert('Speichern fehlgeschlagen: ' + e.message); }
  }
  function save() {
    clearTimeout(timer);
    const changed = stamp();
    write();
    if (changed) listeners.forEach(fn => fn());
  }
  function saveSoon() { clearTimeout(timer); timer = setTimeout(save, 300); }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* --- Sync-Schnittstelle --- */
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  function syncable() {
    const s = {};
    syncSettings().forEach(k => { s[k] = data.settings[k]; });
    const out = { settings: s, settingsUpdatedAt: data.settingsUpdatedAt, deleted: data.deleted };
    COLLECTIONS.forEach(c => { out[c] = [...data[c]].sort(byId); });
    return out;
  }
  // Zwei Stände zusammenführen: pro Datensatz gewinnt die neuere Version, Löschungen gewinnen gegen ältere Versionen
  function mergeSynced(a, b) {
    const deleted = { ...(a.deleted || {}) };
    Object.entries(b.deleted || {}).forEach(([id, t]) => { if (!(deleted[id] >= t)) deleted[id] = t; });
    const out = { deleted };
    COLLECTIONS.forEach(c => {
      const m = new Map();
      [...(a[c] || []), ...(b[c] || [])].forEach(x => {
        const cur = m.get(x.id);
        if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) m.set(x.id, x);
      });
      out[c] = [...m.values()].filter(x => !(deleted[x.id] >= (x.updatedAt || 0))).sort(byId);
    });
    const bNewer = (b.settingsUpdatedAt || 0) > (a.settingsUpdatedAt || 0);
    out.settings = bNewer ? b.settings : a.settings;
    out.settingsUpdatedAt = Math.max(a.settingsUpdatedAt || 0, b.settingsUpdatedAt || 0);
    return out;
  }
  function applySynced(s) {
    clearTimeout(timer);
    stamp(); // lokale, noch nicht gestempelte Änderungen nicht verlieren
    const merged = mergeSynced(syncable(), s);
    COLLECTIONS.forEach(c => { data[c] = merged[c]; });
    data.deleted = merged.deleted;
    const incoming = { ...(merged.settings || {}) };
    // Ein leerer Schlüssel von einem anderen Gerät überschreibt nie einen vorhandenen
    ['geminiKey', 'openaiKey'].forEach(k => { if (k in incoming && !incoming[k] && data.settings[k]) delete incoming[k]; });
    Object.assign(data.settings, incoming);
    data.settingsUpdatedAt = merged.settingsUpdatedAt;
    takeSnapshot();
    // Veraltetes Modell aus einer alten App-Version (per Sync) korrigieren – wird beim nächsten Speichern an alle Geräte verteilt
    if (/^gemini-(1\.|2\.0|2\.5-flash$|2\.5-pro$)/.test(data.settings.geminiModel || '')) data.settings.geminiModel = 'auto';
    write();
    return merged;
  }

  function exportJSON() {
    return JSON.stringify({ ...data, settings: { ...data.settings, openaiKey: '', geminiKey: '' } }, null, 2);
  }
  function importJSON(text) {
    const d = JSON.parse(text);
    if (!d || !Array.isArray(d.sessions)) throw new Error('Keine gültige Zenkai-Sicherung.');
    const keep = { openaiKey: data.settings.openaiKey, geminiKey: data.settings.geminiKey };
    data = merge(defaults(), d);
    if (!data.settings.openaiKey) data.settings.openaiKey = keep.openaiKey;
    if (!data.settings.geminiKey) data.settings.geminiKey = keep.geminiKey;
    // importierte Daten als neu markieren, damit sie sich per Sync verteilen
    const now = Date.now();
    COLLECTIONS.forEach(c => data[c].forEach(x => { x.updatedAt = now; delete data.deleted[x.id]; }));
    data.settingsUpdatedAt = now;
    takeSnapshot(); write(); listeners.forEach(fn => fn());
  }
  function reset() {
    const now = Date.now();
    const deleted = { ...data.deleted };
    COLLECTIONS.forEach(c => data[c].forEach(x => { deleted[x.id] = Math.max(now, (x.updatedAt || 0) + 1); }));
    data = defaults(); data.deleted = deleted;
    takeSnapshot(); write(); listeners.forEach(fn => fn());
  }

  return {
    get data() { return data; },
    save, saveSoon, uid, exportJSON, importJSON, reset, DEFAULT_LISTS,
    syncable, mergeSynced, applySynced, stable, onChange: fn => listeners.push(fn),
    myChar: id => data.myChars.find(c => c.id === id),
    person: id => data.people.find(p => p.id === id),
    session: id => data.sessions.find(s => s.id === id),
  };
})();
