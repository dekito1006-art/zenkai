/* Zenkai – Oberfläche */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = () => Store.data;
  const L = () => D().settings.lists;
  const app = $('#app');

  const state = { view: 'book', sessionId: null, tab: 'notes', q: '', fVillage: '', fRank: '', fDivision: '', detected: [] };

  /* ---------- Helfer ---------- */
  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show ' + type;
    clearTimeout(t._h); t._h = setTimeout(() => t.className = '', type === 'error' ? 6000 : 2500);
  }
  const opts = (list, sel, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    list.map(v => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const dl = (id, list) => `<datalist id="${id}">${list.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = d => d ? new Date(d + 'T00:00').toLocaleDateString('de-DE') : '';
  const micBtn = target => `<button class="btn ghost small mic" data-mic="${target}" type="button">🎤 Diktieren</button>`;
  // Eine Session = ein Ingame-Monat: Pflicht-Tagebuch + 0..n Einsätze mit je eigenem Bericht
  const opsOf = s => (s.ops = s.ops || []);
  const opById = (s, id) => opsOf(s).find(o => o.id === id);
  const opLabel = op => { const t = Reports.opType(op); return `${t.icon} ${t.label}${op.title ? ': ' + op.title : ''}`; };
  const doneReports = s => opsOf(s).filter(Reports.opHasContent).length;
  const fullName = p => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.name || '';
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  const str = v => (v == null ? '' : String(v)).trim();
  const arr = v => Array.isArray(v) ? v : [];
  const words = t => (t || '').trim().split(/\s+/).filter(Boolean).length;

  async function busy(btn, fn) {
    const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Arbeite…';
    try { await fn(); } catch (e) { console.error(e); toast(e.message, 'error'); }
    finally { if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = label; } }
  }

  function modal(html) { $('#modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() {
    if (state.onModalClose) { const f = state.onModalClose; state.onModalClose = null; try { f(); } catch (e) { } }
    $('#modal').classList.add('hidden'); $('#modal-box').innerHTML = '';
  }

  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast('In die Zwischenablage kopiert'))
      .catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Kopiert'); });
  }
  async function share(title, text) {
    if (navigator.share) { try { await navigator.share({ title, text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copy(text);
  }
  function download(name, text, type = 'text/plain') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Navigation ---------- */
  function go(view, extra = {}) { Object.assign(state, { view }, extra); render(); window.scrollTo(0, 0); }

  // Ort in der App merken: Android lädt die App beim Öffnen von Galerie/Kamera manchmal neu –
  // danach soll man wieder genau dort landen (z. B. im Missionsbericht) statt auf der Startseite
  const PLACE = 'zenkai.place';
  const savePlace = () => { try { sessionStorage.setItem(PLACE, JSON.stringify({ view: state.view, sessionId: state.sessionId, tab: state.tab, missionId: state.missionId, at: Date.now() })); } catch (e) { } };
  function restorePlace() {
    try {
      const p = JSON.parse(sessionStorage.getItem(PLACE) || 'null');
      if (p && Date.now() - p.at < 30 * 60e3) Object.assign(state, { view: p.view || state.view, sessionId: p.sessionId || null, tab: p.tab || 'notes', missionId: p.missionId || null });
    } catch (e) { }
  }

  /* ---------- Anmeldeseite: ohne Anmeldung ist die App gesperrt ---------- */
  const gated = () => (Sync.configured() && !Sync.loggedIn()) || state.gate === 'newpw';

  function viewGate() {
    const mode = Sync.loggedIn() ? 'newpw' : (state.gate && state.gate !== 'newpw' ? state.gate : 'login');
    const titles = { login: 'Anmelden', signup: 'Konto erstellen', forgot: 'Passwort vergessen', newpw: 'Neues Passwort festlegen' };
    const email = `<label>E-Mail<input name="email" type="email" autocomplete="username" required value="${esc(Sync.email || '')}"></label>`;
    const back = `<div class="gate-links"><a href="#" data-gate="login">← Zurück zur Anmeldung</a></div>`;
    const forms = {
      login: `${email}
        <label>Passwort<input name="password" type="password" autocomplete="current-password" required minlength="6"></label>
        <button class="btn primary big">Anmelden</button>
        <div class="gate-links"><a href="#" data-gate="forgot">Passwort vergessen?</a><a href="#" data-gate="signup">Konto erstellen</a></div>`,
      signup: `${email}
        <label>Passwort <span class="muted small">(mind. 8 Zeichen)</span><input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
        <label>Passwort wiederholen<input name="password2" type="password" autocomplete="new-password" required minlength="8"></label>
        <button class="btn primary big">Konto erstellen</button>${back}`,
      forgot: `<p class="muted small">Du bekommst eine E-Mail mit einem Link. Öffne ihn auf diesem Gerät, dann kannst du ein neues Passwort festlegen.</p>
        ${email}<button class="btn primary big">Link schicken</button>${back}`,
      newpw: `<p class="muted small">Angemeldet als <strong>${esc(Sync.email || '')}</strong>. Lege jetzt dein neues Passwort fest.</p>
        <label>Neues Passwort <span class="muted small">(mind. 8 Zeichen)</span><input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
        <label>Passwort wiederholen<input name="password2" type="password" autocomplete="new-password" required minlength="8"></label>
        <button class="btn primary big">Passwort speichern</button>`,
    };
    app.innerHTML = `<div class="gate"><div class="gate-card">
      <div class="gate-brand"><img src="icon.svg" width="64" height="64" alt=""><div><h1>Zenkai</h1><p class="muted small">Tagebuch, Berichte & Verzeichnis für dein RP</p></div></div>
      <h2>${titles[mode]}</h2>
      ${(state.gateMsg || (Sync.status === 'login' && Sync.error)) ? `<div class="note">${esc(state.gateMsg || Sync.error)}</div>` : ''}
      <form id="gate-form" data-mode="${mode}" class="form">${forms[mode]}</form>
    </div></div>`;
    const first = app.querySelector('#gate-form input:not([value]), #gate-form input[value=""]') || app.querySelector('#gate-form input[type=password]');
    if (first && window.innerWidth > 720) first.focus();
  }

  async function submitGate(f, btn) {
    const v = Object.fromEntries(new FormData(f));
    const mode = f.dataset.mode;
    if ((mode === 'signup' || mode === 'newpw') && v.password !== v.password2) { state.gateMsg = 'Die beiden Passwörter stimmen nicht überein.'; return render(); }
    await busy(btn, async () => {
      try {
        if (mode === 'login') {
          await Sync.login(v.email.trim(), v.password);
          state.gate = null; state.gateMsg = ''; go('sessions'); toast('Willkommen zurück ✓');
        } else if (mode === 'signup') {
          const r = await Sync.signup(v.email.trim(), v.password);
          if (r === 'confirm') { state.gate = 'login'; state.gateMsg = 'Fast geschafft: Wir haben dir eine E-Mail geschickt. Bestätige dein Konto über den Link darin – danach bist du direkt angemeldet.'; render(); }
          else { state.gate = null; state.gateMsg = ''; go('sessions'); toast('Konto erstellt ✓'); }
        } else if (mode === 'forgot') {
          await Sync.recover(v.email.trim());
          state.gate = 'login'; state.gateMsg = 'Falls es ein Konto mit dieser E-Mail gibt, ist ein Link unterwegs. Öffne ihn auf diesem Gerät.'; render();
        } else if (mode === 'newpw') {
          await Sync.updatePassword(v.password);
          state.gate = null; state.gateMsg = ''; go('sessions'); toast('Neues Passwort gespeichert ✓');
        }
      } catch (e) { state.gateMsg = e.message; render(); }
    });
  }

  function render() {
    if (gated()) { document.body.classList.add('gated'); viewGate(); return; }
    document.body.classList.remove('gated');
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view || (state.view === 'session' && b.dataset.view === 'sessions')));
    ({ book: viewBook, missions: viewMissions, sessions: viewSessions, session: viewSession, people: viewPeople, mychars: viewMyChars, settings: viewSettings }[state.view] || viewSessions)();
    Images.hydrate(app);
    savePlace();
  }

  /* ---------- Sessions ---------- */
  function viewSessions() {
    const list = [...D().sessions].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    const ai = AI.available();
    let hideHint = false; try { hideHint = localStorage.getItem('zenkai.hideAiHint') === '1'; } catch (e) { }
    // Neue Nutzer: kurzer Einstieg in 3 Schritten
    const welcome = !D().myChars.length ? `<div class="panel welcome">
        <h3>👋 Willkommen bei Zenkai</h3>
        <p class="muted small">Nach jeder Session erzählst du kurz, was passiert ist – Zenkai macht daraus dein Tagebuch und (für Divisionen wie die Archäologie) den Bericht.</p>
        <ol class="steps">
          <li><a href="#" data-act="add-mychar">Deinen Charakter anlegen</a> – Name, Rang, Dorf, Division, Alter</li>
          <li><em>Optional:</em> <a href="#" data-go="settings">eigene KI verbinden</a> (kostenloser Gemini-Schlüssel) – dann schreibt Zenkai die Berichte für dich. Ohne KI schreibst du selbst, mit Vorlagen.</li>
          <li>„＋ Neue Session“ – erzählen oder tippen, fertig</li>
        </ol>
        <button class="btn primary" data-act="add-mychar">＋ Charakter anlegen</button>
      </div>` : '';
    const aiHint = !ai && D().myChars.length && !hideHint ? `<div class="note row-between">
        <span>💡 Optional: Mit deiner <a href="#" data-go="settings">eigenen KI</a> schreibt Zenkai Tagebuch und Bericht automatisch.</span>
        <button class="btn ghost small" data-act="hide-ai-hint">Ausblenden</button></div>` : '';
    app.innerHTML = `
      <div class="head"><h1>Sessions</h1><button class="btn primary" data-act="new-session">＋ Neue Session</button></div>
      ${welcome}${aiHint}
      ${list.length ? `<div class="cards">${list.map(s => {
        const c = Store.myChar(s.myCharId); const nOps = opsOf(s).length, nDone = doneReports(s);
        return `<button class="card" data-open="${s.id}">
          <div class="card-top"><strong>${esc(s.title || 'Ohne Titel')}</strong><span class="muted">${fmtDate(s.date)}</span></div>
          <div class="muted small">${esc(c ? c.name : '–')}${s.ingameDate ? ' · ' + esc(s.ingameDate) : ''} · ${(s.participants || []).length} Personen</div>
          ${s.diary && s.diary.imageId ? `<img class="thumb" data-img="${esc(s.diary.imageId)}" alt="">` : ''}
          <div class="badges">
            <span class="badge ${s.diary && s.diary.text ? 'ok' : ''}">📖 Tagebuch</span>
            ${nOps ? `<span class="badge ${nDone === nOps ? 'ok' : ''}">📜 ${nDone}/${nOps} Bericht${nOps > 1 ? 'e' : ''}</span>` : ''}
          </div></button>`;
      }).join('')}</div>` : (D().myChars.length ? '<div class="empty">Noch keine Sessions. Starte mit „Neue Session“.</div>' : '')}`;
  }

  function newSession() {
    if (!D().myChars.length) { go('mychars'); toast('Bitte zuerst einen eigenen Charakter anlegen'); return; }
    const last = [...D().sessions].sort((a, b) => b.createdAt - a.createdAt)[0];
    const s = {
      id: Store.uid(), createdAt: Date.now(), date: today(), title: '', ingameDate: '',
      myCharId: last ? last.myCharId : D().myChars[0].id, notes: '', participants: [],
      diary: { text: '' }, ops: [],
    };
    D().sessions.push(s); Store.save();
    go('session', { sessionId: s.id, tab: 'notes', detected: [] });
  }

  function viewSession() {
    const s = Store.session(state.sessionId);
    if (!s) return go('sessions');
    if (state.tab === 'expedition') state.tab = 'ops';
    const tabs = [['notes', '1 · Erzählen'], ['diary', '2 · Tagebuch'], ['ops', `3 · Einsätze${opsOf(s).length ? ' (' + opsOf(s).length + ')' : ''}`], ['export', '✓ Export']];
    app.innerHTML = `
      <div class="head"><button class="btn ghost" data-go="sessions">← Zurück</button>
        <button class="btn ghost danger small" data-act="del-session">Löschen</button></div>
      <div class="grid2 meta">
        <label class="wide">Titel<input data-s="title" value="${esc(s.title)}" placeholder="z. B. Die Ruinen von Uzushio"></label>
        <label>Datum (real)<input type="date" data-s="date" value="${esc(s.date)}"></label>
        <label>Ingame-Monat<input data-s="ingameDate" value="${esc(s.ingameDate)}" placeholder="z. B. Monat 2"></label>
        <label>Gespielter Charakter<select data-s="myCharId">${D().myChars.map(c => `<option value="${c.id}" ${c.id === s.myCharId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label>Rang in dieser Session<input data-s="rank" list="dl-srank" value="${esc(s.rank)}" placeholder="${esc((Store.myChar(s.myCharId) || {}).rank ? (Store.myChar(s.myCharId).rank + ' (vom Charakter)') : 'z. B. Genin')}">${dl('dl-srank', L().ranks)}</label>
        <label>Alter in dieser Session<input data-s="age" inputmode="numeric" value="${esc(s.age)}" placeholder="${esc((Store.myChar(s.myCharId) || {}).age ? (Store.myChar(s.myCharId).age + ' (vom Charakter)') : 'z. B. 13')}"></label>
      </div>
      <nav class="subtabs">${tabs.map(([k, l]) => `<button class="${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
      <section id="tab"></section>`;
    ({ notes: tabNotes, diary: tabDiary, ops: tabOps, export: tabExport })[state.tab](s, $('#tab'));
  }

  function tabNotes(s, el) {
    const ppl = [...D().people].sort(byName);
    const qa = s.qa || [], conflicts = s.conflicts || [];
    const ai = AI.available();
    const scenes = (s.analysis && s.analysis.scenes) || [];
    el.innerHTML = `
      <div class="panel">
        <h3>Erzähl, was in der Session passiert ist</h3>
        <p class="muted small">Einfach drauflosreden – oder nur <strong>Stichpunkte</strong> notieren. Zenkai formuliert daraus Tagebuch und Berichte aus und fragt nach, wo Details fehlen.</p>
        <button class="btn primary big mic" data-mic="notes" type="button">🎤 Erzähl einfach los</button>
        <textarea id="notes" data-s="notes" rows="8" placeholder="Erzählen oder Stichpunkte, z. B.:&#10;- Jinsei nicht gefunden, Brief geschrieben&#10;- Sensei bringt mir Feuerball bei&#10;- Schmied Yokurai leiht mir Geld für 2 Schwerter&#10;- erste Mission mit Furaion">${esc(s.notes)}</textarea>
        <div class="muted small right">${s.notes.trim() && Reports.isBullets(s.notes) ? '📝 Stichpunkte erkannt · ' : ''}${words(s.notes)} Wörter</div>
      </div>
      ${scenes.length ? scenesPanel(s, scenes) : ''}
      ${scenes.length || opsOf(s).length ? opsPanel(s) : ''}
      ${conflicts.length || qa.length ? `<div class="panel qa">
        <div class="row-between"><h3>🤔 Rückfragen</h3><span class="muted small">Beantworten oder leer lassen</span></div>
        ${conflicts.map((c, i) => `<div class="qa-item conflict">
          <div class="qa-q">⚠️ ${esc(c.text)}</div>
          <div class="btns"><button class="btn small" data-conf-apply="${i}">${c.type === 'title' ? 'Titel ändern' : 'Für diese Session'}: ${esc(c.value)}</button>
            ${c.type === 'rank' || c.type === 'age' ? `<button class="btn ghost small" data-conf-char="${i}">Auch am Charakter ändern</button>` : ''}
            <button class="btn ghost small" data-conf-skip="${i}">Passt so</button></div>
        </div>`).join('')}
        ${qa.map((x, i) => `<div class="qa-item">
          <div class="qa-q">${esc(x.q)}</div>${x.why ? `<div class="muted small">${esc(x.why)}</div>` : ''}
          <div class="qa-a"><textarea id="qa-${i}" data-qa="${i}" rows="2" placeholder="Antwort…">${esc(x.a)}</textarea>${micBtn('qa-' + i)}</div>
        </div>`).join('')}
      </div>` : ''}
      <div class="cta">
        ${!ai
        ? `<button class="btn primary big" data-tab="diary">✍️ Weiter: Tagebuch schreiben</button>
           <button class="btn ghost" data-tab="ops">📜 Einsätze & Berichte</button>
           <p class="muted small">Du arbeitest ohne KI – deine Notizen bleiben hier als Gedächtnisstütze stehen. Optional kann Zenkai die Berichte mit deiner eigenen, kostenlosen KI schreiben: <a href="#" data-go="settings">Einstellungen → KI-Schreibhilfe</a>.</p>`
        : scenes.length
        ? `<div class="gen-what"><span class="muted small">Was soll geschrieben werden?</span><div class="chips">
              <button class="chip ${wantDiary(s) ? 'on' : ''}" data-gen-diary="1" ${s.diary.text ? '' : 'disabled title="Das Tagebuch ist Pflicht"'}>📖 Tagebuch${s.diary.text ? '' : ' (Pflicht)'}</button>
              ${opsOf(s).map(op => `<button class="chip ${op.wanted ? 'on' : ''}" data-op-want="${op.id}">${esc(opLabel(op))}</button>`).join('')}
            </div></div>
           <button class="btn primary big" data-act="gen-all" ${genCount(s) ? '' : 'disabled'}>✨ ${genTitle(s)}</button>
           <button class="btn ghost" data-act="ask">Neu analysieren (nach Änderungen an der Erzählung)</button>`
        : `<button class="btn primary big" data-act="ask">✨ Weiter – Zenkai analysiert die Session</button>
           <p class="muted small">Zenkai zerlegt deine Erzählung in Szenen, prüft Widersprüche und stellt Rückfragen. Danach schreibst du mit einem Tipp.</p>`}
      </div>
      <div class="panel">
        <div class="row-between"><h3>Beteiligte Personen</h3>
          <div class="btns"><button class="btn ghost small" data-act="detect">🔍 Aus Notizen erkennen</button>
          <button class="btn ghost small" data-act="add-person-session">＋ Neue Person</button></div></div>
        <div id="detected">${detectedHtml()}</div>
        ${ppl.length ? `<div class="chips">${ppl.map(p => `<button class="chip ${s.participants.includes(p.id) ? 'on' : ''}" data-part="${p.id}">${esc(p.name)}<small>${esc(p.profession || p.rank || '')}</small></button>`).join('')}</div>`
        : '<p class="muted small">Noch niemand im Verzeichnis.</p>'}
      </div>`;
  }

  /* Einsätze des Monats: erkannt von der KI, frei änderbar */
  const typeOptions = sel => Object.entries(Reports.OP_TYPES).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('');
  function opsPanel(s) {
    const ops = opsOf(s);
    return fold('ops-detect', '📜 Einsätze in diesem Monat', ops.length ? `${ops.length} erkannt` : 'keine', `
      <p class="muted small">Das Tagebuch erzählt den ganzen Monat. Für jeden Einsatz entsteht zusätzlich ein eigener Bericht. Stimmt etwas nicht? Art und Titel ändern, entfernen oder hinzufügen.</p>
      ${ops.length ? ops.map(op => `<div class="op-row">
        <select data-op-type="${op.id}">${typeOptions(op.type)}</select>
        <input data-op-field="${op.id}" data-k="title" value="${esc(op.title || '')}" placeholder="Titel, z. B. Material sammeln für den Schmied">
        <button class="btn ghost small" data-op-del="${op.id}" title="Einsatz entfernen">✕</button>
        ${op.summary || (op.scenes || []).length ? `<div class="muted small op-sum">${esc(op.summary || '')}${(op.scenes || []).length ? ` · Szene ${op.scenes.join(', ')}` : ''}</div>` : ''}
      </div>`).join('') : '<p class="muted small">Keine Einsätze erkannt – dann gibt es nur das Tagebuch.</p>'}
      <div class="row"><select id="op-new-type">${typeOptions('mission')}</select><button class="btn ghost small" data-act="op-add">＋ Einsatz hinzufügen</button></div>`, true);
  }
  const wantDiary = s => !s.diary.text || s.genDiary !== false;
  const genCount = s => (wantDiary(s) ? 1 : 0) + opsOf(s).filter(o => o.wanted).length;
  function genTitle(s) {
    const n = opsOf(s).filter(o => o.wanted).length;
    const parts = [wantDiary(s) && 'Tagebuch', n && `${n} Bericht${n > 1 ? 'e' : ''}`].filter(Boolean);
    return parts.length ? parts.join(' + ') + ' schreiben' : 'Nichts ausgewählt';
  }

  function scenesPanel(s, scenes) {
    return fold('scenes', '🧩 So hat Zenkai deine Session verstanden', `${scenes.length} Szenen`, `
      <p class="muted small">Prüfe kurz: Fehlt etwas oder ist etwas falsch verstanden? Hier korrigieren – daraus wird das Tagebuch geschrieben.</p>
      ${scenes.map((x, i) => `<div class="scene">
        <div class="scene-head"><span class="scene-no">${i + 1}</span><input data-scene="${i}" data-k="title" value="${esc(x.title)}" placeholder="Überschrift"><button class="btn ghost small" data-scene-del="${i}" title="Szene entfernen">✕</button></div>
        <textarea data-scene="${i}" data-k="summary" rows="2" placeholder="Was passierte – warum – mit welchem Ergebnis?">${esc(x.summary)}</textarea>
        <div class="scene-foot">${(x.people || []).length ? `<span class="muted small">👥 ${esc(x.people.join(', '))}</span>` : ''}
          <input data-scene="${i}" data-k="feeling" value="${esc(x.feeling)}" placeholder="Gefühl dabei (optional)"></div>
      </div>`).join('')}
      <button class="btn ghost small" data-act="scene-add">＋ Szene ergänzen</button>`, true);
  }

  // Bekannte Personen anhand von Vor- oder Nachname in der Erzählung finden und als beteiligt markieren
  function markKnownPeople(s) {
    const text = (s.notes || '').toLowerCase();
    let found = 0;
    D().people.forEach(p => {
      const hit = [p.firstName, p.lastName, p.name].filter(n => n && n.length > 2).some(n => text.includes(n.toLowerCase()));
      if (hit && !s.participants.includes(p.id)) { s.participants.push(p.id); found++; }
    });
    return found;
  }
  // Tippfehler-tolerante Namenssuche (Levenshtein): "Bukagawe" ≈ "Bakagane"
  function lev(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function similarPerson(name, exceptIds = []) {
    const toks = str(name).toLowerCase().split(/\s+/).filter(t => t.length >= 3);
    let best = null, bestSim = 0;
    D().people.forEach(p => {
      if (exceptIds.includes(p.id)) return;
      [p.firstName, p.lastName].filter(x => x && x.length >= 3).forEach(x => {
        const xs = x.toLowerCase();
        toks.forEach(t => {
          const dist = lev(t, xs), sim = 1 - dist / Math.max(t.length, xs.length);
          if (dist <= 3 && sim >= 0.6 && sim < 1 && sim > bestSim) { best = p; bestSim = sim; }
        });
      });
    });
    return best;
  }

  // Erkannte Person einer bekannten zuordnen; optional die Schreibweise in Erzählung und Szenen korrigieren
  function linkDetected(s, i, personId, fix) {
    const det = state.detected[i], p = Store.person(personId);
    if (!det || !p) return;
    if (!s.participants.includes(p.id)) s.participants.push(p.id);
    if (fix) {
      const pairs = [[det.firstName, p.firstName || p.name], [det.lastName, p.lastName]].filter(([a, b]) => a && b && a !== b);
      const rep = t => pairs.reduce((acc, [a, b]) => acc.replace(new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), b), t || '');
      s.notes = rep(s.notes);
      ((s.analysis && s.analysis.scenes) || []).forEach(x => { x.summary = rep(x.summary); x.title = rep(x.title); x.people = (x.people || []).map(rep); });
    }
    state.detected.splice(i, 1);
    Store.save(); render();
    toast(`Zugeordnet: ${p.name}${fix ? ' (Schreibweise korrigiert)' : ''}`);
  }

  function findPerson(name) {
    const n = str(name).toLowerCase(); if (!n) return null;
    const exact = D().people.find(p => p.name.toLowerCase() === n);
    if (exact) return exact;
    const hits = D().people.filter(p => [p.firstName, p.lastName].some(x => x && (x.toLowerCase() === n || n.split(/\s+/).includes(x.toLowerCase()))));
    return hits.length === 1 ? hits[0] : null;
  }

  /* Schritt 1: Analyse – Szenen, Widersprüche, Expedition, Rückfragen, Personen + Berufe */
  async function analyze(s, quiet) {
    if (!s.notes.trim()) throw new Error('Erzähl zuerst, was passiert ist.');
    const marked = markKnownPeople(s);
    const r = await AI.completeJSON({ ...Reports.analyzePrompt(s), quality: true });
    s.analysis = {
      at: Date.now(),
      scenes: arr(r.scenes).map(x => ({ title: str(x.title), summary: str(x.summary), people: arr(x.people).map(str).filter(Boolean), feeling: str(x.feeling) })).filter(x => x.title || x.summary),
      lessons: arr(r.lessons).map(str).filter(Boolean),
    };
    // Einsätze: Berichte mit Inhalt bleiben; leere, automatisch erkannte werden durch die neue Erkennung ersetzt
    const keep = opsOf(s).filter(o => Reports.opHasContent(o) || !o.auto);
    const norm = t => str(t).toLowerCase();
    arr(r.ops).forEach(o => {
      const type = Reports.OP_TYPES[o.type] ? o.type : 'mission';
      const dup = keep.find(k => k.type === type && (norm(k.title) === norm(o.title) || !k.title));
      const fields = { title: str(o.title), summary: str(o.summary), scenes: arr(o.scenes).map(Number).filter(n => n > 0) };
      if (dup) { Object.assign(dup, { ...fields, title: dup.title || fields.title }); return; }
      keep.push({ id: 'op_' + Store.uid(), type, ...fields, missionsRang: /^[DCBAS]$/.test(str(o.rank)) ? str(o.rank) : '', geheimhaltung: 'Intern (Division)', finds: [], wanted: Reports.OP_TYPES[type].def, auto: true });
    });
    s.ops = keep;
    // Widersprüche: Rang/Alter/Titel mit Ein-Tipp-Korrektur, alles andere als Rückfrage
    const conf = arr(r.conflicts).filter(c => c && str(c.text));
    const fixable = conf.filter(c => ['rank', 'age', 'title'].includes(c.type) && str(c.value));
    s.conflicts = fixable.slice(0, 4).map(c => ({ type: c.type, text: str(c.text), value: str(c.value) }));
    const fresh = [...conf.filter(c => !fixable.includes(c)).map(c => ({ q: str(c.text), why: 'Widerspruch in der Erzählung', a: '' })),
      ...arr(r.questions).slice(0, Reports.isBullets(s.notes) ? 6 : 4).map(x => ({ q: str(x.q || x), why: str(x.why), a: '' }))].filter(x => x.q);
    s.qa = [...(s.qa || []).filter(x => x.a && x.a.trim()), ...fresh];
    // Neue Personen (mit Beruf) als Vorschlag
    const known = new Set(D().people.map(p => p.name.toLowerCase()));
    state.detected = arr(r.newPeople).map(p => ({
      firstName: str(p.firstName), lastName: str(p.lastName), rank: str(p.rank), village: str(p.village), division: str(p.division),
      clan: str(p.clan), profession: str(p.profession), notes: str(p.note),
    })).filter(p => (p.firstName || p.lastName) && !known.has(fullName(p).toLowerCase()));
    state.detected.forEach(p => { p.name = fullName(p); const sim = similarPerson(p.name); if (sim) p.maybe = sim.id; });
    // Bekannte Personen: fehlenden Beruf automatisch eintragen, Abweichungen als Vorschlag
    state.updates = []; state.autoApplied = [];
    arr(r.updates).forEach(u => {
      const p = findPerson(u.name);
      if (!p) { // KI meint eine bekannte Person, aber anders geschrieben → als Rückfrage anbieten
        const sim = similarPerson(u.name);
        if (sim && !state.detected.some(d => d.maybe === sim.id)) {
          const [f, ...l] = str(u.name).split(/\s+/);
          state.detected.push({ firstName: f || '', lastName: l.join(' '), name: str(u.name), maybe: sim.id, profession: str(u.profession), rank: str(u.rank), notes: str(u.note) });
        }
        return;
      }
      if (!s.participants.includes(p.id)) s.participants.push(p.id);
      const prof = str(u.profession), rank = str(u.rank);
      if (prof && !p.profession) { p.profession = prof; state.autoApplied.push(`${p.name}: Beruf „${prof}“`); }
      const ch = {};
      if (prof && p.profession && p.profession.toLowerCase() !== prof.toLowerCase()) ch.profession = prof;
      if (rank && rank !== p.rank) ch.rank = rank;
      if (Object.keys(ch).length) state.updates.push({ id: p.id, name: p.name, changes: ch, note: str(u.note) });
    });
    Store.save();
    if (quiet) return;
    render();
    const n = s.analysis.scenes.length, q = s.conflicts.length + fresh.length, np = state.detected.length + state.updates.length;
    toast(`${n} Szenen erkannt${q ? ` · ${q} Rückfrage(n)` : ''}${np ? ` · ${np} Personen-Vorschläge` : ''}${marked ? ` · ${marked} bekannte Person(en) markiert` : ''}`);
  }

  async function generateAll(s) {
    if (!AI.available()) throw new Error('Bitte zuerst in den Einstellungen eine KI verbinden.');
    if (!s.analysis || !(s.analysis.scenes || []).length) await analyze(s, true); // immer zweistufig: erst Szenen, dann Text
    const doDiary = wantDiary(s), ops = opsOf(s).filter(o => o.wanted);
    const existing = [doDiary && s.diary.text && 'Tagebuch', ...ops.filter(Reports.opHasContent).map(opLabel)].filter(Boolean);
    if (existing.length && !confirm(`Schon vorhanden: ${existing.join(', ')}.\nNeu schreiben und ersetzen?`)) return;
    // Tagebuch und Berichte parallel (höchstens 3 gleichzeitig, um das Gratis-Kontingent zu schonen)
    const jobs = [doDiary ? () => genDiary(s) : null, ...ops.map(op => () => genOp(s, op))].filter(Boolean);
    const errors = [];
    for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3).map(j => j().catch(e => errors.push(e.message))));
    state.tab = doDiary ? 'diary' : 'ops'; render(); window.scrollTo(0, 0);
    if (errors.length) toast(`Teilweise fehlgeschlagen: ${errors[0]}`, 'error');
    else toast(`${genTitle(s).replace(' schreiben', '')} erstellt ✓`);
  }

  function detectedHtml() {
    const det = state.detected || [], upd = state.updates || [], auto = state.autoApplied || [];
    if (!det.length && !upd.length && !auto.length) return '';
    const facts = p => [p.profession && '⚒ ' + p.profession, p.rank, p.village, p.division].filter(Boolean).join(' · ');
    return `<div class="detected">
      ${auto.length ? `<div class="small">✓ <strong>Automatisch ergänzt:</strong> ${esc(auto.join(', '))}</div>` : ''}
      ${det.length ? `<div class="small"><strong>Neu erkannt:</strong> mit einem Tipp ins Verzeichnis übernehmen</div>` : ''}
      ${det.map((p, i) => {
        const m = p.maybe && Store.person(p.maybe);
        const pick = `<select data-det-pick="${i}" class="det-pick"><option value="">${m ? 'Andere Person zuordnen…' : 'Ist eine bekannte Person…'}</option>${[...D().people].sort(byName).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>`;
        return m ? `<div class="det-row maybe"><div>❓ Ist <strong>„${esc(p.name)}“</strong> dieselbe Person wie <strong>${esc(m.name)}</strong>?
            <div class="muted small">Ähnliche Schreibweise – evtl. ein Tipp- oder Diktierfehler.</div>
            <label class="check small"><input type="checkbox" id="det-fix-${i}" checked><span>Schreibweise in Erzählung und Szenen korrigieren</span></label></div>
          <div class="btns"><button class="btn small" data-det-same="${i}">Ja, dieselbe</button><button class="btn ghost small" data-det-add="${i}">Nein, neue Person</button>${pick}</div></div>`
        : `<div class="det-row"><div><strong>${esc(p.name)}</strong>${!p.firstName || !p.lastName ? ' <span class="badge">Name unvollständig</span>' : ''} <span class="muted small">${esc(facts(p))}</span>
            ${p.notes ? `<div class="muted small">${esc(p.notes)}</div>` : ''}</div>
          <div class="btns"><button class="btn small" data-det-add="${i}">Übernehmen</button><button class="btn ghost small" data-det-skip="${i}">✕</button>${D().people.length ? pick : ''}</div></div>`;
      }).join('')}
      ${upd.length ? `<div class="small"><strong>Neue Infos zu bekannten Personen:</strong></div>` : ''}
      ${upd.map((u, i) => `<div class="det-row"><div><strong>${esc(u.name)}</strong> <span class="muted small">${esc(Object.entries(u.changes).map(([k, v]) => (k === 'profession' ? 'Beruf' : 'Rang') + ' → ' + v).join(', '))}</span>
        ${u.note ? `<div class="muted small">${esc(u.note)}</div>` : ''}</div>
        <div class="btns"><button class="btn small" data-upd-apply="${i}">Übernehmen</button><button class="btn ghost small" data-upd-skip="${i}">✕</button></div></div>`).join('')}
    </div>`;
  }

  async function genDiary(s) {
    if (!s.notes.trim()) throw new Error('Bitte zuerst Notizen eintragen.');
    const clean = t => t.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/^[ \t]+/gm, '').trim();
    let text = clean(await AI.complete({ ...Reports.diaryPrompt(s), quality: true }));
    // Zweiter Durchgang: Faktencheck gegen Erzählung und Szenen (entfernt Erfundenes); bei Fehler bleibt der erste Text
    try {
      const r = await AI.completeJSON({ ...Reports.factCheckPrompt(s, text), quality: true });
      const res = Reports.applyFactCheck(text, r.remove, s);
      if (res.removed && words(res.text) > words(text) * 0.7) { text = res.text; s.diary.factCheck = res.removed; }
    } catch (e) { console.warn('Faktencheck übersprungen', e); }
    s.diary.text = text;
    s.diary.updatedAt = Date.now(); Store.save();
  }
  // Bericht zu einem Einsatz schreiben (Vorlage je nach Art)
  async function genOp(s, op) {
    if (!s.notes.trim()) throw new Error('Bitte zuerst Notizen eintragen.');
    const t = Reports.opType(op);
    const r = await AI.completeJSON({ ...Reports.opPrompt(s, op), quality: true });
    [...t.head, ...t.sections].forEach(f => { if (r[f.key]) op[f.key] = String(r[f.key]); });
    if (r.ergebnis) op.ergebnis = r.ergebnis;
    if (t.finds && Array.isArray(r.finds) && r.finds.length) op.finds = r.finds.map(f => ({ ...f }));
    if (!op.leitung && t.head.some(f => f.key === 'leitung')) op.leitung = (Store.myChar(s.myCharId) || {}).name || '';
    op.updatedAt = Date.now();
    Store.save();
  }

  /* Einklappbarer Teil innerhalb eines Panels (Zustand wird wie bei den Einstellungen gemerkt) */
  function sub(id, title, hint, body, def = false) {
    return `<details class="sub" data-fold="${id}" ${foldOpen(id, def) ? 'open' : ''}>
      <summary><span class="sub-title">${title}</span><span class="fold-hint">${esc(hint || '')}</span></summary>
      <div class="sub-body">${body}</div></details>`;
  }
  const allToggle = scope => `<button class="btn ghost small" data-act="fold-all" data-scope="${scope}">⇕ Alle auf/zu</button>`;

  /* Tagebuch in Abschnitte zerlegen: Überschrift = kurze Zeile ohne Satzzeichen am Ende, gefolgt von Text */
  function diarySections(text) {
    const lines = (text || '').replace(/\r/g, '').split('\n');
    const out = []; let cur = { title: '', body: [] };
    const isHead = (l, i) => {
      const t = l.trim();
      return t.length >= 2 && t.length <= 60 && !/[.!?…:,;)"“”]$/.test(t) && (i === 0 || !lines[i - 1].trim()) && lines[i + 1] && lines[i + 1].trim();
    };
    lines.forEach((l, i) => {
      if (isHead(l, i) && (cur.title || cur.body.join('').trim())) { out.push(cur); cur = { title: l.trim(), body: [] }; }
      else if (isHead(l, i) && !cur.title && !cur.body.join('').trim()) cur.title = l.trim();
      else cur.body.push(l);
    });
    out.push(cur);
    return out.map(x => ({ title: x.title, body: x.body.join('\n').trim() })).filter(x => x.title || x.body);
  }
  const diaryJoin = secs => secs.map(x => (x.title ? x.title + '\n' : '') + x.body).join('\n\n');

  function tabDiary(s, el) {
    const me = Store.myChar(s.myCharId);
    const ai = AI.available();
    const secs = diarySections(s.diary.text);
    const split = secs.length > 1 && !state.diaryWhole;
    el.innerHTML = `
      <div class="panel diary" id="diary-panel">
        <div class="row-between"><h3>📖 Tagebuch von ${esc(me ? me.name : '')}</h3>
          <div class="btns">${split ? '' : micBtn('diary')}${ai ? `<button class="btn small" data-act="gen-diary">✨ ${s.diary.text ? 'Neu schreiben' : 'Schreiben lassen'}</button>` : ''}</div></div>
        <p class="muted small">Ich-Form, aus Sicht deines Charakters: Was hast du erlebt, gefühlt, gelernt?</p>
        ${!ai && !s.diary.text ? `<div class="btns"><button class="btn ghost small" data-act="diary-template">📝 Vorlage einfügen (Erlebt / Gefühlt / Gelernt)</button>${s.notes.trim() ? '<button class="btn ghost small" data-act="notes-to-diary">📋 Meine Notizen übernehmen</button>' : ''}</div>` : ''}
        ${secs.length > 1 ? `<div class="row-between"><span class="muted small">${secs.length} Abschnitte · ${words(s.diary.text)} Wörter</span>
          <div class="btns">${split ? allToggle('diary-panel') : ''}<button class="btn ghost small" data-act="diary-view">${split ? '📄 Als Ganzes bearbeiten' : '🗂 In Abschnitten anzeigen'}</button></div></div>` : ''}
        ${split
        ? `<div class="dsecs">${secs.map((x, i) => sub(`dsec-${i}`, esc(x.title || (i === 0 ? 'Einleitung' : 'Abschnitt ' + (i + 1))), `${words(x.body)} Wörter`,
            `${x.title ? `<input class="dsec-title" data-dsec="${i}" data-k="title" value="${esc(x.title)}">` : ''}<textarea class="paper" data-dsec="${i}" data-k="body" rows="${Math.min(14, Math.max(3, Math.ceil(x.body.length / 70)))}">${esc(x.body)}</textarea>`, i === 0)).join('')}</div>`
        : `<textarea id="diary" class="paper" data-diary rows="14" placeholder="Liebes Tagebuch, …">${esc(s.diary.text)}</textarea>
           <div class="muted small right">${words(s.diary.text)} Wörter</div>`}
        ${ai && s.diary.text ? sub('d-refine', '✨ Überarbeiten lassen', 'kürzer, emotionaler, eigene Anweisung …', `<div class="refine">
          <div class="chips">${['Kürzer', 'Emotionaler', 'Mehr Gelerntes betonen', 'Mehr im Ton meines Charakters', 'Rechtschreibung korrigieren'].map(x => `<button class="chip" data-refine="${esc(x)}">${esc(x)}</button>`).join('')}</div>
          <div class="row"><input id="refine-own" placeholder="Eigene Anweisung, z. B. „Erwähne meine Angst vor Wasser“"><button class="btn small" data-act="refine-own">Überarbeiten</button></div>
        </div>`) : ''}
        ${imgSection(s, 'diary')}
      </div>`;
  }

  // Ohne KI: Gerüst zum Selbstschreiben, passend zum eingestellten Format
  function diaryTemplate(s) {
    const date = s.ingameDate ? s.ingameDate + '\n\n' : '';
    return D().settings.diaryFormat === 'fliesstext'
      ? `${date}Heute …\n\nDabei habe ich mich … gefühlt, weil …\n\nGelernt habe ich, dass …`
      : `${date}Erlebt\n…\n\nGefühlt\n…\n\nGelernt\n…`;
  }

  /* ---------- KI-Bild zum Tagebuch / Bericht (je eins) ---------- */
  const imgHolder = (s, kind) => kind === 'diary' ? s.diary : (opById(s, kind) || {});
  const imgStyle = h => Reports.IMG_STYLES[h.imageStyle] ? h.imageStyle : 'anime';
  const imgTopic = (s, kind) => { s.imageTopics = s.imageTopics || {}; return (s.imageTopics[kind] = s.imageTopics[kind] || {}); };

  function imgSection(s, kind) {
    const h = imgHolder(s, kind), style = imgStyle(h), topic = imgTopic(s, kind), ai = AI.available();
    const hasText = kind === 'diary' ? !!(s.diary.text || '').trim() : Reports.opHasContent(opById(s, kind));
    const scenes = (s.analysis && s.analysis.scenes) || [];
    const refs = Reports.imageRefs(s, kind);
    const canPrompt = hasText && (ai || (topic.text || '').trim() || topic.scene != null);
    return sub(`img-${kind}`, `🎨 Bild zum ${kind === 'diary' ? 'Eintrag' : 'Bericht'}`, h.imageId ? '✓ Bild vorhanden' : 'noch kein Bild', `<div class="report-img">
      ${h.imageId ? `<img data-img="${esc(h.imageId)}" alt="Bild">
        <div class="btns"><button class="btn small" data-img-share="${kind}">Teilen</button><button class="btn ghost small" data-img-dl="${kind}">Speichern</button><button class="btn ghost small danger" data-img-del="${kind}">Entfernen</button></div>` : ''}
      <div class="img-topic">
        <span class="muted small">Worüber soll das Bild sein?</span>
        ${scenes.length ? `<div class="chips">
          ${ai ? `<button class="chip ${topic.scene == null ? 'on' : ''}" data-img-scene="${kind}:">🎲 KI wählt</button>` : ''}
          ${scenes.map((x, i) => `<button class="chip ${topic.scene === i ? 'on' : ''}" data-img-scene="${kind}:${i}">${esc(x.title || 'Szene ' + (i + 1))}</button>`).join('')}</div>` : ''}
        <div class="qa-a"><textarea id="imgt-${kind}" data-img-topic="${kind}" rows="2" placeholder="Optional selbst beschreiben, z. B. „Keijiro hält stolz seine zwei neuen Schwerter vor der Schmiede hoch“">${esc(topic.text || '')}</textarea>${micBtn('imgt-' + kind)}</div>
      </div>
      <div class="chips">${Object.entries(Reports.IMG_STYLES).map(([k, v]) => `<button class="chip ${style === k ? 'on' : ''}" data-img-style="${kind}:${k}">${v.label}</button>`).join('')}</div>
      <p class="muted small">${refs.length ? `🖼 Vorlage für die Figuren: Porträts von ${esc(refs.map(r => r.name).join(', '))}` : '💡 Tipp: Mit Porträts und „Aussehen“ im Verzeichnis sehen die Figuren auf jedem Bild gleich aus.'}</p>
      <div class="btns">
        <button class="btn small" data-img-prompt="${kind}" ${canPrompt ? '' : 'disabled'}>📋 Bild-Beschreibung erstellen</button>
        ${ai ? `<button class="btn ghost small" data-img-gen="${kind}" ${hasText ? '' : 'disabled'}>🎨 Direkt erstellen (Gemini, kostenpflichtig)</button>` : ''}
        <label class="btn ghost small">📤 ${h.imageId ? 'Anderes Bild' : 'Bild hochladen'}<input type="file" accept="image/*" data-img-up="${kind}" hidden></label>
      </div>
      ${h.imagePrompt && state.showPrompt === kind ? `<div class="note prompt-box">
        <p><strong>Beschreibung ist kopiert.</strong> ${refs.length ? 'Teile zuerst die Porträts in die App (damit die Figuren stimmen), dann ' : ''}in <strong>ChatGPT</strong> oder <strong>Gemini</strong> einfügen und absenden. Das Bild speichern und hier über <strong>📤 Bild hochladen</strong> hinterlegen.</p>
        <pre class="out">${esc(h.imagePrompt)}</pre>
        <div class="btns">
          <a class="btn small" href="https://chatgpt.com/" target="_blank" rel="noopener" data-img-open="${kind}">ChatGPT öffnen</a>
          <a class="btn small" href="https://gemini.google.com/app" target="_blank" rel="noopener" data-img-open="${kind}">Gemini öffnen</a>
          ${refs.length ? `<button class="btn ghost small" data-img-refs="${kind}">🖼 Porträts teilen (${refs.length})</button>` : ''}
          <button class="btn ghost small" data-img-copy="${kind}">Nochmal kopieren</button></div></div>` : ''}
      <p class="muted small">${!hasText ? 'Erst den Text schreiben (lassen), dann das Bild.' : !ai ? 'Ohne KI: Wähle eine Szene oder beschreibe das Motiv – Zenkai baut daraus die Beschreibung mit den Daten deiner Figuren.' : 'Kostenlos über ChatGPT oder Gemini (mit deinem Konto). „Direkt erstellen“ braucht bei Google eine hinterlegte Abrechnung (ca. 4 Cent/Bild).'}</p>
    </div>`, !!h.imageId || state.showPrompt === kind);
  }

  // Bildbeschreibung erstellen, kopieren und anzeigen (mit KI; ohne KI aus Vorlage)
  async function imagePromptFor(s, kind) {
    const h = imgHolder(s, kind), style = imgStyle(h);
    h.imagePrompt = AI.available() ? (await AI.complete(Reports.imagePrompt(s, kind, style))).trim() : Reports.localImagePrompt(s, kind, style);
    h.imagePromptStyle = style; Store.save();
    return h.imagePrompt;
  }
  const promptForChat = (s, kind) => {
    const n = Reports.imageRefs(s, kind).length;
    return `Erstelle ein Bild${n ? ` (die ${n} angehängten Porträts sind die Vorlage für die Figuren)` : ''}: ${imgHolder(s, kind).imagePrompt}`;
  };
  async function showPromptForChatGPT(s, kind) {
    await imagePromptFor(s, kind);
    copy(promptForChat(s, kind));
    state.showPrompt = kind; render();
  }
  async function shareRefs(s, kind) {
    const files = [];
    for (const r of Reports.imageRefs(s, kind)) {
      const b = await Images.blobOf(r.imageId);
      if (b) files.push(new File([b], `${r.name.replace(/[^\wäöüß-]+/gi, '_')}.jpg`, { type: b.type || 'image/jpeg' }));
    }
    if (!files.length) throw new Error('Keine Porträts gefunden.');
    if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files, title: 'Porträts' }); } catch (e) { } }
    else files.forEach(f => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); });
  }
  async function setOwnImage(s, kind, file) {
    const h = imgHolder(s, kind);
    const small = await Images.resize(file, 1600, false);
    const id = await Images.save(small);
    const old = h.imageId; h.imageId = id; Store.save();
    if (old) Images.remove(old);
    state.showPrompt = null; render(); toast('Bild gespeichert ✓');
  }

  async function generateReportImage(s, kind) {
    const h = imgHolder(s, kind);
    const prompt = await imagePromptFor(s, kind);
    const refs = [];
    for (const r of Reports.imageRefs(s, kind)) { const b = await Images.blobOf(r.imageId); if (b) refs.push({ name: r.name, blob: b }); }
    let raw;
    try { raw = await AI.generateImage(prompt, refs); }
    catch (e) {
      // Kein Bild-Kontingent → Beschreibung für ChatGPT/Gemini anbieten, damit es trotzdem kostenlos geht
      if (/Kontingent|quota|nur mit Gemini/i.test(e.message)) { copy(promptForChat(s, kind)); state.showPrompt = kind; render(); }
      throw e;
    }
    const small = await Images.resize(raw, 1280, false);
    const id = await Images.save(small);
    const old = h.imageId;
    h.imageId = id;
    Store.save(); state.showPrompt = null;
    if (old) Images.remove(old);
    render(); toast('Bild erstellt ✓');
  }

  async function imageFile(s, kind) {
    const b = await Images.blobOf(imgHolder(s, kind).imageId);
    if (!b) throw new Error('Bild nicht gefunden.');
    const name = `${(s.title || 'zenkai').replace(/[^\wäöüß-]+/gi, '_')}_${kind === 'diary' ? 'tagebuch' : (opById(s, kind) || {}).type || 'bericht'}.jpg`;
    return new File([b], name, { type: b.type || 'image/jpeg' });
  }

  /* ---------- Tab „Einsätze“: ein Bericht pro Einsatz, Vorlage je nach Art ---------- */
  function opForm(s, op) {
    const t = Reports.opType(op), id = op.id, ai = AI.available();
    const field = f => f.type === 'select'
      ? `<label>${esc(f.label)}<select data-op="${id}" data-e="${f.key}">${opts(f.options, op[f.key], '–')}</select></label>`
      : `<label>${esc(f.label)}<input data-op="${id}" data-e="${f.key}" value="${esc(op[f.key])}" placeholder="${esc(f.ph || '')}"></label>`;
    const status = v => (v || '').trim() ? `✓ ${words(v)} Wörter` : 'leer';
    const area = f => sub(`op-${id}-${f.key}`, esc(f.label), f.key === 'bewertung' ? [op.ergebnis, (op.bewertung || '').trim() && words(op.bewertung) + ' Wörter'].filter(Boolean).join(' · ') || 'offen' : status(op[f.key]),
      `${f.key === 'bewertung' ? `<select data-op="${id}" data-e="ergebnis">${opts(Reports.RESULT, op.ergebnis, '– Ergebnis wählen –')}</select>` : ''}<div class="row-between"><span class="muted small">${esc(f.hint)}</span>${micBtn(`e-${id}-${f.key}`)}</div>
      <textarea id="e-${id}-${f.key}" data-op="${id}" data-e="${f.key}" rows="${f.key === 'verlauf' ? 7 : 4}" placeholder="${esc(f.hint)}">${esc(op[f.key])}</textarea>`);
    const finds = op.finds || [];
    const findsSub = t.finds ? sub(`op-${id}-finds`, 'Funde & Artefakte', finds.length ? `✓ ${finds.length} Fund(e)` : 'keine', `<div class="row-between"><span></span><button class="btn ghost small" data-act="add-find" data-op="${id}">＋ Fund</button></div>
      ${finds.length ? finds.map((f, i) => `<div class="find">
        <div class="find-head"><strong>F-${String(i + 1).padStart(2, '0')}</strong><button class="btn ghost small danger" data-del-find="${i}" data-op="${id}">✕</button></div>
        <div class="grid2">${Reports.FIND_COLS.map(c => `<label>${c.label}<input data-op="${id}" data-find="${i}" data-k="${c.key}" value="${esc(f[c.key])}"></label>`).join('')}</div></div>`).join('')
      : '<p class="muted small">Noch keine Funde eingetragen.</p>'}`) : '';
    const headFilled = t.head.filter(f => op[f.key]).length;
    return `<div class="op-tools row-between">
        <div class="row"><select data-op-type="${id}">${typeOptions(op.type)}</select><input data-op-field="${id}" data-k="title" value="${esc(op.title || '')}" placeholder="Titel des Einsatzes"></div>
        <div class="btns">${ai ? `<button class="btn small" data-op-gen="${id}">✨ ${Reports.opHasContent(op) ? 'Neu schreiben' : 'Bericht schreiben lassen'}</button>` : ''}
          <button class="btn ghost small danger" data-op-del="${id}">Löschen</button></div></div>
      ${sub(`op-${id}-head`, '🗂 Kopfdaten', `${headFilled}/${t.head.length} ausgefüllt`, `<div class="grid2">${t.head.map(field).join('')}</div>
        ${t.sections.some(f => f.key === 'teilnehmer') ? `<div class="row-between"><span></span><button class="btn ghost small" data-act="fill-team" data-op="${id}">Teilnehmer aus Session übernehmen</button></div>` : ''}`)}
      ${t.sections.map(f => area(f) + (t.finds && f.key === t.findsAfter ? findsSub : '')).join('')}
      ${imgSection(s, id)}`;
  }

  function tabOps(s, el) {
    const ops = opsOf(s);
    el.innerHTML = `
      <div class="panel report" id="ops-panel">
        <div class="row-between"><h3>📜 Einsätze & Berichte</h3><div class="btns">${ops.length ? allToggle('ops-panel') : ''}</div></div>
        <p class="muted small">Jeder Einsatz im Monat (Mission, Expedition, Ausgrabung, Kampf, Training, Eskorte) bekommt einen eigenen Bericht nach passender Vorlage.</p>
        ${ops.map(op => sub(`op-${op.id}`, esc(opLabel(op)), Reports.opHasContent(op) ? `✓ ${Reports.opType(op).report}` : 'noch leer', opForm(s, op), ops.length === 1)).join('')}
        ${!ops.length ? '<div class="empty">Noch keine Einsätze. Zenkai erkennt sie bei der Analyse im Schritt „Erzählen“ – oder füge sie hier hinzu.</div>' : ''}
        <div class="row" style="margin-top:12px"><select id="op-new-type">${typeOptions('mission')}</select><button class="btn ghost small" data-act="op-add">＋ Einsatz hinzufügen</button></div>
      </div>`;
  }

  function tabExport(s, el) {
    const block = (id, title, text) => `<div class="panel"><div class="row-between"><h3>${title}</h3>
      <div class="btns"><button class="btn small" data-copy="${id}">📋 Kopieren</button><button class="btn ghost small" data-share="${id}">Teilen</button><button class="btn ghost small" data-dl="${id}">.txt</button></div></div>
      <pre class="out" id="out-${id}">${esc(text)}</pre></div>`;
    el.innerHTML = `<div class="cta"><button class="btn primary" data-act="session-pdf">📚 Diese Session als PDF / im Buch ansehen</button></div>` +
      block('diary', '📖 Tagebuch', Reports.diaryText(s)) +
      opsOf(s).filter(Reports.opHasContent).map(op => block(op.id, `📜 ${esc(Reports.opType(op).report)}${op.title ? ' – ' + esc(op.title) : ''}`, Reports.opText(s, op))).join('');
  }

  /* ---------- Missionen: eigenständige Missionsberichte nach Vorlage des Missionsbüros ---------- */
  const missions = () => (D().missions = D().missions || []);
  const mHasReport = m => Reports.MB_SECTIONS.some(f => (m[f.key] || '').trim());

  function viewMissions() {
    const m = state.missionId && Store.mission(state.missionId);
    if (m) return missionEditor(m);
    const list = [...missions()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    app.innerHTML = `
      <div class="head"><h1>🗡️ Missionen</h1><button class="btn primary" data-act="new-mission">＋ Missionsbericht</button></div>
      <p class="muted small">Missionsberichte im Format des Missionsbüros. Screenshot der Teilnehmerliste hochladen, kurz notieren, was passiert ist – Zenkai füllt die Vorlage aus.</p>
      ${list.length ? `<div class="cards">${list.map(x => {
        const leaders = (x.members || []).filter(y => y.leader).map(y => y.name);
        return `<button class="card" data-mopen="${x.id}">
          <div class="card-top"><strong>${esc(x.title || (x.team ? 'Team „' + x.team + '“' : 'Mission'))}</strong><span class="muted">${fmtDate(x.date)}</span></div>
          <div class="muted small">${x.rank ? 'Rang ' + esc(x.rank) + ' · ' : ''}${(x.members || []).length} Teilnehmer${leaders.length ? ' · Truppführer: ' + esc(leaders.join(', ')) : ''}</div>
          <div class="badges"><span class="badge ${mHasReport(x) ? 'ok' : ''}">📜 Bericht</span>${(x.screenshots || []).length ? `<span class="badge">📷 ${x.screenshots.length}</span>` : ''}</div></button>`;
      }).join('')}</div>` : '<div class="empty">Noch keine Missionsberichte. Starte mit „＋ Missionsbericht“.</div>'}`;
  }

  function newMission() {
    const m = { id: Store.uid(), createdAt: Date.now(), date: today(), myCharId: (D().myChars[0] || {}).id || '', title: '', team: '', rank: '',
      members: [], screenshots: [], notes: '', screenInfo: '', ziel: '', beobachtungen: '', auffaelligkeiten: '', ergebnis: '', verluste: '' };
    // eigenen Charakter gleich als Mitglied eintragen
    const me = Store.myChar(m.myCharId);
    if (me) m.members.push({ id: Store.uid(), name: me.name, personId: 'me', self: true, leader: false });
    missions().push(m); Store.save();
    state.missionId = m.id; render(); window.scrollTo(0, 0);
  }

  // Name einer Person im Verzeichnis zuordnen (exakt, sonst ähnliche Schreibweise als Vorschlag)
  function matchMember(x, m) {
    const me = Store.myChar(m.myCharId);
    if (x.self && me) { x.personId = 'me'; x.name = me.name; return x; }
    const p = findPerson(x.name);
    if (p) { x.personId = p.id; x.name = p.name; delete x.maybe; }
    else { const sim = similarPerson(x.name); if (sim) x.maybe = sim.id; }
    return x;
  }

  function missionEditor(m) {
    const ai = AI.available();
    const leaders = (m.members || []).filter(x => x.leader).length;
    const memberRow = x => {
      const p = x.personId && x.personId !== 'me' && Store.person(x.personId), maybe = !x.personId && x.maybe && Store.person(x.maybe);
      return `<div class="mm-row ${x.leader ? 'lead' : ''}">
        <input data-mm-name="${x.id}" value="${esc(x.name)}" placeholder="Name">
        <button class="chip ${x.leader ? 'on' : ''}" data-mm-lead="${x.id}" title="Als Truppführer markieren">⭐ Truppführer</button>
        <button class="btn ghost small" data-mm-del="${x.id}" title="Entfernen">✕</button>
        <div class="mm-info small">${x.self ? '<span class="badge ok">du</span>' : p ? `<span class="muted">✓ im Verzeichnis${p.rank ? ' · ' + esc(p.rank) : ''}</span>`
          : maybe ? `❓ Gemeint: <strong>${esc(maybe.name)}</strong>? <button class="btn small" data-mm-link="${x.id}">Ja, zuordnen</button> <button class="btn ghost small" data-mm-add="${x.id}">Neue Person</button>`
          : x.name ? `<span class="muted">nicht im Verzeichnis</span> <button class="btn ghost small" data-mm-add="${x.id}">＋ ins Verzeichnis</button>` : ''}</div>
      </div>`;
    };
    app.innerHTML = `
      <div class="head"><button class="btn ghost" data-act="mission-back">← Missionen</button><button class="btn ghost danger small" data-act="mission-del">Löschen</button></div>
      <div class="grid2 meta">
        <label class="wide">Titel (optional)<input data-m="title" value="${esc(m.title)}" placeholder="z. B. Kräuter für die Heilerin"></label>
        <label>Team / Einheit<input data-m="team" value="${esc(m.team)}" placeholder="z. B. Missionseinheit"></label>
        <label>Missionsrang<select data-m="rank">${opts(['D', 'C', 'B', 'A', 'S'], m.rank, '–')}</select></label>
        <label>Datum<input type="date" data-m="date" value="${esc(m.date)}"></label>
        <label>Verfasser<select data-m="myCharId">${D().myChars.map(c => `<option value="${c.id}" ${c.id === m.myCharId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="panel" id="mission-panel">
        ${sub('m-shots', '📷 Screenshots', (m.screenshots || []).length ? `${m.screenshots.length} Bild(er)` : 'z. B. Teilnehmerliste', `
          <div class="shots">${(m.screenshots || []).map(id => `<div class="shot"><img data-img="${esc(id)}" alt=""><button class="btn ghost small" data-mshot-del="${esc(id)}">✕</button></div>`).join('')}</div>
          <div class="btns"><label class="btn small">📤 Screenshots hochladen<input type="file" accept="image/*" multiple data-mshots="1" hidden></label>
            ${ai && (m.screenshots || []).length ? '<button class="btn primary small" data-act="mission-read">👥 Mitglieder & Infos auslesen</button>' : ''}</div>
          ${m.screenInfo ? `<label>Aus den Screenshots erkannt<textarea data-m="screenInfo" rows="2">${esc(m.screenInfo)}</textarea></label>` : ''}
          ${!ai ? '<p class="muted small">Zum automatischen Auslesen eine KI verbinden – sonst Mitglieder unten von Hand eintragen.</p>' : ''}`, true)}
        ${sub('m-members', '👥 Truppführer & Mitglieder', `${(m.members || []).length} · ${leaders ? leaders + ' Truppführer' : 'kein Truppführer markiert'}`, `
          <p class="muted small">Truppführer mit ⭐ markieren – sie stehen im Bericht gesondert.</p>
          ${(m.members || []).map(memberRow).join('')}
          <div class="row"><input id="mm-new" list="dl-mm" placeholder="Person hinzufügen …">${dl('dl-mm', D().people.map(p => p.name))}<button class="btn ghost small" data-act="mm-add-manual">＋</button></div>`, true)}
        ${sub('m-notes', '📝 Was ist passiert?', (m.notes || '').trim() ? `${words(m.notes)} Wörter` : 'Notizen oder Stichpunkte', `
          <div class="row-between"><span class="muted small">Erzählen oder Stichpunkte: Auftrag, Ablauf, was euch aufgefallen ist, Ergebnis, Verletzte.</span>${micBtn('m-notes-ta')}</div>
          <textarea id="m-notes-ta" data-m="notes" rows="6" placeholder="- Auftrag: Banditenlager an der Grenze auskundschaften&#10;- Spuren von Kiri-Ninja gefunden&#10;- Lager verlassen, Karte sichergestellt&#10;- keine Verletzten">${esc(m.notes)}</textarea>`, true)}
        ${ai ? `<div class="cta"><button class="btn primary big" data-act="mission-write" ${(m.notes || '').trim() || m.screenInfo ? '' : 'disabled'}>✨ ${mHasReport(m) ? 'Bericht neu schreiben' : 'Bericht schreiben lassen'}</button></div>` : ''}
        ${sub('m-report', '📜 Bericht (Vorlage Missionsbüro)', mHasReport(m) ? '✓ ausgefüllt' : 'noch leer', `
          ${Reports.MB_SECTIONS.map(f => `<label>${esc(f.label)} <span class="muted small">(eine Zeile pro Punkt)</span><textarea data-m="${f.key}" rows="3" placeholder="${esc(f.hint)}">${esc(m[f.key])}</textarea></label>`).join('')}
          <label>Verluste<input data-m="verluste" value="${esc(m.verluste)}" placeholder="z. B. Keine Verluste"></label>`, mHasReport(m))}
        ${sub('m-preview', '📋 Fertiger Text zum Einfügen', 'Format Missionsbüro', `
          <pre class="out" id="m-out">${esc(Reports.missionText(m))}</pre>
          <div class="btns"><button class="btn small" data-act="mission-copy">📋 Kopieren</button><button class="btn ghost small" data-act="mission-share">Teilen</button></div>`, mHasReport(m))}
      </div>`;
  }

  // onlyIds: nur neu hochgeladene Screenshots auswerten (sonst alle)
  async function readMissionShots(m, onlyIds) {
    const mid = m.id, blobs = [];
    for (const id of onlyIds || m.screenshots || []) { const b = await Images.blobOf(id); if (b) blobs.push(b); }
    if (!blobs.length) throw new Error('Keine Screenshots gefunden.');
    const r = await AI.visionJSON(Reports.screenshotPrompt(), blobs);
    m = Store.mission(mid) || m; // nach der KI-Antwort frisch holen (Sync kann dazwischen gelaufen sein)
    if (r.team && !m.team) m.team = str(r.team);
    if (/^[DCBAS]$/.test(str(r.rank)) && !m.rank) m.rank = str(r.rank);
    if (r.ziel && !m.ziel) m.ziel = str(r.ziel);
    m.screenInfo = [r.ziel && 'Ziel: ' + str(r.ziel), r.other && str(r.other)].filter(Boolean).join(' · ');
    let added = 0, created = 0;
    arr(r.members).forEach(x => {
      const name = str(x && x.name); if (!name) return;
      const mem = matchMember({ id: Store.uid(), name, self: !!x.self, leader: !!x.leader }, m);
      const dup = m.members.find(y => (mem.personId && y.personId === mem.personId) || y.name.toLowerCase() === mem.name.toLowerCase());
      if (dup) { if (mem.leader) dup.leader = true; return; }
      // Unbekannt und keinem ähnlichen Namen zuzuordnen → direkt im Verzeichnis anlegen
      if (!mem.personId && !mem.maybe) {
        const [first, ...rest] = name.split(/\s+/);
        const p = savePerson(null, { firstName: first, lastName: rest.join(' '), notes: `Aus Missionsbericht ${m.title || m.team || ''} (${fmtDate(m.date)})`.replace(/\s+\(/, ' (').trim() });
        mem.personId = p.id; created++;
      }
      m.members.push(mem); added++;
    });
    Store.save(); render();
    const asks = m.members.filter(x => !x.personId && x.maybe).length;
    toast(`${arr(r.members).length} Teilnehmer erkannt · ${added} neu in der Liste${created ? ` · ${created} im Verzeichnis angelegt` : ''}${asks ? ` · ${asks} Rückfrage(n)` : ''}`);
  }

  async function writeMission(m) {
    if (mHasReport(m) && !confirm('Vorhandenen Bericht ersetzen?')) return;
    const r = await AI.completeJSON({ ...Reports.missionPrompt(m), quality: true });
    if (r.team && !m.team) m.team = str(r.team);
    if (!m.members.some(x => x.leader)) arr(r.leaders).map(str).forEach(n => { const x = m.members.find(y => y.name.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(y.name.toLowerCase())); if (x) x.leader = true; });
    Reports.MB_SECTIONS.forEach(f => { m[f.key] = arr(r[f.key]).map(str).filter(Boolean).join('\n'); });
    m.verluste = str(r.verluste) || m.verluste;
    m.updatedAt = Date.now(); Store.save(); render();
    toast('Missionsbericht erstellt – kurz prüfen ✓');
  }

  /* ---------- Buch: alle Einträge als Seiten, als PDF speicherbar ---------- */
  const paras = t => esc((t || '').trim()).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  const fig = (id, cap) => id && state.bookImages !== false ? `<figure class="b-fig"><img data-img="${esc(id)}" alt="">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>` : '';

  function bookSessions() {
    let list = D().sessions.filter(s => (s.diary && s.diary.text) || opsOf(s).some(Reports.opHasContent));
    if (state.bookOnly) list = list.filter(s => s.id === state.bookOnly);
    if (state.bookChar) list = list.filter(s => s.myCharId === state.bookChar);
    return list.sort((a, b) => ((a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0)) * (state.bookOrder === 'desc' ? -1 : 1));
  }

  function bookDiaryPage(s) {
    const me = Store.myChar(s.myCharId);
    const secs = diarySections(s.diary.text);
    const meta = [s.ingameDate, fmtDate(s.date), me && [me.name, Reports.rankOf(s), Reports.ageOf(s) && Reports.ageOf(s) + ' Jahre'].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    return `<section class="page" id="b-${s.id}">
      <header class="b-head"><div class="b-kicker">📖 Tagebuch</div><h2>${esc(s.title || 'Ohne Titel')}</h2><div class="b-meta">${esc(meta)}</div></header>
      ${fig(s.diary.imageId)}
      ${secs.map(x => `${x.title ? `<h3>${esc(x.title)}</h3>` : ''}${paras(x.body)}`).join('')}
    </section>`;
  }

  function bookOpPage(s, op) {
    const t = Reports.opType(op);
    const head = t.head.filter(f => op[f.key]).map(f => `<tr><th>${esc(f.label)}</th><td>${esc(op[f.key])}</td></tr>`).join('');
    const finds = (op.finds || []).filter(x => Reports.FIND_COLS.some(c => x[c.key]));
    const findsHtml = t.finds ? `<h3>Funde & Artefakte</h3>${finds.length ? `<table class="b-table"><tr>${Reports.FIND_COLS.map(c => `<th>${c.label}</th>`).join('')}</tr>${finds.map(x => `<tr>${Reports.FIND_COLS.map(c => `<td>${esc(x[c.key] || '')}</td>`).join('')}</tr>`).join('')}</table>` : '<p>Keine Funde.</p>'}` : '';
    const body = t.sections.map(f => {
      let h = '';
      if (f.key === 'bewertung' && (op.ergebnis || op.bewertung)) h = `<h3>${esc(f.label)}</h3>${op.ergebnis ? `<p><strong>Ergebnis:</strong> ${esc(op.ergebnis)}</p>` : ''}${paras(op.bewertung)}`;
      else if ((op[f.key] || '').trim()) h = `<h3>${esc(f.label)}</h3>${paras(op[f.key])}`;
      return h + (t.finds && f.key === t.findsAfter ? findsHtml : '');
    }).join('');
    const me = Store.myChar(s.myCharId);
    return `<section class="page report-page">
      <header class="b-head"><div class="b-kicker">${t.icon} ${esc(t.report)}</div><h2>${esc(op.title || s.title || t.label)}</h2><div class="b-meta">${esc([s.ingameDate, fmtDate(s.date)].filter(Boolean).join(' · '))}</div></header>
      ${head ? `<table class="b-table b-kv">${head}<tr><th>Verfasser</th><td>${esc(me ? [me.name, Reports.rankOf(s)].filter(Boolean).join(', ') : '')}</td></tr></table>` : ''}
      ${fig(op.imageId)}
      ${body}
      <p class="b-sign">Gez. ${esc(me ? me.name : '')}</p>
    </section>`;
  }

  function viewBook() {
    const list = bookSessions();
    const chars = D().myChars;
    const showD = state.bookDiary !== false, showR = state.bookReports !== false;
    const only = state.bookOnly && Store.session(state.bookOnly);
    const toc = list.map(s => {
      const ops = opsOf(s).filter(Reports.opHasContent);
      return `<li><a href="#b-${s.id}">${esc(s.title || 'Ohne Titel')}</a> <span>${esc([s.ingameDate, fmtDate(s.date)].filter(Boolean).join(' · '))}</span>
        ${showR && ops.length ? `<div class="b-toc-ops">${ops.map(o => esc(Reports.opType(o).icon + ' ' + Reports.opType(o).report + (o.title ? ': ' + o.title : ''))).join(' · ')}</div>` : ''}</li>`;
    }).join('');
    const me = chars.find(c => c.id === state.bookChar) || (chars.length === 1 ? chars[0] : null);
    app.innerHTML = `
      <div class="book-tools no-print">
        <div class="head"><h1>📚 Buch</h1><button class="btn primary" data-act="book-print" ${list.length ? '' : 'disabled'}>🖨 Als PDF speichern</button></div>
        ${only ? `<div class="note row-between"><span>Nur: <strong>${esc(only.title || 'Ohne Titel')}</strong></span><button class="btn ghost small" data-act="book-all">Alle Einträge zeigen</button></div>` : ''}
        <div class="filters book-filters">
          ${chars.length > 1 ? `<select data-f="bookChar"><option value="">Alle Charaktere</option>${chars.map(c => `<option value="${c.id}" ${state.bookChar === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
          <select data-f="bookOrder"><option value="asc" ${state.bookOrder !== 'desc' ? 'selected' : ''}>Älteste zuerst</option><option value="desc" ${state.bookOrder === 'desc' ? 'selected' : ''}>Neueste zuerst</option></select>
          <div class="chips">
            <button class="chip ${showD ? 'on' : ''}" data-book-toggle="bookDiary">📖 Tagebücher</button>
            <button class="chip ${showR ? 'on' : ''}" data-book-toggle="bookReports">📜 Berichte</button>
            <button class="chip ${state.bookImages !== false ? 'on' : ''}" data-book-toggle="bookImages">🖼 Bilder</button>
          </div>
        </div>
        <p class="muted small">Tipp: „Als PDF speichern“ öffnet den Druckdialog – dort als Drucker „Als PDF speichern“ wählen.</p>
      </div>
      ${!list.length ? `<div class="empty">Noch keine geschriebenen Einträge. Sobald ein Tagebuch oder Bericht existiert, erscheint er hier als Seite. <a href="#" data-go="sessions">Zu den Sessions</a></div>` : `
      <div class="book">
        <section class="page cover">
          <div class="b-cover-title">Zenkai</div>
          <div class="b-cover-sub">${esc(me ? me.name : chars.map(c => c.name).join(' · ') || 'Tagebuch & Berichte')}</div>
          <div class="b-meta">${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'} · ${esc([list[0].ingameDate || fmtDate(list[0].date), list.length > 1 ? (list[list.length - 1].ingameDate || fmtDate(list[list.length - 1].date)) : ''].filter(Boolean).join(' – '))}</div>
          <h3>Inhalt</h3><ol class="b-toc">${toc}</ol>
        </section>
        ${list.map(s => (showD && s.diary && s.diary.text ? bookDiaryPage(s) : `<a id="b-${s.id}"></a>`) + (showR ? opsOf(s).filter(Reports.opHasContent).map(op => bookOpPage(s, op)).join('') : '')).join('')}
      </div>`}`;
  }

  /* ---------- Verzeichnis ---------- */
  const BULK_FIELDS = [['village', 'Dorf'], ['rank', 'Rang'], ['division', 'Division'], ['clan', 'Clan'], ['profession', 'Beruf'], ['relation', 'Beziehung']];
  const RELATIONS = ['Verbündet', 'Freund', 'Neutral', 'Rivale', 'Feind'];
  const bulkList = f => ({ village: L().villages, rank: L().ranks, division: L().divisions, profession: professions(), relation: RELATIONS, clan: [...new Set(D().people.map(p => p.clan).filter(Boolean))] }[f] || []);
  const incomplete = p => !p.firstName || !p.lastName;

  function viewPeople() {
    const q = state.q.toLowerCase();
    const list = D().people.filter(p =>
      (!q || [p.name, p.clan, p.notes, p.profession].join(' ').toLowerCase().includes(q)) &&
      (!state.fVillage || p.village === state.fVillage) && (!state.fRank || p.rank === state.fRank) &&
      (!state.fDivision || p.division === state.fDivision) && (!state.fProf || p.profession === state.fProf)
    ).sort(byName);
    const open = list.filter(incomplete), done = list.filter(p => !incomplete(p));
    const sel = state.sel || (state.sel = new Set());
    const bf = state.bulkField || 'village';
    const seen = id => D().sessions.filter(s => (s.participants || []).includes(id));
    const card = p => {
      const ss = seen(p.id), on = state.bulk && sel.has(p.id);
      return `<button class="card person ${state.bulk ? 'selectable' : ''} ${on ? 'selected' : ''}" ${state.bulk ? `data-sel="${p.id}"` : `data-person="${p.id}"`}>
        <div class="card-top"><span class="who">${state.bulk ? `<span class="tick">${on ? '✓' : ''}</span>` : ''}${avatar(p.imageId, p.name)}<strong>${esc(p.name)}</strong>${p.age ? `<span class="muted small">${esc(p.age)} J.</span>` : ''}</span>${p.relation ? `<span class="rel rel-${esc(p.relation)}">${esc(p.relation)}</span>` : ''}</div>
        <div class="tags">${[p.profession ? '⚒ ' + p.profession : '', p.rank, p.village, p.division && p.division !== 'Keine' ? '⚑ ' + p.division : '', p.clan ? 'Clan ' + p.clan : ''].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        ${incomplete(p) ? `<div class="small warn">${!p.firstName ? 'Vorname' : 'Nachname'} fehlt</div>` : ''}
        ${p.notes ? `<div class="muted small clamp">${esc(p.notes)}</div>` : ''}
        <div class="muted small">${ss.length ? `${ss.length}× getroffen · zuletzt ${fmtDate(ss.map(s => s.date).sort().pop())}` : 'noch in keiner Session'}</div></button>`;
    };
    app.innerHTML = `
      <div class="head"><h1>Verzeichnis <span class="muted">(${D().people.length})</span></h1>
        <div class="btns"><button class="btn ${state.bulk ? 'primary' : 'ghost'}" data-act="bulk-toggle">${state.bulk ? 'Fertig' : '☑ Auswählen'}</button>${state.bulk ? '' : '<button class="btn primary" data-act="add-person">＋ Person</button>'}</div></div>
      ${state.bulk ? `<div class="bulk-bar">
        <div class="row-between"><strong>${sel.size} ausgewählt</strong>
          <div class="btns"><button class="btn ghost small" data-act="bulk-all">${list.length && list.every(p => sel.has(p.id)) ? 'Keine' : 'Alle'} (${list.length})</button>
          <button class="btn ghost small" data-act="bulk-open">Unvollständige (${open.length})</button></div></div>
        <div class="bulk-form">
          <select id="bulk-field">${BULK_FIELDS.map(([k, l]) => `<option value="${k}" ${k === bf ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input id="bulk-value" list="dl-bulk" placeholder="${esc((BULK_FIELDS.find(x => x[0] === bf) || [])[1] || '')} wählen oder eintippen (leer = entfernen)">${dl('dl-bulk', bulkList(bf))}
          <button class="btn primary small" data-act="bulk-apply" ${sel.size ? '' : 'disabled'}>Zuweisen</button>
          <button class="btn ghost danger small" data-act="bulk-delete" ${sel.size ? '' : 'disabled'}>Löschen</button>
          <button class="btn ghost small merge-btn" data-act="bulk-merge" ${sel.size >= 2 ? '' : 'disabled'}>🔗 Zusammenführen${sel.size >= 2 ? ` (${sel.size})` : ''}</button>
        </div></div>` : ''}
      <div class="filters">
        <input id="q" placeholder="🔎 Name, Beruf, Clan, Notiz…" value="${esc(state.q)}">
        <select data-f="fVillage">${opts(L().villages, state.fVillage, 'Alle Dörfer')}</select>
        <select data-f="fRank">${opts(L().ranks, state.fRank, 'Alle Ränge')}</select>
        <select data-f="fDivision">${opts(L().divisions, state.fDivision, 'Alle Divisionen')}</select>
        <select data-f="fProf">${opts(professions().filter(x => D().people.some(p => p.profession === x)), state.fProf, 'Alle Berufe')}</select>
      </div>
      ${open.length ? `<div class="section-head warn"><h3>⚠️ Name unvollständig (${open.length})</h3><span class="muted small">Vor- oder Nachname fehlt – zum Nachtragen antippen</span></div>
        <div class="cards">${open.map(card).join('')}</div>` : ''}
      ${done.length ? `${open.length ? `<div class="section-head"><h3>Alle Personen (${done.length})</h3></div>` : ''}<div class="cards">${done.map(card).join('')}</div>` : ''}
      ${!list.length ? '<div class="empty">Keine Personen gefunden.</div>' : ''}`;
  }

  /* Zwei oder mehr Einträge derselben Person zusammenführen */
  const MERGE_FIELDS = ['firstName', 'lastName', 'profession', 'rank', 'village', 'division', 'clan', 'age', 'looks', 'relation', 'imageId'];
  const filled = p => MERGE_FIELDS.filter(f => p[f]).length + (p.notes ? 1 : 0);

  function mergeForm() {
    const ps = D().people.filter(p => state.sel.has(p.id)).sort((a, b) => filled(b) - filled(a));
    const count = id => D().sessions.filter(x => (x.participants || []).includes(id)).length;
    modal(`<h2>🔗 Einträge zusammenführen</h2>
      <p class="muted small">Wähle den Eintrag, der bleiben soll. Leere Felder werden aus den anderen ergänzt, Notizen zusammengefügt, und alle Sessions zeigen danach auf diese Person. Die anderen Einträge werden gelöscht.</p>
      <form id="merge-form" class="form">
        ${ps.map((p, i) => `<label class="merge-opt"><input type="radio" name="main" value="${p.id}" ${i === 0 ? 'checked' : ''}>
          <span class="who">${avatar(p.imageId, p.name)}<span><strong>${esc(p.name)}</strong><br><span class="muted small">${esc([p.profession, p.rank, p.village].filter(Boolean).join(' · ') || 'keine weiteren Angaben')} · ${count(p.id)} Session(s)</span></span></span></label>`).join('')}
        <div class="row-between"><span></span><div class="btns"><button type="button" class="btn ghost" data-act="close">Abbrechen</button><button class="btn primary">Zusammenführen</button></div></div>
      </form>`);
    Images.hydrate($('#modal-box'));
    $('#merge-form').onsubmit = ev => {
      ev.preventDefault();
      const mainId = new FormData(ev.target).get('main');
      const ids = ps.map(p => p.id);
      const name = mergePeople(mainId, ids);
      state.sel.clear(); closeModal(); render();
      toast(`${ids.length} Einträge zu „${name}“ zusammengeführt ✓`);
    };
  }

  function mergePeople(mainId, ids) {
    const main = Store.person(mainId);
    const others = ids.filter(id => id !== mainId).map(Store.person).filter(Boolean);
    others.forEach(o => {
      MERGE_FIELDS.forEach(f => { if (!main[f] && o[f]) main[f] = o[f]; });
      if (o.notes && !(main.notes || '').includes(o.notes)) main.notes = [main.notes, o.notes].filter(Boolean).join('\n');
    });
    others.forEach(o => { if (o.imageId && o.imageId !== main.imageId) Images.remove(o.imageId); });
    main.name = fullName(main);
    D().sessions.forEach(x => { x.participants = [...new Set((x.participants || []).map(pid => ids.includes(pid) ? mainId : pid))]; });
    D().people = D().people.filter(p => p.id === mainId || !ids.includes(p.id));
    Store.save();
    return main.name;
  }

  function bulkApply() {
    const sel = state.sel, field = $('#bulk-field').value, value = str($('#bulk-value').value);
    const label = (BULK_FIELDS.find(x => x[0] === field) || [])[1];
    if (!value && !confirm(`${label} bei ${sel.size} Person(en) entfernen?`)) return;
    D().people.forEach(p => { if (sel.has(p.id)) p[field] = value; });
    Store.save(); toast(`${label} ${value ? '„' + value + '“ zugewiesen' : 'entfernt'} · ${sel.size} Person(en)`);
    sel.clear(); render();
  }

  const avatar = (imageId, name, cls = '') => imageId
    ? `<img class="avatar ${cls}" data-img="${esc(imageId)}" alt="">`
    : `<span class="avatar ${cls} initials">${esc((name || '?').trim().charAt(0).toUpperCase())}</span>`;

  function personForm(p, title, onSave) {
    p = p || {};
    // Bildauswahl: neue Bilder sofort speichern, beim Abbrechen wieder aufräumen
    const img = { id: p.imageId || '', fresh: [] };
    state.onModalClose = () => img.fresh.filter(x => x !== img.id || !img.saved).forEach(x => Images.remove(x));
    modal(`<h2>${title}</h2>
      <form id="pform" class="form">
        <div class="pic-row">
          <div id="pic-prev">${avatar(img.id, p.name, 'big')}</div>
          <div class="btns">
            <label class="btn small">📷 Bild wählen<input type="file" accept="image/*" id="pic-in" hidden></label>
            <button type="button" class="btn ghost small ${img.id ? '' : 'hidden'}" id="pic-del">Entfernen</button>
          </div>
        </div>
        <div class="grid2">
          <label>Vorname<input name="firstName" value="${esc(p.firstName)}" autocomplete="off"></label>
          <label>Nachname<input name="lastName" value="${esc(p.lastName)}" autocomplete="off"></label>
        </div>
        <div class="grid2">
          <label>Beruf / Funktion<input name="profession" list="dl-p" value="${esc(p.profession)}" placeholder="z. B. Schmied"></label>
          <label>Rang<input name="rank" list="dl-r" value="${esc(p.rank)}"></label>
          <label>Dorf<input name="village" list="dl-v" value="${esc(p.village)}"></label>
          <label>Division<input name="division" list="dl-d" value="${esc(p.division)}"></label>
          <label>Clan<input name="clan" value="${esc(p.clan)}"></label>
          <label>Alter<input name="age" inputmode="numeric" value="${esc(p.age)}" placeholder="z. B. 13"></label>
        </div>
        <div class="looks-row">
          <label>Aussehen <span class="muted small">(für KI-Bilder – wird mit Porträt automatisch beschrieben)</span><textarea name="looks" rows="3" placeholder="z. B. lange schwarze Haare, helle Augen, grüne Chunin-Weste, Narbe an der Wange">${esc(p.looks)}</textarea></label>
          ${AI.available() ? `<button type="button" class="btn ghost small ${img.id ? '' : 'hidden'}" id="looks-ai">✨ Aussehen aus Bild beschreiben</button>` : ''}
        </div>
        ${p._mine ? `<label>Persönlichkeit & Sprechweise <span class="muted small">(prägt den Ton im Tagebuch)</span><textarea name="voice" rows="3" placeholder="z. B. neugierig, etwas schüchtern, spricht förmlich, liebt alte Schriftrollen">${esc(p.voice)}</textarea></label>`
        : `<label>Beziehung<select name="relation">${opts(['Verbündet', 'Freund', 'Neutral', 'Rivale', 'Feind'], p.relation, '–')}</select></label>
           <label>Notizen<textarea name="notes" rows="3" placeholder="Jutsu, Eigenheiten, was ihr erlebt habt…">${esc(p.notes)}</textarea></label>`}
        ${dl('dl-r', L().ranks)}${dl('dl-v', L().villages)}${dl('dl-d', L().divisions)}${dl('dl-p', professions())}
        <div class="row-between">${p.id ? '<button type="button" class="btn ghost danger" data-act="del-person">Löschen</button>' : '<span></span>'}
          <div class="btns"><button type="button" class="btn ghost" data-act="close">Abbrechen</button><button class="btn primary">Speichern</button></div></div>
      </form>`);
    const showPic = () => { $('#pic-prev').innerHTML = avatar(img.id, $('#pform [name=firstName]').value || $('#pform [name=lastName]').value, 'big'); $('#pic-del').classList.toggle('hidden', !img.id); Images.hydrate($('#pic-prev')); };
    Images.hydrate($('#pic-prev'));
    // KI beschreibt das Aussehen aus dem Bild (für die Original-Datei, nicht den Zuschnitt – mehr Details wie Kleidung)
    let srcBlob = null;
    const describe = async (btn) => {
      const blob = srcBlob || (img.id && await Images.blobOf(img.id));
      if (!blob) return;
      const ta = $('#pform [name=looks]');
      if (ta.value.trim() && !confirm('Vorhandene Aussehen-Beschreibung durch die neue aus dem Bild ersetzen?')) return;
      const lbl = btn && btn.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> KI schaut sich das Bild an…'; }
      try { ta.value = await AI.describeLooks(blob); toast('Aussehen beschrieben – kurz prüfen ✓'); }
      catch (e) { toast(e.message, 'error'); }
      finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = lbl; } }
    };
    $('#pic-in').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        srcBlob = await Images.resize(f, 1280, false); // ganzes Bild für die Beschreibung
        const blob = await Images.resize(f, 512, true); img.id = await Images.save(blob); img.fresh.push(img.id); showPic();
        const b = $('#looks-ai'); if (b) b.classList.remove('hidden');
        if (AI.available() && !$('#pform [name=looks]').value.trim()) describe(b); // leeres Feld → automatisch ausfüllen
      }
      catch (e) { toast('Bild konnte nicht gelesen werden: ' + e.message, 'error'); }
    };
    if ($('#looks-ai')) $('#looks-ai').onclick = ev => describe(ev.currentTarget);
    $('#pic-del').onclick = () => { img.id = ''; srcBlob = null; showPic(); const b = $('#looks-ai'); if (b) b.classList.add('hidden'); };
    $('#pform').onsubmit = ev => {
      ev.preventDefault();
      const v = Object.fromEntries(new FormData(ev.target));
      v.firstName = str(v.firstName); v.lastName = str(v.lastName); v.profession = str(v.profession);
      if (!v.firstName && !v.lastName) { toast('Bitte mindestens Vor- oder Nachname eintragen', 'error'); return; }
      v.name = fullName(v); v.imageId = img.id;
      if (p.imageId && p.imageId !== img.id) Images.remove(p.imageId); // altes Bild ersetzt/entfernt
      img.saved = true; img.fresh = img.fresh.filter(x => x !== img.id);
      onSave(v); closeModal(); render();
    };
    $(p.firstName || !p.lastName ? '#pform [name=firstName]' : '#pform [name=lastName]').focus();
    $('#modal-box').dataset.pid = p.id || '';
    $('#modal-box').dataset.mine = p._mine ? '1' : '';
  }

  const DEFAULT_PROFESSIONS = ['Shinobi', 'Sensei / Ausbilder', 'Schmied', 'Händler', 'Medic', 'Wirt', 'Bauer', 'Fischer', 'Gelehrter', 'Archäologe', 'Missionsbüro', 'Wache', 'Handwerker', 'Kage-Berater'];
  const professions = () => [...new Set([...D().people.map(p => p.profession).filter(Boolean), ...DEFAULT_PROFESSIONS])];

  function savePerson(existing, v) {
    v = { ...v }; if (v.firstName !== undefined || v.lastName !== undefined) v.name = fullName(v);
    if (existing) Object.assign(existing, v);
    else { const p = { id: Store.uid(), createdAt: Date.now(), ...v }; D().people.push(p); Store.save(); return p; }
    Store.save(); return existing;
  }

  /* ---------- Eigene Charaktere ---------- */
  function viewMyChars() {
    app.innerHTML = `
      <div class="head"><h1>Meine Charaktere</h1><button class="btn primary" data-act="add-mychar">＋ Charakter</button></div>
      <p class="muted">Die Charaktere, die du selbst spielst. Rang und Alter kannst du pro Session anpassen – so stimmen auch ältere Einträge.</p>
      ${D().myChars.length ? `<div class="cards">${D().myChars.map(c => `<button class="card" data-mychar="${c.id}">
        <span class="who">${avatar(c.imageId, c.name, 'mid')}<strong>${esc(c.name)}</strong>${c.age ? `<span class="muted small">${esc(c.age)} Jahre</span>` : ''}</span>
        <div class="tags">${[c.rank, c.village, c.division && c.division !== 'Keine' ? '⚑ ' + c.division : '', c.clan ? 'Clan ' + c.clan : ''].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        ${c.voice ? `<div class="muted small clamp">${esc(c.voice)}</div>` : ''}
        <div class="muted small">${D().sessions.filter(s => s.myCharId === c.id).length} Sessions</div></button>`).join('')}</div>`
        : '<div class="empty">Noch kein Charakter angelegt.</div>'}`;
  }

  /* ---------- Einstellungen ---------- */
  /* Ausklappbare Bereiche; welcher offen ist, merkt sich jedes Gerät */
  const FOLD_KEY = 'zenkai.folds';
  function foldOpen(id, def) {
    try { const m = JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; return id in m ? m[id] : def; } catch (e) { return def; }
  }
  function fold(id, title, hint, body, def = false) {
    return `<details class="panel fold" data-fold="${id}" ${foldOpen(id, def) ? 'open' : ''}>
      <summary><span class="fold-title">${title}</span><span class="fold-hint">${esc(hint || '')}</span></summary>
      <div class="fold-body">${body}</div></details>`;
  }
  document.addEventListener('toggle', ev => {
    const d = ev.target;
    if (!d.dataset || !d.dataset.fold) return;
    try { const m = JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; m[d.dataset.fold] = d.open; localStorage.setItem(FOLD_KEY, JSON.stringify(m)); } catch (e) { }
  }, true);

  function viewSettings() {
    const s = D().settings;
    const key = s.provider === 'gemini' ? s.geminiKey : s.openaiKey;
    const aiHint = s.provider === 'none' ? 'aus' : `${s.provider === 'gemini' ? 'Gemini' : 'ChatGPT'} · ${!key ? 'Schlüssel fehlt' : AI.keyProblem(s.provider, key) ? '⚠ Schlüssel prüfen' : '✓ bereit'}`;
    app.innerHTML = `
      <div class="head"><h1>Einstellungen</h1></div>
      ${fold('ai', '✨ KI-Schreibhilfe', aiHint, `
        <label>Anbieter<select data-set="provider">
          <option value="gemini" ${s.provider === 'gemini' ? 'selected' : ''}>Gemini (Google) – kostenlos</option>
          <option value="openai" ${s.provider === 'openai' ? 'selected' : ''}>ChatGPT (OpenAI-API, kostenpflichtig)</option>
          <option value="none" ${s.provider === 'none' ? 'selected' : ''}>Keine KI</option></select></label>
        <div class="${s.provider === 'openai' ? '' : 'hidden'} grid2">
          <label>OpenAI API-Schlüssel<input type="password" data-set="openaiKey" value="${esc(s.openaiKey)}" placeholder="sk-…" autocomplete="off"><span class="key-warn">${esc(AI.keyProblem('openai', s.openaiKey))}</span></label>
          <label>Modell<input data-set="openaiModel" value="${esc(s.openaiModel)}"></label>
          <label>Transkriptions-Modell<input data-set="openaiSttModel" value="${esc(s.openaiSttModel)}"></label>
          <p class="muted small">Schlüssel erstellen: platform.openai.com → API keys. Kosten pro Bericht: meist unter 1 Cent.</p></div>
        <div class="${s.provider === 'gemini' ? '' : 'hidden'}">
          <ol class="steps">
            <li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> öffnen und mit deinem Google-Konto anmelden</li>
            <li>„API-Schlüssel erstellen“ bzw. „Create API key“ tippen und den Schlüssel kopieren</li>
            <li>Hier einfügen und „Verbindung testen“ tippen</li>
          </ol>
          <div class="grid2">
            <label>Gemini API-Schlüssel<input type="password" data-set="geminiKey" value="${esc(s.geminiKey)}" placeholder="AQ.… oder AIza…" autocomplete="off"><span class="key-warn">${esc(AI.keyProblem('gemini', s.geminiKey))}</span></label>
            <label>Modell<input data-set="geminiModel" value="${esc(s.geminiModel)}" placeholder="auto"></label>
          </div>
          <p class="muted small">„auto“ wählt immer das neueste kostenlose Flash-Modell und weicht bei Bedarf auf ein anderes aus. Kostenlos ohne Kreditkarte; Google darf Eingaben im Gratis-Tarif zur Verbesserung seiner Dienste nutzen.</p></div>
        <button class="btn small" data-act="test-ai">Verbindung testen</button>
        ${Sync.loggedIn() ? `<label class="check"><input type="checkbox" data-set="syncKeys" ${s.syncKeys ? 'checked' : ''}>
          <span>🔄 Schlüssel über den Sync auf meine Geräte übertragen<br><span class="muted small">Dann musst du ihn nur auf einem Gerät einfügen. Er wird per HTTPS übertragen und liegt in deinem Supabase-Speicher, den nur dein Login lesen kann.</span></span></label>` : ''}
        <p class="muted small">🔒 ${s.syncKeys && Sync.loggedIn() ? 'Der Schlüssel wird über deinen Sync an deine Geräte verteilt, aber nie in Sicherungsdateien exportiert.' : 'Der Schlüssel bleibt nur auf diesem Gerät und wird nicht mit in Sicherungen exportiert.'}</p>`, !key)}
      ${fold('style', '✍️ Schreibstil', `${{ szenen: 'Szenen', gegliedert: 'Erlebt/Gefühlt/Gelernt', fliesstext: 'Fließtext' }[s.diaryFormat] || ''} · ${s.diaryLength === 'auto' ? 'Länge automatisch' : s.diaryLength}`, `<div class="grid3">
        <label>Tagebuch-Format<select data-set="diaryFormat">
          <option value="szenen" ${s.diaryFormat === 'szenen' ? 'selected' : ''}>Szenen mit Überschriften (+ Gefühle, Gelerntes)</option>
          <option value="gegliedert" ${s.diaryFormat === 'gegliedert' ? 'selected' : ''}>Erlebt / Gefühlt / Gelernt</option>
          <option value="fliesstext" ${s.diaryFormat === 'fliesstext' ? 'selected' : ''}>Fließtext</option></select></label>
        <label>Länge<select data-set="diaryLength">
          <option value="auto" ${s.diaryLength === 'auto' ? 'selected' : ''}>Automatisch (passend zur Erzählung)</option>
          ${opts(['sehr kurz', 'kurz', 'mittel', 'ausführlich'], s.diaryLength)}</select></label>
        <label class="check" style="grid-column:1/-1"><input type="checkbox" data-set="useStyle" ${s.useStyle !== false ? 'checked' : ''}><span>Stil früherer Einträge übernehmen<br><span class="muted small">Die KI liest deine letzten Tagebücher bzw. den letzten Bericht derselben Art und schreibt im gleichen Ton weiter.</span></span></label>
        <label>KI-Freiheit<select data-set="creativity"><option value="treu" ${s.creativity === 'treu' ? 'selected' : ''}>Streng an Notizen halten</option><option value="ausschmuecken" ${s.creativity === 'ausschmuecken' ? 'selected' : ''}>Stimmung ausschmücken</option></select></label>
      </div>`)}
      ${fold('speech', '🎤 Spracheingabe', s.speechMode === 'ai' ? 'KI-Transkription' : 'Live-Diktat', `
        <label>Modus<select data-set="speechMode">
          <option value="browser" ${s.speechMode === 'browser' ? 'selected' : ''}>Live-Diktat (kostenlos, Chrome/Edge/Android)</option>
          <option value="ai" ${s.speechMode === 'ai' ? 'selected' : ''}>Aufnahme + KI-Transkription (erkennt Namen besser)</option></select></label>
        ${!Speech.supported ? '<p class="muted small">⚠️ Dieser Browser kann kein Live-Diktat – nutze die KI-Transkription.</p>' : ''}`)}
      ${fold('lists', '📋 Auswahllisten', `${L().ranks.length} Ränge · ${L().villages.length} Dörfer · ${L().divisions.length} Divisionen`, `
        <p class="muted small">Ein Eintrag pro Zeile. Passe sie an euer RP an.</p><div class="grid3">
        <label>Ränge<textarea data-list="ranks" rows="8">${esc(L().ranks.join('\n'))}</textarea></label>
        <label>Dörfer<textarea data-list="villages" rows="8">${esc(L().villages.join('\n'))}</textarea></label>
        <label>Divisionen<textarea data-list="divisions" rows="8">${esc(L().divisions.join('\n'))}</textarea></label></div>`)}
      ${syncPanel()}
      ${fold('data', '💾 Daten & Sicherung', '', `
        <p class="muted small">${Sync.loggedIn() ? 'Deine Daten werden automatisch mit deinen anderen Geräten abgeglichen. Eine Sicherungsdatei schadet trotzdem nicht.' : 'Ohne Sync liegen die Daten nur auf diesem Gerät. Mit einer Sicherung kannst du sie manuell auf ein anderes Gerät übertragen.'}</p>
        <div class="btns"><button class="btn" data-act="backup">Sicherung herunterladen</button>
          <label class="btn ghost">Sicherung laden<input type="file" accept=".json,application/json" id="restore" hidden></label>
          <button class="btn ghost danger" data-act="reset">Alles löschen</button></div>`)}`;
  }

  /* ---------- Sync ---------- */
  function syncPanel() {
    const c = Sync.conf();
    if (!Sync.configured() || state.editServer) return fold('sync', '🔄 Sync zwischen PC und Handy', 'nicht eingerichtet', `
        <p class="muted small">Einmal einrichten, danach sind deine Sessions, Berichte und das Verzeichnis automatisch auf allen Geräten gleich.</p>
        <ol class="steps">
          <li>Kostenloses Projekt auf <strong>supabase.com</strong> anlegen (Region: Frankfurt)</li>
          <li>Im Projekt <strong>SQL Editor</strong> öffnen, den Inhalt der Datei <code>supabase.sql</code> einfügen und auf <strong>Run</strong> tippen</li>
          <li>Unter <strong>Project Settings → API</strong> die Project-URL und den Publishable- bzw. anon-Key kopieren und hier eintragen</li>
        </ol>
        <form id="sync-server" class="form">
          <label>Project URL<input name="url" value="${esc(c.url)}" placeholder="https://xxxx.supabase.co" autocomplete="off" required></label>
          <label>Publishable / anon Key<input name="key" value="${esc(c.key)}" placeholder="sb_publishable_… oder eyJ…" autocomplete="off" required></label>
          <div class="btns"><button class="btn primary">Speichern</button>${state.editServer ? '<button type="button" class="btn ghost" data-act="sync-cancel-server">Abbrechen</button>' : ''}</div>
        </form>`, true);
    if (!Sync.loggedIn()) return fold('sync', '🔄 Sync', 'nicht angemeldet', `
        <p class="muted small">Melde dich auf jedem Gerät mit demselben Konto an. Beim ersten Mal: „Konto erstellen“.</p>
        ${Sync.error ? `<div class="note">${esc(Sync.error)}</div>` : ''}
        <form id="sync-login" class="form">
          <label>E-Mail<input name="email" type="email" value="${esc(Sync.email || '')}" autocomplete="username" required></label>
          <label>Passwort<input name="password" type="password" autocomplete="current-password" minlength="6" required></label>
          <div class="btns"><button class="btn primary" data-mode="login">Anmelden</button><button class="btn" data-mode="signup">Konto erstellen</button>
            ${c.fromFile ? '' : '<button type="button" class="btn ghost small" data-act="sync-edit-server">Server ändern</button>'}</div>
        </form>`, true);
    const last = Sync.lastSync ? new Date(Sync.lastSync).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie';
    const st = { ok: '✓ Synchron', syncing: '⟳ Gleiche ab…', offline: '☁ Offline – wird nachgeholt', error: '⚠ Fehler' }[Sync.status] || '';
    return fold('sync', '🔄 Sync', st, `
        <p>Angemeldet als <strong>${esc(Sync.email || '')}</strong></p>
        <p class="muted small">${st} · Letzter Abgleich: ${last}</p>
        ${Sync.status === 'error' ? `<div class="note">${esc(Sync.error)}</div>` : ''}
        <div class="btns"><button class="btn" data-act="sync-now">Jetzt synchronisieren</button><button class="btn ghost" data-act="sync-logout">Abmelden</button></div>`, Sync.status === 'error');
  }

  function updateBadge() {
    const b = $('#sync-badge');
    const map = { off: '', login: 'Sync: anmelden', syncing: 'Sync', ok: '☁ ✓', offline: '☁ offline', error: '⚠ Sync' };
    b.textContent = map[Sync.status] || '';
    b.className = 'sync-badge ' + Sync.status;
    b.title = Sync.error || (Sync.lastSync ? 'Letzter Abgleich: ' + new Date(Sync.lastSync).toLocaleString('de-DE') : 'Sync');
  }
  const typing = () => { const a = document.activeElement; return a && app.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName); };
  Sync.onStatus(() => {
    updateBadge();
    // Abgelaufene Anmeldung → sofort zur Anmeldeseite (außer der Nutzer tippt gerade)
    if (!typing() && (state.view === 'settings' || gated() !== document.body.classList.contains('gated'))) render();
  });
  Sync.onRemoteChange(() => { if (typing()) state.pendingRender = true; else { render(); toast('🔄 Neue Daten vom anderen Gerät'); } });
  document.addEventListener('focusout', () => setTimeout(() => { if (state.pendingRender && !typing()) { state.pendingRender = false; render(); } }, 400));

  document.addEventListener('submit', async ev => {
    const f = ev.target;
    if (f.id === 'gate-form') { ev.preventDefault(); return submitGate(f, ev.submitter || f.querySelector('button')); }
    if (f.id === 'sync-server') {
      ev.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      if (!/^https:\/\/.+/.test(v.url.trim())) return toast('Die URL muss mit https:// beginnen', 'error');
      state.editServer = false; Sync.setServer(v.url, v.key); render();
    }
    if (f.id === 'sync-login') {
      ev.preventDefault();
      const mode = ev.submitter && ev.submitter.dataset.mode;
      const v = Object.fromEntries(new FormData(f));
      await busy(ev.submitter, async () => {
        if (mode === 'signup') {
          const r = await Sync.signup(v.email.trim(), v.password);
          if (r === 'confirm') { toast('Bestätigungs-Mail verschickt – Link öffnen, dann hier anmelden.'); return; }
          toast('Konto erstellt und synchronisiert ✓');
        } else { await Sync.login(v.email.trim(), v.password); toast('Angemeldet und synchronisiert ✓'); }
        render();
      });
    }
  });

  /* ---------- Events ---------- */
  document.addEventListener('click', async ev => {
    const t = ev.target.closest('button, a, [data-go]');
    if (!t) { if (ev.target.id === 'modal') closeModal(); return; }
    const d = t.dataset;
    const s = Store.session(state.sessionId);

    if (t.tagName === 'A' && t.getAttribute('href') === '#') ev.preventDefault();
    if (d.gate) { ev.preventDefault(); state.gate = d.gate; state.gateMsg = ''; return render(); }
    if (gated()) return; // auf der Anmeldeseite sind keine anderen Aktionen möglich
    if (d.go) { ev.preventDefault(); return go(d.go); }
    if (d.view) { if (d.view === 'missions') state.missionId = null; return go(d.view); }
    if (d.open) return go('session', { sessionId: d.open, tab: 'notes', detected: [] });
    // Missionen
    const m = state.view === 'missions' && state.missionId ? Store.mission(state.missionId) : null;
    const mem = id => m && (m.members || []).find(x => x.id === id);
    if (d.mopen) { state.missionId = d.mopen; render(); return window.scrollTo(0, 0); }
    if (d.mshotDel && m) { if (!confirm('Screenshot entfernen?')) return; Images.remove(d.mshotDel); m.screenshots = m.screenshots.filter(x => x !== d.mshotDel); Store.save(); return render(); }
    if (d.mmLead && m) { const x = mem(d.mmLead); if (x) { x.leader = !x.leader; Store.save(); } return render(); }
    if (d.mmDel && m) { m.members = m.members.filter(x => x.id !== d.mmDel); Store.save(); return render(); }
    if (d.mmLink && m) { const x = mem(d.mmLink), p = x && Store.person(x.maybe); if (p) { x.personId = p.id; x.name = p.name; delete x.maybe; Store.save(); toast(`Zugeordnet: ${p.name}`); } return render(); }
    if (d.mmAdd && m) {
      const x = mem(d.mmAdd); if (!x || !x.name.trim()) return;
      const [first, ...rest] = x.name.trim().split(/\s+/);
      const p = savePerson(null, { firstName: first, lastName: rest.join(' '), notes: `Aus Missionsbericht ${m.title || m.team || ''} (${fmtDate(m.date)})`.trim() });
      x.personId = p.id; delete x.maybe; Store.save(); render(); return toast(`${p.name} ins Verzeichnis übernommen`);
    }
    if (d.tab) { state.tab = d.tab; return render(); }
    if (d.mic) return Speech.toggle(t, document.getElementById(d.mic), m => toast(m, 'error'));
    if (d.part) { const i = s.participants.indexOf(d.part); i < 0 ? s.participants.push(d.part) : s.participants.splice(i, 1); Store.save(); t.classList.toggle('on'); return; }
    if (d.sel) { const sel = state.sel; sel.has(d.sel) ? sel.delete(d.sel) : sel.add(d.sel); return render(); }
    if (d.person) { const p = Store.person(d.person); return personForm(p, 'Person bearbeiten', v => savePerson(p, v)); }
    if (d.mychar) { const c = Store.myChar(d.mychar); return personForm({ ...c, _mine: true }, 'Charakter bearbeiten', v => { Object.assign(c, v); Store.save(); }); }
    if (d.detAdd !== undefined) { const p = savePerson(null, state.detected[d.detAdd]); s.participants.push(p.id); state.detected.splice(d.detAdd, 1); Store.save(); render(); return toast(p.name + ' ins Verzeichnis übernommen'); }
    if (d.detSkip !== undefined) { state.detected.splice(d.detSkip, 1); return render(); }
    if (d.detSame !== undefined) { const fx = $('#det-fix-' + d.detSame); return linkDetected(s, +d.detSame, state.detected[d.detSame].maybe, fx ? fx.checked : false); }
    if (d.updApply !== undefined) {
      const u = state.updates[d.updApply], p = Store.person(u.id);
      if (p) { Object.assign(p, u.changes); Store.save(); toast(`${p.name} aktualisiert`); }
      state.updates.splice(d.updApply, 1); return render();
    }
    if (d.updSkip !== undefined) { state.updates.splice(d.updSkip, 1); return render(); }
    if (d.confApply !== undefined || d.confChar !== undefined) {
      const i = d.confApply !== undefined ? d.confApply : d.confChar, c = s.conflicts[i];
      if (c.type === 'title') s.title = c.value; else s[c.type] = c.value;
      if (d.confChar !== undefined) { const me = Store.myChar(s.myCharId); if (me) me[c.type] = c.value; }
      s.conflicts.splice(i, 1); Store.save(); render();
      return toast(d.confChar !== undefined ? 'Session und Charakter angepasst' : 'Für diese Session übernommen');
    }
    if (d.confSkip !== undefined) { s.conflicts.splice(d.confSkip, 1); Store.save(); return render(); }
    if (d.bookToggle) { state[d.bookToggle] = state[d.bookToggle] === false; return render(); }
    if (d.genDiary) { s.genDiary = !wantDiary(s); Store.save(); return render(); }
    if (d.opWant) { const op = opById(s, d.opWant); if (op) { op.wanted = !op.wanted; Store.save(); } return render(); }
    if (d.opDel) {
      const op = opById(s, d.opDel);
      if (op && (!Reports.opHasContent(op) || confirm(`„${opLabel(op)}“ samt Bericht löschen?`))) { if (op.imageId) Images.remove(op.imageId); s.ops = opsOf(s).filter(o => o.id !== op.id); Store.save(); render(); }
      return;
    }
    if (d.opGen) {
      const op = opById(s, d.opGen);
      if (op && Reports.opHasContent(op) && !confirm('Vorhandenen Bericht mit KI-Text überschreiben?')) return;
      return busy(t, async () => { if (!s.analysis || !(s.analysis.scenes || []).length) await analyze(s, true); await genOp(s, opById(s, d.opGen)); render(); toast('Bericht erstellt ✓'); });
    }
    if (d.sceneDel !== undefined) { s.analysis.scenes.splice(d.sceneDel, 1); Store.save(); return render(); }
    if (d.refine) return busy(t, () => refine(s, d.refine));
    if (d.imgStyle) { const [k, st] = d.imgStyle.split(':'); imgHolder(s, k).imageStyle = st; Store.save(); return render(); }
    if (d.imgGen) return busy(t, () => generateReportImage(s, d.imgGen));
    if (d.imgPrompt) return busy(t, () => showPromptForChatGPT(s, d.imgPrompt));
    if (d.imgCopy) return copy(promptForChat(s, d.imgCopy));
    if (d.imgOpen) { copy(promptForChat(s, d.imgOpen)); return; } // Link öffnet sich normal, Beschreibung liegt in der Zwischenablage
    if (d.imgRefs) return shareRefs(s, d.imgRefs).catch(e => toast(e.message, 'error'));
    if (d.imgScene !== undefined) {
      const [k, i] = d.imgScene.split(':'); const tp = imgTopic(s, k);
      tp.scene = i === '' ? null : +i; Store.save(); return render();
    }
    if (d.imgDel) {
      if (!confirm('Bild entfernen?')) return;
      const h = imgHolder(s, d.imgDel); Images.remove(h.imageId); h.imageId = ''; Store.save(); return render();
    }
    if (d.imgDl) return imageFile(s, d.imgDl).then(f => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); }).catch(e => toast(e.message, 'error'));
    if (d.imgShare) return imageFile(s, d.imgShare).then(async f => {
      if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: s.title || 'Zenkai' }); } catch (e) { } }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); }
    }).catch(e => toast(e.message, 'error'));
    if (d.delFind !== undefined) { const op = opById(s, d.op); if (op) { op.finds.splice(d.delFind, 1); Store.save(); } return render(); }
    if (d.copy) return copy($('#out-' + d.copy).textContent);
    if (d.share) return share('Bericht', $('#out-' + d.share).textContent);
    if (d.dl) return download(`${(s.title || 'bericht').replace(/[^\wäöüß-]+/gi, '_')}_${d.dl === 'diary' ? 'tagebuch' : ((opById(s, d.dl) || {}).type || 'bericht')}.txt`, $('#out-' + d.dl).textContent);

    switch (d.act) {
      case 'close': return closeModal();
      case 'new-session': return newSession();
      case 'new-mission': return newMission();
      case 'mission-back': state.missionId = null; return render();
      case 'mission-del':
        if (m && confirm('Diesen Missionsbericht samt Screenshots löschen?')) { (m.screenshots || []).forEach(id => Images.remove(id)); D().missions = missions().filter(x => x.id !== m.id); state.missionId = null; Store.save(); render(); }
        return;
      case 'mission-read': return busy(t, () => readMissionShots(m));
      case 'mission-write': return busy(t, () => writeMission(m));
      case 'mission-copy': return copy(Reports.missionText(m));
      case 'mission-share': return share('Missionsbericht', Reports.missionText(m));
      case 'mm-add-manual': {
        const v = str(($('#mm-new') || {}).value); if (!v || !m) return;
        m.members.push(matchMember({ id: Store.uid(), name: v, leader: false, self: false }, m)); Store.save(); return render();
      }
      case 'del-session':
        if (confirm('Diese Session samt Berichten wirklich löschen?')) { D().sessions = D().sessions.filter(x => x.id !== s.id); Store.save(); go('sessions'); }
        return;
      case 'detect':
        if (AI.available()) return busy(t, () => analyze(s));
        { const n = markKnownPeople(s); Store.save(); render(); return toast(`${n} bekannte Person(en) markiert`); }
      case 'scene-add':
        s.analysis = s.analysis || { scenes: [] }; s.analysis.scenes.push({ title: '', summary: '', people: [], feeling: '' }); Store.save(); render();
        { const ins = document.querySelectorAll('[data-scene][data-k=title]'); if (ins.length) ins[ins.length - 1].focus(); } return;
      case 'add-person': return personForm(null, 'Neue Person', v => savePerson(null, v));
      case 'bulk-toggle': state.bulk = !state.bulk; state.sel = new Set(); return render();
      case 'bulk-all': {
        const vis = [...document.querySelectorAll('[data-sel]')].map(e => e.dataset.sel);
        const all = vis.every(id => state.sel.has(id));
        vis.forEach(id => all ? state.sel.delete(id) : state.sel.add(id)); return render();
      }
      case 'bulk-open': D().people.filter(incomplete).forEach(p => state.sel.add(p.id)); return render();
      case 'bulk-apply': return bulkApply();
      case 'bulk-merge': return mergeForm();
      case 'bulk-delete': {
        const n = state.sel.size;
        if (!confirm(`${n} Person(en) aus dem Verzeichnis löschen? Das kann nicht rückgängig gemacht werden.`)) return;
        D().people.filter(p => state.sel.has(p.id)).forEach(p => Images.remove(p.imageId));
        D().people = D().people.filter(p => !state.sel.has(p.id));
        D().sessions.forEach(x => x.participants = (x.participants || []).filter(pid => !state.sel.has(pid)));
        state.sel.clear(); Store.save(); render(); return toast(`${n} Person(en) gelöscht`);
      }
      case 'add-person-session': return personForm(null, 'Neue Person', v => { const p = savePerson(null, v); s.participants.push(p.id); Store.save(); });
      case 'del-person': {
        const id = $('#modal-box').dataset.pid, mine = $('#modal-box').dataset.mine;
        if (mine) {
          if (D().sessions.some(x => x.myCharId === id)) return toast('Charakter hat noch Sessions – zuerst diese löschen.', 'error');
          if (confirm('Charakter löschen?')) { Images.remove((Store.myChar(id) || {}).imageId); D().myChars = D().myChars.filter(c => c.id !== id); Store.save(); closeModal(); render(); }
        } else if (confirm('Person aus dem Verzeichnis löschen?')) {
          Images.remove((Store.person(id) || {}).imageId);
          D().people = D().people.filter(p => p.id !== id);
          D().sessions.forEach(x => x.participants = x.participants.filter(pid => pid !== id));
          Store.save(); closeModal(); render();
        }
        return;
      }
      case 'add-mychar': return personForm({ _mine: true }, 'Neuer Charakter', v => { D().myChars.push({ id: Store.uid(), ...v }); Store.save(); });
      case 'diary-view': state.diaryWhole = !state.diaryWhole; return render();
      case 'book-print': return busy(t, async () => {
        await Images.hydrate(app); // alle Bilder geladen, bevor gedruckt wird
        await new Promise(r => setTimeout(r, 300));
        window.print();
      });
      case 'book-all': state.bookOnly = null; return render();
      case 'session-pdf': state.bookOnly = s.id; return go('book');
      case 'fold-all': {
        const ds = [...document.querySelectorAll(`#${d.scope} details.sub`)];
        const open = !ds.every(x => x.open);
        ds.forEach(x => { x.open = open; }); return;
      }
      case 'hide-ai-hint': try { localStorage.setItem('zenkai.hideAiHint', '1'); } catch (e) { } return render();
      case 'diary-template': s.diary.text = diaryTemplate(s); Store.save(); render(); { const ta = $('#diary'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.indexOf('…'), ta.value.indexOf('…') + 1); } } return;
      case 'notes-to-diary': s.diary.text = (s.ingameDate ? s.ingameDate + '\n\n' : '') + s.notes.trim(); Store.save(); render(); return toast('Notizen übernommen – jetzt in Ich-Form umschreiben');
      case 'ask': return busy(t, () => analyze(s));
      case 'gen-all': return busy(t, () => generateAll(s));
      case 'gen-diary': return busy(t, async () => {
        if (s.diary.text && !confirm('Vorhandenen Text ersetzen?')) return;
        await genDiary(s); render();
      });
      case 'refine-own': { const v = $('#refine-own').value.trim(); if (v) return busy(t, () => refine(s, v)); return; }
      case 'fill-team': {
        const op = opById(s, d.op); if (!op) return;
        const me = Store.myChar(s.myCharId);
        const rows = [me && { ...me, rank: Reports.rankOf(s) }, ...s.participants.map(Store.person)].filter(Boolean).map(p => [p.name, p.rank, p.village].filter(Boolean).join(' – '));
        op.teilnehmer = rows.join('\n'); Store.save(); return render();
      }
      case 'add-find': { const op = opById(s, d.op); if (op) { op.finds = op.finds || []; op.finds.push({}); Store.save(); } return render(); }
      case 'op-add': {
        const type = ($('#op-new-type') || {}).value || 'mission';
        const op = { id: 'op_' + Store.uid(), type, title: '', geheimhaltung: 'Intern (Division)', finds: [], wanted: true };
        opsOf(s).push(op); Store.save(); render();
        return toast(`${Reports.OP_TYPES[type].label} hinzugefügt`);
      }
      case 'test-ai': return busy(t, async () => toast('✓ ' + await AI.test()));
      case 'backup': return download(`zenkai-sicherung-${today()}.json`, Store.exportJSON(), 'application/json');
      case 'reset':
        if (confirm('Wirklich ALLE Daten löschen? Das kann nicht rückgängig gemacht werden.' + (Sync.loggedIn() ? '\n\nAchtung: Der Sync löscht die Daten dann auch auf deinen anderen Geräten.' : '')) && confirm('Ganz sicher?')) { Store.reset(); go('sessions'); }
        return;
      case 'sync-now': return busy(t, async () => { await Sync.syncNow(); toast('Synchronisiert ✓'); });
      case 'sync-logout':
        if (!confirm('Abmelden?\n\nDeine Daten bleiben in deinem Konto gespeichert und werden von diesem Gerät entfernt. Beim nächsten Anmelden sind sie wieder da.')) return;
        return busy(t, async () => {
          let ok = true;
          try { await Sync.syncNow(); await Images.flush(); } catch (e) { ok = false; }
          const pending = await Images.pendingCount();
          if ((!ok || Sync.status !== 'ok' || pending) && !confirm('Achtung: Es konnte nicht alles hochgeladen werden (keine Verbindung?). Nicht übertragene Änderungen gehen beim Abmelden verloren.\n\nTrotzdem abmelden?')) return;
          await Sync.logout(); Store.clearLocal(); await Images.clearAll();
          state.gate = 'login'; state.gateMsg = 'Du bist abgemeldet.'; go('sessions');
        });
      case 'sync-edit-server': state.editServer = true; return render();
      case 'sync-cancel-server': state.editServer = false; return render();
    }
  });

  async function refine(s, instruction) {
    if (!s.diary.text.trim()) throw new Error('Es gibt noch keinen Text zum Überarbeiten.');
    s.diary.text = await AI.complete(Reports.refinePrompt(s.diary.text, instruction, s));
    Store.save(); render(); toast('Überarbeitet');
  }

  document.addEventListener('input', ev => {
    const el = ev.target, d = el.dataset, s = Store.session(state.sessionId);
    if (state.view === 'missions' && state.missionId && (d.m || d.mmName)) {
      const m = Store.mission(state.missionId); if (!m) return;
      if (d.m) {
        m[d.m] = el.value; Store.saveSoon();
        if (d.m === 'myCharId') return render();
        const out = $('#m-out'); if (out) out.textContent = Reports.missionText(m); // Vorschau live mitführen
        const w = document.querySelector('[data-act=mission-write]'); if (w) w.disabled = !(m.notes || '').trim() && !m.screenInfo;
        return;
      }
      const x = (m.members || []).find(y => y.id === d.mmName);
      if (x) { x.name = el.value; delete x.personId; delete x.maybe; Store.saveSoon(); const out = $('#m-out'); if (out) out.textContent = Reports.missionText(m); }
      return;
    }
    if (d.s !== undefined) { s[d.s] = el.value; Store.saveSoon(); if (d.s === 'myCharId') render(); return; }
    if (d.qa !== undefined) { s.qa[d.qa].a = el.value; return Store.saveSoon(); }
    if (d.scene !== undefined) { s.analysis.scenes[d.scene][d.k] = el.value; return Store.saveSoon(); }
    if (d.dsec !== undefined) { // Tagebuch-Abschnitt bearbeitet → Gesamttext neu zusammensetzen
      const secs = diarySections(s.diary.text);
      if (secs[d.dsec]) { secs[d.dsec][d.k] = d.k === 'title' ? el.value.replace(/\n/g, ' ') : el.value; s.diary.text = diaryJoin(secs); s.diary.updatedAt = Date.now(); Store.saveSoon(); }
      return;
    }
    if (el.id === 'bulk-field') { state.bulkField = el.value; return render(); }
    if (d.imgTopic) {
      imgTopic(s, d.imgTopic).text = el.value; Store.saveSoon();
      const b = document.querySelector(`[data-img-prompt="${d.imgTopic}"]`); // ohne KI erst mit Motiv möglich
      if (b && !AI.available()) b.disabled = !el.value.trim() && imgTopic(s, d.imgTopic).scene == null;
      return;
    }
    if (d.diary !== undefined) { s.diary.text = el.value; s.diary.updatedAt = Date.now(); return Store.saveSoon(); }
    if (d.e) { const op = opById(s, d.op); if (op) { op[d.e] = el.value; Store.saveSoon(); } return; }
    if (d.find !== undefined) { const op = opById(s, d.op); if (op) { op.finds[d.find][d.k] = el.value; Store.saveSoon(); } return; }
    if (d.opField) { const op = opById(s, d.opField); if (op) { op[d.k] = el.value; op.auto = false; Store.saveSoon(); } return; }
    if (d.opType) { const op = opById(s, d.opType); if (op) { op.type = el.value; op.auto = false; Store.save(); render(); } return; }
    if (d.set) {
      const st = D().settings;
      if (el.type === 'checkbox') {
        st[d.set] = el.checked; Store.save();
        if (d.set === 'syncKeys') { toast(el.checked ? 'Schlüssel wird auf deine Geräte übertragen' : 'Schlüssel bleibt ab jetzt nur auf jedem Gerät einzeln'); render(); }
        return;
      }
      if (d.set === 'geminiKey' || d.set === 'openaiKey') {
        const v = el.value.trim(); // Leerzeichen/Zeilenumbrüche aus der Zwischenablage entfernen
        st[d.set] = v;
        const warn = el.parentElement.querySelector('.key-warn') || el.insertAdjacentElement('afterend', Object.assign(document.createElement('span'), { className: 'key-warn' }));
        warn.textContent = AI.keyProblem(d.set === 'geminiKey' ? 'gemini' : 'openai', v);
        return Store.saveSoon();
      }
      st[d.set] = d.set === 'expeditionDivisions' ? el.value.split(',').map(x => x.trim()).filter(Boolean) : el.value;
      Store.saveSoon(); if (d.set === 'provider') render(); return;
    }
    if (d.list) { L()[d.list] = el.value.split('\n').map(x => x.trim()).filter(Boolean); return Store.saveSoon(); }
    if (el.id === 'q') { state.q = el.value; const pos = el.selectionStart; render(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); return; }
    if (d.f) { state[d.f] = el.value; return render(); }
  });

  document.addEventListener('change', ev => {
    if (ev.target.dataset && ev.target.dataset.mshots && ev.target.files.length) {
      const mid = state.missionId, files = [...ev.target.files]; // Dateien sofort sichern
      if (!mid) return;
      toast(`📷 ${files.length} Screenshot(s) werden geladen …`);
      (async () => {
        const ids = [];
        for (const f of files) ids.push(await Images.save(await Images.resize(f, 1800, false)));
        // Bericht FRISCH holen: ein Sync beim Zurückkehren aus der Bildauswahl kann das Objekt ersetzt haben
        const m = Store.mission(mid); if (!m) throw new Error('Bericht nicht gefunden.');
        m.screenshots = [...(m.screenshots || []), ...ids];
        Store.save(); render();
        if (AI.available()) { toast('👥 Teilnehmer werden ausgelesen …'); await readMissionShots(Store.mission(mid), ids); }
        else toast(`${files.length} Screenshot(s) hinzugefügt`);
      })().catch(e => { toast(e.message, 'error'); render(); });
      ev.target.value = '';
      return;
    }
    if (ev.target.dataset && ev.target.dataset.detPick !== undefined && ev.target.value) {
      const i = +ev.target.dataset.detPick, fx = $('#det-fix-' + i);
      return linkDetected(Store.session(state.sessionId), i, ev.target.value, fx ? fx.checked : true);
    }
    if (ev.target.dataset && ev.target.dataset.imgUp && ev.target.files[0]) {
      const s = Store.session(state.sessionId);
      setOwnImage(s, ev.target.dataset.imgUp, ev.target.files[0]).catch(e => toast('Bild konnte nicht gelesen werden: ' + e.message, 'error'));
      return;
    }
    if (ev.target.id !== 'restore' || !ev.target.files[0]) return;
    const r = new FileReader();
    r.onload = () => {
      try { if (confirm('Aktuelle Daten durch die Sicherung ersetzen?')) { Store.importJSON(r.result); toast('Sicherung geladen'); go('sessions'); } }
      catch (e) { toast(e.message, 'error'); }
    };
    r.readAsText(ev.target.files[0]);
  });

  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });
  window.addEventListener('beforeunload', () => Store.save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) Store.save(); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });

  // Start: zuerst Links aus Bestätigungs-/Reset-Mails verarbeiten, dann App oder Anmeldeseite zeigen
  (async () => {
    const r = await Sync.handleRedirect().catch(() => null);
    if (r && r.error) state.gateMsg = r.error;
    if (r && r.type === 'recovery') state.gate = 'newpw';
    restorePlace();
    render();
    updateBadge();
    Sync.init();
    if (r && r.type === 'signup') toast('E-Mail bestätigt – willkommen bei Zenkai ✓');
  })();
})();
