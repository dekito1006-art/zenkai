/* Zenkai – Oberfläche */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = () => Store.data;
  const L = () => D().settings.lists;
  const app = $('#app');

  const state = { view: 'sessions', sessionId: null, tab: 'notes', q: '', fVillage: '', fRank: '', fDivision: '', detected: [] };

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
  // Expeditionsbericht: nur für Divisionen mit Berichtspflicht – und nur, wenn in der Session wirklich eine Expedition war
  const canExpedition = s => { const c = Store.myChar(s.myCharId); return !!c && D().settings.expeditionDivisions.includes(c.division); };
  const needsExpedition = s => canExpedition(s) && s.hasExpedition !== false;
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
    ({ sessions: viewSessions, session: viewSession, people: viewPeople, mychars: viewMyChars, settings: viewSettings }[state.view] || viewSessions)();
    Images.hydrate(app);
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
        const c = Store.myChar(s.myCharId); const exp = needsExpedition(s);
        return `<button class="card" data-open="${s.id}">
          <div class="card-top"><strong>${esc(s.title || 'Ohne Titel')}</strong><span class="muted">${fmtDate(s.date)}</span></div>
          <div class="muted small">${esc(c ? c.name : '–')}${s.ingameDate ? ' · ' + esc(s.ingameDate) : ''} · ${(s.participants || []).length} Personen</div>
          ${s.diary && s.diary.imageId ? `<img class="thumb" data-img="${esc(s.diary.imageId)}" alt="">` : ''}
          <div class="badges">
            <span class="badge ${s.diary && s.diary.text ? 'ok' : ''}">📖 Tagebuch</span>
            ${exp ? `<span class="badge ${s.expedition && s.expedition.verlauf ? 'ok' : ''}">📜 Expedition</span>` : ''}
          </div></button>`;
      }).join('')}</div>` : (D().myChars.length ? '<div class="empty">Noch keine Sessions. Starte mit „Neue Session“.</div>' : '')}`;
  }

  function newSession() {
    if (!D().myChars.length) { go('mychars'); toast('Bitte zuerst einen eigenen Charakter anlegen'); return; }
    const last = [...D().sessions].sort((a, b) => b.createdAt - a.createdAt)[0];
    const s = {
      id: Store.uid(), createdAt: Date.now(), date: today(), title: '', ingameDate: '',
      myCharId: last ? last.myCharId : D().myChars[0].id, notes: '', participants: [],
      diary: { text: '' }, expedition: Reports.emptyExpedition(),
    };
    D().sessions.push(s); Store.save();
    go('session', { sessionId: s.id, tab: 'notes', detected: [] });
  }

  function viewSession() {
    const s = Store.session(state.sessionId);
    if (!s) return go('sessions');
    const exp = needsExpedition(s);
    if (state.tab === 'expedition' && !exp) state.tab = 'notes';
    const tabs = [['notes', '1 · Erzählen'], ['diary', '2 · Tagebuch'], ...(exp ? [['expedition', '3 · Expedition']] : []), ['export', '✓ Export']];
    app.innerHTML = `
      <div class="head"><button class="btn ghost" data-go="sessions">← Zurück</button>
        <button class="btn ghost danger small" data-act="del-session">Löschen</button></div>
      <div class="grid2 meta">
        <label class="wide">Titel<input data-s="title" value="${esc(s.title)}" placeholder="z. B. Die Ruinen von Uzushio"></label>
        <label>Datum (real)<input type="date" data-s="date" value="${esc(s.date)}"></label>
        <label>Ingame-Datum<input data-s="ingameDate" value="${esc(s.ingameDate)}" placeholder="z. B. 12. Tag des Frühlings"></label>
        <label>Gespielter Charakter<select data-s="myCharId">${D().myChars.map(c => `<option value="${c.id}" ${c.id === s.myCharId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label>Rang in dieser Session<input data-s="rank" list="dl-srank" value="${esc(s.rank)}" placeholder="${esc((Store.myChar(s.myCharId) || {}).rank ? (Store.myChar(s.myCharId).rank + ' (vom Charakter)') : 'z. B. Genin')}">${dl('dl-srank', L().ranks)}</label>
        <label>Alter in dieser Session<input data-s="age" inputmode="numeric" value="${esc(s.age)}" placeholder="${esc((Store.myChar(s.myCharId) || {}).age ? (Store.myChar(s.myCharId).age + ' (vom Charakter)') : 'z. B. 13')}"></label>
      </div>
      <nav class="subtabs">${tabs.map(([k, l]) => `<button class="${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
      <section id="tab"></section>`;
    ({ notes: tabNotes, diary: tabDiary, expedition: tabExpedition, export: tabExport })[state.tab](s, $('#tab'));
  }

  function tabNotes(s, el) {
    const canExp = canExpedition(s), exp = needsExpedition(s);
    const ppl = [...D().people].sort(byName);
    const qa = s.qa || [], conflicts = s.conflicts || [];
    const ai = AI.available();
    const scenes = (s.analysis && s.analysis.scenes) || [];
    el.innerHTML = `
      <div class="panel">
        <h3>Erzähl, was in der Session passiert ist</h3>
        <p class="muted small">Einfach drauflosreden – wohin ihr gegangen seid, wen du getroffen hast, warum, was dabei herauskam, wie es dir ging und was du gelernt hast.</p>
        <button class="btn primary big mic" data-mic="notes" type="button">🎤 Erzähl einfach los</button>
        <textarea id="notes" data-s="notes" rows="8" placeholder="…oder hier tippen. z. B.: Wir sind mit Kenji zu den Ruinen bei Uzushio, da war eine versiegelte Kammer…">${esc(s.notes)}</textarea>
        <div class="muted small right">${words(s.notes)} Wörter</div>
      </div>
      ${canExp ? expeditionChoice(s, ai) : ''}
      ${scenes.length ? scenesPanel(s, scenes) : ''}
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
           ${exp ? '<button class="btn ghost" data-tab="expedition">📜 Expeditionsbericht ausfüllen</button>' : ''}
           <p class="muted small">Du arbeitest ohne KI – deine Notizen bleiben hier als Gedächtnisstütze stehen. Optional kann Zenkai die Berichte mit deiner eigenen, kostenlosen KI schreiben: <a href="#" data-go="settings">Einstellungen → KI-Schreibhilfe</a>.</p>`
        : scenes.length
        ? `${canExp ? `<div class="gen-what"><span class="muted small">Was soll erstellt werden?</span><div class="chips">
              ${[['diary', '📖 Nur Tagebuch'], ['report', '📜 Nur Bericht'], ['both', '📖+📜 Beides']].map(([k, l]) => `<button class="chip ${genWhat(s) === k ? 'on' : ''}" data-gen-what="${k}">${l}</button>`).join('')}
            </div></div>` : ''}
           <button class="btn primary big" data-act="gen-all">✨ ${{ diary: 'Tagebuch', report: 'Expeditionsbericht', both: 'Tagebuch + Expeditionsbericht' }[genWhat(s)]} schreiben</button>
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

  function expeditionChoice(s, ai) {
    const v = s.hasExpedition;
    return `<div class="panel exp-choice">
      <div class="row-between"><strong>📜 Gab es in dieser Session eine Expedition?</strong>
        <div class="chips">
          <button class="chip ${v === true ? 'on' : ''}" data-exp-set="yes">Ja</button>
          <button class="chip ${v === false ? 'on' : ''}" data-exp-set="no">Nein</button>
          ${ai ? `<button class="chip ${v == null ? 'on' : ''}" data-exp-set="auto">KI erkennt es</button>` : ''}
        </div></div>
      ${s.expeditionAuto && v != null ? `<p class="muted small">Von Zenkai erkannt: ${v ? 'ja, Expedition – es wird auch ein Expeditionsbericht geschrieben' : 'keine Expedition – es wird nur das Tagebuch geschrieben'}. Stimmt das nicht? Oben ändern.</p>` : ''}
    </div>`;
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
    const canExp = canExpedition(s);
    const r = await AI.completeJSON(Reports.analyzePrompt(s, canExp));
    s.analysis = {
      at: Date.now(),
      scenes: arr(r.scenes).map(x => ({ title: str(x.title), summary: str(x.summary), people: arr(x.people).map(str).filter(Boolean), feeling: str(x.feeling) })).filter(x => x.title || x.summary),
      lessons: arr(r.lessons).map(str).filter(Boolean),
    };
    if (canExp && (s.hasExpedition == null || s.expeditionAuto)) { s.hasExpedition = !!r.expedition; s.expeditionAuto = true; }
    // Widersprüche: Rang/Alter/Titel mit Ein-Tipp-Korrektur, alles andere als Rückfrage
    const conf = arr(r.conflicts).filter(c => c && str(c.text));
    const fixable = conf.filter(c => ['rank', 'age', 'title'].includes(c.type) && str(c.value));
    s.conflicts = fixable.slice(0, 4).map(c => ({ type: c.type, text: str(c.text), value: str(c.value) }));
    const fresh = [...conf.filter(c => !fixable.includes(c)).map(c => ({ q: str(c.text), why: 'Widerspruch in der Erzählung', a: '' })),
      ...arr(r.questions).slice(0, 4).map(x => ({ q: str(x.q || x), why: str(x.why), a: '' }))].filter(x => x.q);
    s.qa = [...(s.qa || []).filter(x => x.a && x.a.trim()), ...fresh];
    // Neue Personen (mit Beruf) als Vorschlag
    const known = new Set(D().people.map(p => p.name.toLowerCase()));
    state.detected = arr(r.newPeople).map(p => ({
      firstName: str(p.firstName), lastName: str(p.lastName), rank: str(p.rank), village: str(p.village), division: str(p.division),
      clan: str(p.clan), profession: str(p.profession), notes: str(p.note),
    })).filter(p => (p.firstName || p.lastName) && !known.has(fullName(p).toLowerCase()));
    state.detected.forEach(p => { p.name = fullName(p); });
    // Bekannte Personen: fehlenden Beruf automatisch eintragen, Abweichungen als Vorschlag
    state.updates = []; state.autoApplied = [];
    arr(r.updates).forEach(u => {
      const p = findPerson(u.name); if (!p) return;
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

  // Was erstellt wird: eigene Wahl der Session, sonst passend zur erkannten Expedition
  function genWhat(s) {
    if (!canExpedition(s)) return 'diary';
    if (s.genWhat) return s.genWhat;
    return s.hasExpedition === true ? 'both' : 'diary';
  }

  async function generateAll(s) {
    if (!AI.available()) throw new Error('Bitte zuerst in den Einstellungen eine KI verbinden.');
    const what = genWhat(s);
    const doDiary = what !== 'report', doExp = what !== 'diary';
    const existing = [doDiary && s.diary.text && 'Tagebuch', doExp && s.expedition.verlauf && 'Expeditionsbericht'].filter(Boolean);
    if (existing.length && !confirm(`Es gibt schon: ${existing.join(' und ')}. Neu schreiben und ersetzen?`)) return;
    if (!s.analysis || !(s.analysis.scenes || []).length) await analyze(s, true); // immer zweistufig: erst Szenen, dann Text
    if (doExp && s.hasExpedition !== true) { s.hasExpedition = true; s.expeditionAuto = false; } // ausdrücklich gewünscht
    await Promise.all([doDiary ? genDiary(s) : null, doExp ? genExpedition(s) : null]);
    state.tab = doDiary ? 'diary' : 'expedition'; render(); window.scrollTo(0, 0);
    toast({ diary: 'Tagebuch erstellt ✓', report: 'Expeditionsbericht erstellt ✓', both: 'Tagebuch + Expeditionsbericht erstellt ✓' }[what]);
  }

  function detectedHtml() {
    const det = state.detected || [], upd = state.updates || [], auto = state.autoApplied || [];
    if (!det.length && !upd.length && !auto.length) return '';
    const facts = p => [p.profession && '⚒ ' + p.profession, p.rank, p.village, p.division].filter(Boolean).join(' · ');
    return `<div class="detected">
      ${auto.length ? `<div class="small">✓ <strong>Automatisch ergänzt:</strong> ${esc(auto.join(', '))}</div>` : ''}
      ${det.length ? `<div class="small"><strong>Neu erkannt:</strong> mit einem Tipp ins Verzeichnis übernehmen</div>` : ''}
      ${det.map((p, i) => `<div class="det-row"><div><strong>${esc(p.name)}</strong>${!p.firstName || !p.lastName ? ' <span class="badge">Name unvollständig</span>' : ''} <span class="muted small">${esc(facts(p))}</span>
        ${p.notes ? `<div class="muted small">${esc(p.notes)}</div>` : ''}</div>
        <div class="btns"><button class="btn small" data-det-add="${i}">Übernehmen</button><button class="btn ghost small" data-det-skip="${i}">✕</button></div></div>`).join('')}
      ${upd.length ? `<div class="small"><strong>Neue Infos zu bekannten Personen:</strong></div>` : ''}
      ${upd.map((u, i) => `<div class="det-row"><div><strong>${esc(u.name)}</strong> <span class="muted small">${esc(Object.entries(u.changes).map(([k, v]) => (k === 'profession' ? 'Beruf' : 'Rang') + ' → ' + v).join(', '))}</span>
        ${u.note ? `<div class="muted small">${esc(u.note)}</div>` : ''}</div>
        <div class="btns"><button class="btn small" data-upd-apply="${i}">Übernehmen</button><button class="btn ghost small" data-upd-skip="${i}">✕</button></div></div>`).join('')}
    </div>`;
  }

  async function genDiary(s) {
    if (!s.notes.trim()) throw new Error('Bitte zuerst Notizen eintragen.');
    s.diary.text = (await AI.complete(Reports.diaryPrompt(s))).replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
    s.diary.updatedAt = Date.now(); Store.save();
  }
  async function genExpedition(s) {
    if (!s.notes.trim()) throw new Error('Bitte zuerst Notizen eintragen.');
    const r = await AI.completeJSON(Reports.expeditionPrompt(s));
    const e = s.expedition;
    [...Reports.EXP_HEAD, ...Reports.EXP_SECTIONS].forEach(f => { if (r[f.key]) e[f.key] = String(r[f.key]); });
    if (r.ergebnis) e.ergebnis = r.ergebnis;
    if (Array.isArray(r.finds) && r.finds.length) e.finds = r.finds.map(f => ({ ...f }));
    if (!e.leitung) e.leitung = (Store.myChar(s.myCharId) || {}).name || '';
    Store.save();
  }

  function tabDiary(s, el) {
    const me = Store.myChar(s.myCharId);
    const ai = AI.available();
    el.innerHTML = `
      <div class="panel diary">
        <div class="row-between"><h3>📖 Tagebuch von ${esc(me ? me.name : '')}</h3>
          <div class="btns">${micBtn('diary')}${ai ? `<button class="btn small" data-act="gen-diary">✨ ${s.diary.text ? 'Neu schreiben' : 'Schreiben lassen'}</button>` : ''}</div></div>
        <p class="muted small">Ich-Form, aus Sicht deines Charakters: Was hast du erlebt, gefühlt, gelernt?</p>
        ${!ai && !s.diary.text ? `<div class="btns"><button class="btn ghost small" data-act="diary-template">📝 Vorlage einfügen (Erlebt / Gefühlt / Gelernt)</button>${s.notes.trim() ? '<button class="btn ghost small" data-act="notes-to-diary">📋 Meine Notizen übernehmen</button>' : ''}</div>` : ''}
        <textarea id="diary" class="paper" data-diary rows="14" placeholder="Liebes Tagebuch, …">${esc(s.diary.text)}</textarea>
        <div class="muted small right">${words(s.diary.text)} Wörter</div>
        ${ai ? `<div class="refine">
          <div class="chips">${['Kürzer', 'Emotionaler', 'Mehr Gelerntes betonen', 'Mehr im Ton meines Charakters', 'Rechtschreibung korrigieren'].map(x => `<button class="chip" data-refine="${esc(x)}">${esc(x)}</button>`).join('')}</div>
          <div class="row"><input id="refine-own" placeholder="Eigene Anweisung, z. B. „Erwähne meine Angst vor Wasser“"><button class="btn small" data-act="refine-own">Überarbeiten</button></div>
        </div>` : ''}
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
  const imgHolder = (s, kind) => kind === 'diary' ? s.diary : s.expedition;
  function imgSection(s, kind) {
    const h = imgHolder(s, kind), style = h.imageStyle || 'skizze';
    const hasText = kind === 'diary' ? !!(s.diary.text || '').trim() : !!(s.expedition.verlauf || s.expedition.auftrag);
    return `<div class="report-img">
      <h4>🎨 Bild zum ${kind === 'diary' ? 'Eintrag' : 'Bericht'}</h4>
      ${h.imageId ? `<img data-img="${esc(h.imageId)}" alt="KI-Bild">
        <div class="btns"><button class="btn small" data-img-share="${kind}">Teilen</button><button class="btn ghost small" data-img-dl="${kind}">Speichern</button><button class="btn ghost small danger" data-img-del="${kind}">Entfernen</button></div>` : ''}
      <div class="chips">${Object.entries(Reports.IMG_STYLES).map(([k, v]) => `<button class="chip ${style === k ? 'on' : ''}" data-img-style="${kind}:${k}">${v.label}</button>`).join('')}</div>
      <div class="btns">
        ${AI.available() ? `<button class="btn small" data-img-gen="${kind}" ${hasText ? '' : 'disabled'}>🎨 ${h.imageId ? 'Neues Bild erstellen' : 'Bild erstellen lassen'}</button>
        <button class="btn ghost small" data-img-prompt="${kind}" ${hasText ? '' : 'disabled'}>📋 Für ChatGPT</button>` : ''}
        <label class="btn ${AI.available() ? 'ghost' : ''} small">📤 ${h.imageId ? 'Anderes Bild' : 'Eigenes Bild hochladen'}<input type="file" accept="image/*" data-img-up="${kind}" hidden></label>
      </div>
      ${h.imagePrompt && state.showPrompt === kind ? `<div class="note prompt-box">
        <p><strong>So geht's ohne Kosten:</strong> Die Beschreibung ist kopiert (inkl. „Erstelle ein Bild:“). In der <strong>ChatGPT-App</strong> einfügen und absenden, das Bild speichern und hier über <strong>📤 Eigenes Bild</strong> hochladen.</p>
        <pre class="out">${esc(h.imagePrompt)}</pre>
        <div class="btns"><button class="btn small" data-img-copy="${kind}">Nochmal kopieren</button><a class="btn ghost small" href="https://chatgpt.com/" target="_blank" rel="noopener">ChatGPT öffnen</a></div></div>` : ''}
      <p class="muted small">${!AI.available() ? 'Z. B. eine eigene Zeichnung, ein Screenshot aus dem Spiel oder ein Bild aus einer Bild-KI.' : hasText ? '„Bild erstellen lassen“ nutzt Gemini – die Bildmodelle sind dort nur mit hinterlegter Abrechnung verfügbar (ca. 4 Cent/Bild). Kostenlos: „Für ChatGPT“ (mit deinem Abo) oder ein eigenes Bild hochladen.' : 'Erst den Text schreiben (lassen), dann das Bild.'}</p>
    </div>`;
  }

  // Bildbeschreibung erstellen (bzw. vorhandene wiederverwenden), kopieren und anzeigen
  async function imagePromptFor(s, kind, fresh) {
    const h = imgHolder(s, kind), style = h.imageStyle || 'skizze';
    if (fresh || !h.imagePrompt || h.imagePromptStyle !== style) {
      h.imagePrompt = await AI.complete(Reports.imagePrompt(s, kind, style));
      h.imagePromptStyle = style; Store.save();
    }
    return h.imagePrompt;
  }
  async function showPromptForChatGPT(s, kind) {
    const p = await imagePromptFor(s, kind, false);
    copy('Erstelle ein Bild: ' + p);
    state.showPrompt = kind; render();
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
    const me = Store.myChar(s.myCharId);
    const prompt = await imagePromptFor(s, kind, true);
    const ref = me && me.imageId ? await Images.blobOf(me.imageId) : null;
    let raw;
    try { raw = await AI.generateImage(prompt, ref); }
    catch (e) {
      // Kein Bild-Kontingent → Beschreibung für ChatGPT anbieten, damit es trotzdem kostenlos geht
      if (/Kontingent|quota|nur mit Gemini/i.test(e.message)) { copy('Erstelle ein Bild: ' + prompt); state.showPrompt = kind; render(); }
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
    const name = `${(s.title || 'zenkai').replace(/[^\wäöüß-]+/gi, '_')}_${kind === 'diary' ? 'tagebuch' : 'expedition'}.jpg`;
    return new File([b], name, { type: b.type || 'image/jpeg' });
  }

  function tabExpedition(s, el) {
    const e = s.expedition;
    const field = f => f.type === 'select'
      ? `<label>${esc(f.label)}<select data-e="${f.key}">${opts(f.options, e[f.key], '–')}</select></label>`
      : `<label>${esc(f.label)}<input data-e="${f.key}" value="${esc(e[f.key])}" placeholder="${esc(f.ph || '')}"></label>`;
    const area = f => `<div class="sec"><div class="row-between"><h4>${esc(f.label)}</h4>${micBtn('e-' + f.key)}</div>
      <textarea id="e-${f.key}" data-e="${f.key}" rows="${f.key === 'verlauf' ? 7 : 4}" placeholder="${esc(f.hint)}">${esc(e[f.key])}</textarea></div>`;
    const S = Reports.EXP_SECTIONS;
    el.innerHTML = `
      <div class="panel report">
        <div class="row-between"><h3>📜 Expeditionsbericht · Archäologie-Division</h3>
          ${AI.available() ? '<button class="btn small" data-act="gen-exp">✨ Aus Erzählung ausfüllen</button>' : ''}</div>
        <div class="grid2">${Reports.EXP_HEAD.map(field).join('')}</div>
        <div class="row-between"><span></span><button class="btn ghost small" data-act="fill-team">Teilnehmer aus Session übernehmen</button></div>
        ${S.slice(0, 4).map(area).join('')}
        <div class="sec"><div class="row-between"><h4>4. Funde & Artefakte</h4><button class="btn ghost small" data-act="add-find">＋ Fund</button></div>
          ${(e.finds || []).length ? (e.finds || []).map((f, i) => `<div class="find">
            <div class="find-head"><strong>F-${String(i + 1).padStart(2, '0')}</strong><button class="btn ghost small danger" data-del-find="${i}">✕</button></div>
            <div class="grid2">${Reports.FIND_COLS.map(c => `<label>${c.label}<input data-find="${i}" data-k="${c.key}" value="${esc(f[c.key])}"></label>`).join('')}</div></div>`).join('')
        : '<p class="muted small">Noch keine Funde eingetragen.</p>'}</div>
        ${S.slice(4, 6).map(area).join('')}
        <div class="sec"><h4>7. Ergebnis</h4><select data-e="ergebnis">${opts(Reports.RESULT, e.ergebnis, '– Ergebnis wählen –')}</select></div>
        ${S.slice(6).map(area).join('')}
        ${imgSection(s, 'expedition')}
      </div>`;
  }

  function tabExport(s, el) {
    const exp = needsExpedition(s);
    const block = (id, title, text) => `<div class="panel"><div class="row-between"><h3>${title}</h3>
      <div class="btns"><button class="btn small" data-copy="${id}">📋 Kopieren</button><button class="btn ghost small" data-share="${id}">Teilen</button><button class="btn ghost small" data-dl="${id}">.txt</button></div></div>
      <pre class="out" id="out-${id}">${esc(text)}</pre></div>`;
    el.innerHTML = block('diary', '📖 Tagebuch', Reports.diaryText(s)) + (exp ? block('exp', '📜 Expeditionsbericht', Reports.expeditionText(s)) : '');
  }

  /* ---------- Verzeichnis ---------- */
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
        <label>Aussehen <span class="muted small">(für KI-Bilder)</span><textarea name="looks" rows="2" placeholder="z. B. lange schwarze Haare, helle Augen, grüne Chunin-Weste, Narbe an der Wange">${esc(p.looks)}</textarea></label>
        ${p._mine ? `<label>Persönlichkeit & Sprechweise <span class="muted small">(prägt den Ton im Tagebuch)</span><textarea name="voice" rows="3" placeholder="z. B. neugierig, etwas schüchtern, spricht förmlich, liebt alte Schriftrollen">${esc(p.voice)}</textarea></label>`
        : `<label>Beziehung<select name="relation">${opts(['Verbündet', 'Freund', 'Neutral', 'Rivale', 'Feind'], p.relation, '–')}</select></label>
           <label>Notizen<textarea name="notes" rows="3" placeholder="Jutsu, Eigenheiten, was ihr erlebt habt…">${esc(p.notes)}</textarea></label>`}
        ${dl('dl-r', L().ranks)}${dl('dl-v', L().villages)}${dl('dl-d', L().divisions)}${dl('dl-p', professions())}
        <div class="row-between">${p.id ? '<button type="button" class="btn ghost danger" data-act="del-person">Löschen</button>' : '<span></span>'}
          <div class="btns"><button type="button" class="btn ghost" data-act="close">Abbrechen</button><button class="btn primary">Speichern</button></div></div>
      </form>`);
    const showPic = () => { $('#pic-prev').innerHTML = avatar(img.id, $('#pform [name=firstName]').value || $('#pform [name=lastName]').value, 'big'); $('#pic-del').classList.toggle('hidden', !img.id); Images.hydrate($('#pic-prev')); };
    Images.hydrate($('#pic-prev'));
    $('#pic-in').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      try { const blob = await Images.resize(f, 512, true); img.id = await Images.save(blob); img.fresh.push(img.id); showPic(); }
      catch (e) { toast('Bild konnte nicht gelesen werden: ' + e.message, 'error'); }
    };
    $('#pic-del').onclick = () => { img.id = ''; showPic(); };
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
      <p class="muted">Die Charaktere, die du selbst spielst. Gehört einer davon einer Division mit Berichtspflicht an (${esc(D().settings.expeditionDivisions.join(', '))}), wird automatisch ein Expeditionsbericht angelegt.</p>
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
        <label>Divisionen<textarea data-list="divisions" rows="8">${esc(L().divisions.join('\n'))}</textarea></label></div>
        <label>Divisionen mit Expeditionsbericht <span class="muted small">(kommagetrennt)</span><input data-set="expeditionDivisions" value="${esc(s.expeditionDivisions.join(', '))}"></label>`)}
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
    if (d.view) return go(d.view);
    if (d.open) return go('session', { sessionId: d.open, tab: 'notes', detected: [] });
    if (d.tab) { state.tab = d.tab; return render(); }
    if (d.mic) return Speech.toggle(t, document.getElementById(d.mic), m => toast(m, 'error'));
    if (d.part) { const i = s.participants.indexOf(d.part); i < 0 ? s.participants.push(d.part) : s.participants.splice(i, 1); Store.save(); t.classList.toggle('on'); return; }
    if (d.sel) { const sel = state.sel; sel.has(d.sel) ? sel.delete(d.sel) : sel.add(d.sel); return render(); }
    if (d.person) { const p = Store.person(d.person); return personForm(p, 'Person bearbeiten', v => savePerson(p, v)); }
    if (d.mychar) { const c = Store.myChar(d.mychar); return personForm({ ...c, _mine: true }, 'Charakter bearbeiten', v => { Object.assign(c, v); Store.save(); }); }
    if (d.detAdd !== undefined) { const p = savePerson(null, state.detected[d.detAdd]); s.participants.push(p.id); state.detected.splice(d.detAdd, 1); Store.save(); render(); return toast(p.name + ' ins Verzeichnis übernommen'); }
    if (d.detSkip !== undefined) { state.detected.splice(d.detSkip, 1); return render(); }
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
    if (d.expSet) {
      if (d.expSet === 'auto') { s.hasExpedition = null; s.expeditionAuto = false; }
      else { s.hasExpedition = d.expSet === 'yes'; s.expeditionAuto = false; }
      s.genWhat = null; Store.save(); return render();
    }
    if (d.genWhat) { s.genWhat = d.genWhat; Store.save(); return render(); }
    if (d.sceneDel !== undefined) { s.analysis.scenes.splice(d.sceneDel, 1); Store.save(); return render(); }
    if (d.refine) return busy(t, () => refine(s, d.refine));
    if (d.imgStyle) { const [k, st] = d.imgStyle.split(':'); imgHolder(s, k).imageStyle = st; Store.save(); return render(); }
    if (d.imgGen) return busy(t, () => generateReportImage(s, d.imgGen));
    if (d.imgPrompt) return busy(t, () => showPromptForChatGPT(s, d.imgPrompt));
    if (d.imgCopy) return copy('Erstelle ein Bild: ' + imgHolder(s, d.imgCopy).imagePrompt);
    if (d.imgDel) {
      if (!confirm('Bild entfernen?')) return;
      const h = imgHolder(s, d.imgDel); Images.remove(h.imageId); h.imageId = ''; Store.save(); return render();
    }
    if (d.imgDl) return imageFile(s, d.imgDl).then(f => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); }).catch(e => toast(e.message, 'error'));
    if (d.imgShare) return imageFile(s, d.imgShare).then(async f => {
      if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: s.title || 'Zenkai' }); } catch (e) { } }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); }
    }).catch(e => toast(e.message, 'error'));
    if (d.delFind !== undefined) { s.expedition.finds.splice(d.delFind, 1); Store.save(); return render(); }
    if (d.copy) return copy($('#out-' + d.copy).textContent);
    if (d.share) return share('Bericht', $('#out-' + d.share).textContent);
    if (d.dl) return download(`${(s.title || 'bericht').replace(/[^\wäöüß-]+/gi, '_')}_${d.dl === 'exp' ? 'expedition' : 'tagebuch'}.txt`, $('#out-' + d.dl).textContent);

    switch (d.act) {
      case 'close': return closeModal();
      case 'new-session': return newSession();
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
      case 'hide-ai-hint': try { localStorage.setItem('zenkai.hideAiHint', '1'); } catch (e) { } return render();
      case 'diary-template': s.diary.text = diaryTemplate(s); Store.save(); render(); { const ta = $('#diary'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.indexOf('…'), ta.value.indexOf('…') + 1); } } return;
      case 'notes-to-diary': s.diary.text = (s.ingameDate ? s.ingameDate + '\n\n' : '') + s.notes.trim(); Store.save(); render(); return toast('Notizen übernommen – jetzt in Ich-Form umschreiben');
      case 'ask': return busy(t, () => analyze(s));
      case 'gen-all': return busy(t, () => generateAll(s));
      case 'gen-diary': return busy(t, async () => {
        if (s.diary.text && !confirm('Vorhandenen Text ersetzen?')) return;
        await genDiary(s); render();
      });
      case 'gen-exp': return busy(t, async () => {
        if (s.expedition.verlauf && !confirm('Vorhandene Felder mit KI-Text überschreiben?')) return;
        await genExpedition(s); render(); toast('Bericht ausgefüllt');
      });
      case 'refine-own': { const v = $('#refine-own').value.trim(); if (v) return busy(t, () => refine(s, v)); return; }
      case 'fill-team': {
        const me = Store.myChar(s.myCharId);
        const rows = [me, ...s.participants.map(Store.person)].filter(Boolean).map(p => [p.name, p.rank, p.village].filter(Boolean).join(' – '));
        s.expedition.teilnehmer = rows.join('\n'); Store.save(); return render();
      }
      case 'add-find': s.expedition.finds = s.expedition.finds || []; s.expedition.finds.push({}); Store.save(); return render();
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
    if (d.s !== undefined) { s[d.s] = el.value; Store.saveSoon(); if (d.s === 'myCharId') render(); return; }
    if (d.qa !== undefined) { s.qa[d.qa].a = el.value; return Store.saveSoon(); }
    if (d.scene !== undefined) { s.analysis.scenes[d.scene][d.k] = el.value; return Store.saveSoon(); }
    if (el.id === 'bulk-field') { state.bulkField = el.value; return render(); }
    if (d.diary !== undefined) { s.diary.text = el.value; s.diary.updatedAt = Date.now(); return Store.saveSoon(); }
    if (d.e) { s.expedition[d.e] = el.value; return Store.saveSoon(); }
    if (d.find !== undefined) { s.expedition.finds[d.find][d.k] = el.value; return Store.saveSoon(); }
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
    render();
    updateBadge();
    Sync.init();
    if (r && r.type === 'signup') toast('E-Mail bestätigt – willkommen bei Zenkai ✓');
  })();
})();
