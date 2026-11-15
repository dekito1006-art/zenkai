/* Zenkai – KI-Anbindung (OpenAI / Gemini), direkt aus dem Browser */
const AI = (() => {
  const S = () => Store.data.settings;

  // Erkennt vertauschte Schlüssel (OpenAI-Schlüssel beginnen mit „sk-“, Google-Schlüssel mit „AIza“ oder „AQ.“)
  function keyProblem(provider, key) {
    key = (key || '').trim();
    if (!key) return '';
    if (provider === 'gemini' && /^sk-/.test(key)) return 'Das ist ein OpenAI-Schlüssel (beginnt mit „sk-“), kein Gemini-Schlüssel. Gemini-Schlüssel beginnen mit „AIza“ oder „AQ.“ – zu finden unter aistudio.google.com/apikey.';
    if (provider === 'openai' && /^(AIza|AQ\.)/.test(key)) return 'Das ist ein Google-/Gemini-Schlüssel, kein OpenAI-Schlüssel. OpenAI-Schlüssel beginnen mit „sk-“.';
    if (/\s/.test(key)) return 'Der Schlüssel enthält Leerzeichen oder Zeilenumbrüche – bitte nochmal sauber einfügen.';
    return '';
  }

  function available() {
    const s = S();
    return (s.provider === 'openai' && s.openaiKey) || (s.provider === 'gemini' && s.geminiKey);
  }

  async function readError(res) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.status)) || msg; } catch (e) { }
    if (res.status === 401 || res.status === 403) msg = 'API-Schlüssel ungültig oder ohne Berechtigung. ' + msg;
    if (res.status === 429) msg = 'Limit erreicht / kein Guthaben. ' + msg;
    if (res.status === 503 || /high demand/i.test(msg)) msg = 'Gemini ist gerade überlastet – bitte in einer Minute nochmal versuchen. (' + msg + ')';
    return new Error(msg);
  }

  /* ---------- Gemini: Modell automatisch wählen ----------
     'auto' = neuestes stabiles Flash-Modell (z. B. gemini-3.8-flash), Fallback auf ältere/Lite-Modelle,
     falls eines nicht (mehr) verfügbar ist oder das kostenlose Kontingent dafür ausgeschöpft ist. */
  const GBASE = 'https://generativelanguage.googleapis.com/v1beta';
  const MKEY = 'zenkai.gmodels';
  let lastModel = null;

  // Abgekündigte Modelle (z. B. aus alten App-Versionen oder per Sync) wie 'auto' behandeln
  const DEPRECATED = /^gemini-(1\.|2\.0|2\.5-flash$|2\.5-pro$)/;
  const isAuto = () => { const m = (S().geminiModel || '').trim(); return !m || m === 'auto' || DEPRECATED.test(m); };

  async function geminiCandidates(force, ignoreManual) {
    const s = S();
    if (!isAuto() && !ignoreManual) return [s.geminiModel.trim()];
    const tag = s.geminiKey.slice(-6);
    if (!force) {
      try { const c = JSON.parse(localStorage.getItem(MKEY)); if (c && c.tag === tag && Date.now() - c.at < 3 * 864e5) return c.list; } catch (e) { }
    }
    const res = await fetch(GBASE + '/models?pageSize=200', { headers: { 'x-goog-api-key': s.geminiKey } });
    if (!res.ok) throw await readError(res);
    const j = await res.json();
    const ver = id => parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const list = (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(id => /^gemini-\d+(?:\.\d+)?-flash(-lite)?$/.test(id)) // nur stabile Flash-Modelle, keine Previews
      .sort((a, b) => (ver(b) - ver(a)) || (a.endsWith('-lite') - b.endsWith('-lite')));
    if (!list.length) throw new Error('Kein passendes Gemini-Modell gefunden. Bitte in den Einstellungen ein Modell eintragen.');
    // Die 4 neuesten Flash-Modelle zuerst, die 2 neuesten Lite-Modelle als schnelle Reserve
    const ordered = [...list.filter(x => !x.endsWith('-lite')).slice(0, 4), ...list.filter(x => x.endsWith('-lite')).slice(0, 2)];
    localStorage.setItem(MKEY, JSON.stringify({ tag, at: Date.now(), list: ordered }));
    return ordered;
  }

  // Modelle, die zu langsam waren (im Gratis-Tarif oft die allerneuesten), für 6 Stunden nach hinten stellen
  const SLOW = 'zenkai.gslow';
  const slowMap = () => { try { return JSON.parse(localStorage.getItem(SLOW)) || {}; } catch (e) { return {}; } };
  const markSlow = m => { const x = slowMap(); x[m] = Date.now() + 6 * 3600e3; localStorage.setItem(SLOW, JSON.stringify(x)); };
  const bySpeed = list => { const x = slowMap(), now = Date.now(); return [...list.filter(m => !(x[m] > now)), ...list.filter(m => x[m] > now)]; };

  const HEDGE_MS = 8000;    // so lange auf ein Modell warten, bevor parallel das nächste gefragt wird
  const TOTAL_MS = 150000;  // Obergrenze für eine Anfrage insgesamt

  // Fragt die Modelle gestaffelt an: Antwortet eines nicht binnen 8 s, startet parallel das nächste.
  // Die erste erfolgreiche Antwort gewinnt, alle anderen Anfragen werden abgebrochen.
  function race(models, body, staggered) {
    const s = S();
    return new Promise((resolve, reject) => {
      const ctrls = [], started = [];
      let idx = 0, pending = 0, done = false, lastErr = null, refresh = false, hedge = null;
      const total = setTimeout(() => finish(reject, Object.assign(new Error('Gemini antwortet gerade nicht (Zeitüberschreitung). Bitte gleich nochmal versuchen.'), { refresh })), TOTAL_MS);
      function finish(fn, v) { if (done) return; done = true; clearTimeout(hedge); clearTimeout(total); ctrls.forEach(c => c.abort()); fn(v); }
      function next() {
        clearTimeout(hedge);
        if (done || idx >= models.length) { if (!done && pending === 0) finish(reject, Object.assign(lastErr || new Error('Kein Gemini-Modell erreichbar.'), { refresh })); return; }
        const model = models[idx++], ctrl = new AbortController();
        ctrls.push(ctrl); started.push(model); pending++;
        if (staggered && idx < models.length) hedge = setTimeout(next, HEDGE_MS);
        fetch(`${GBASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.geminiKey }, body: JSON.stringify(body), signal: ctrl.signal,
        }).then(async res => {
          if (done) return;
          if (res.ok) {
            const j = await res.json();
            started.slice(0, started.indexOf(model)).forEach(markSlow); // wer vorher gestartet war und langsamer ist → nach hinten
            lastModel = model;
            return finish(resolve, j);
          }
          const err = await readError(res);
          lastErr = err; pending--;
          // Ausweichen auf das nächste Modell bei: Modell weg/gesperrt (404, „no longer available“),
          // Kontingent erschöpft (429) oder überlastet (500/503, „high demand“). Andere Fehler (z. B. Schlüssel ungültig) sind echt.
          const busy = [429, 500, 503].includes(res.status) || /high demand|overloaded|unavailable|try again later/i.test(err.message);
          const gone = res.status === 404 || /no longer available|not found|not supported/i.test(err.message);
          if (!busy && !gone) return finish(reject, err);
          if (busy) markSlow(model); else refresh = true;
          next();
        }).catch(e => {
          if (done || e.name === 'AbortError') return;
          lastErr = new Error('Keine Verbindung zu Gemini: ' + e.message); pending--;
          next();
        });
      }
      next();
    });
  }

  async function gemini(body) {
    const s = S();
    if (!isAuto()) {
      try { return await race([s.geminiModel.trim()], body, false); }
      catch (e) {
        if (!e.refresh) throw e;
        s.geminiModel = 'auto'; Store.save(); // eingetragenes Modell existiert nicht (mehr) → dauerhaft auf 'auto'
      }
    }
    try { return await race(bySpeed(await geminiCandidates(false)), body, true); }
    catch (e) {
      if (!e.refresh) throw e;
      return race(bySpeed(await geminiCandidates(true)), body, true); // Modellliste veraltet → neu laden und nochmal
    }
  }

  async function complete({ system, user, json = false }) {
    const s = S();
    if (!available()) throw new Error('Keine KI eingerichtet. Bitte in den Einstellungen Anbieter und API-Schlüssel eintragen.');
    const kp = keyProblem(s.provider, s.provider === 'gemini' ? s.geminiKey : s.openaiKey);
    if (kp) throw new Error(kp);

    if (s.provider === 'openai') {
      const body = {
        model: s.openaiModel,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      };
      if (json) body.response_format = { type: 'json_object' };
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.openaiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await readError(res);
      const j = await res.json();
      return j.choices[0].message.content.trim();
    }

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
    };
    if (json) body.generationConfig = { responseMimeType: 'application/json' };
    const j = await gemini(body);
    const c = j.candidates && j.candidates[0];
    if (!c || !c.content) throw new Error('Gemini hat keine Antwort geliefert' + (c && c.finishReason ? ' (' + c.finishReason + ')' : '') + '.');
    return c.content.parts.map(p => p.text || '').join('').trim();
  }

  function parseJSON(text) {
    const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); }
    catch (e) {
      const m = t.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('KI-Antwort war kein gültiges JSON.');
    }
  }

  async function completeJSON(p) { return parseJSON(await complete({ ...p, json: true })); }

  /* Audio-Transkription (für Spracheingabe im Modus "KI") */
  async function transcribe(blob) {
    const s = S();
    const names = [...Store.data.people.map(p => p.name), ...Store.data.myChars.map(c => c.name)].join(', ');
    const hint = 'Rollenspiel-Notizen im Naruto-Universum. Begriffe: Jutsu, Chakra, Genin, Chunin, Jonin, Hokage, Konohagakure, Sunagakure.' + (names ? ' Namen: ' + names : '');
    if (!available()) throw new Error('Für die KI-Transkription wird ein API-Schlüssel benötigt.');

    if (s.provider === 'openai') {
      const fd = new FormData();
      const ext = (blob.type.split('/')[1] || 'webm').split(';')[0];
      fd.append('file', blob, 'aufnahme.' + ext);
      fd.append('model', s.openaiSttModel || 'whisper-1');
      fd.append('language', 'de');
      fd.append('prompt', hint);
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + s.openaiKey }, body: fd,
      });
      if (!res.ok) throw await readError(res);
      return (await res.json()).text.trim();
    }

    const b64 = await new Promise((ok, fail) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1]);
      r.onerror = fail;
      r.readAsDataURL(blob);
    });
    const j = await gemini({
      contents: [{
        role: 'user', parts: [
          { text: 'Transkribiere diese deutsche Sprachaufnahme wörtlich. Gib nur den Text zurück. Kontext: ' + hint },
          { inline_data: { mime_type: blob.type.split(';')[0] || 'audio/webm', data: b64 } },
        ],
      }],
    });
    return j.candidates[0].content.parts.map(p => p.text || '').join('').trim();
  }

  /* ---------- Bilder erzeugen (Gemini-Bildmodelle, z. B. gemini-3.1-flash-image) ---------- */
  const IKEY = 'zenkai.gimgmodels';
  async function imageModels(force) {
    const s = S(), tag = s.geminiKey.slice(-6);
    if (!force) { try { const c = JSON.parse(localStorage.getItem(IKEY)); if (c && c.tag === tag && Date.now() - c.at < 3 * 864e5) return c.list; } catch (e) { } }
    const res = await fetch(GBASE + '/models?pageSize=200', { headers: { 'x-goog-api-key': s.geminiKey } });
    if (!res.ok) throw await readError(res);
    const ver = id => parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const list = ((await res.json()).models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(id => /^gemini-\d+(?:\.\d+)?-flash-image$/.test(id))
      .sort((a, b) => ver(b) - ver(a)).slice(0, 3);
    if (!list.length) throw new Error('Für deinen Schlüssel ist kein Gemini-Bildmodell verfügbar.');
    localStorage.setItem(IKEY, JSON.stringify({ tag, at: Date.now(), list }));
    return list;
  }

  async function generateImage(prompt, refBlob) {
    const s = S();
    if (s.provider !== 'gemini' || !s.geminiKey) throw new Error('Bilder erstellen geht aktuell nur mit Gemini (Einstellungen → KI-Schreibhilfe).');
    const kp = keyProblem('gemini', s.geminiKey); if (kp) throw new Error(kp);
    const parts = [{ text: prompt + (refBlob ? '\nUse the attached portrait as the reference for the main character\'s face, hair and outfit.' : '') }];
    if (refBlob) parts.push({ inline_data: { mime_type: refBlob.type || 'image/jpeg', data: await Images.toBase64(refBlob) } });
    const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
    let j;
    try { j = await race(await imageModels(false), body, false); }
    catch (e) {
      if (e.refresh) j = await race(await imageModels(true), body, false);
      else if (/limit:\s*0|free.?tier|quota/i.test(e.message)) throw new Error('Bilder erstellen ist im kostenlosen Gemini-Tarif gerade nicht verfügbar (Kontingent 0 oder aufgebraucht). Morgen nochmal versuchen. (' + e.message.slice(0, 160) + ')');
      else throw e;
    }
    const c = j.candidates && j.candidates[0];
    const img = c && c.content && (c.content.parts || []).map(p => p.inlineData || p.inline_data).find(Boolean);
    if (!img) throw new Error('Das Bildmodell hat kein Bild geliefert' + (c && c.finishReason ? ' (' + c.finishReason + ')' : '') + '. Evtl. Stil oder Text anpassen und nochmal versuchen.');
    return Images.fromBase64(img.data, img.mimeType || img.mime_type);
  }

  async function test() {
    const r = await complete({ system: 'Antworte knapp.', user: 'Sag "Verbindung steht!" auf Deutsch.' });
    const s = S();
    return r + (s.provider === 'gemini' ? ` (Modell: ${lastModel})` : '');
  }

  return { available, keyProblem, generateImage, complete, completeJSON, transcribe, test, get lastModel() { return lastModel; } };
})();
