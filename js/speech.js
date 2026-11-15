/* Zenkai – Spracheingabe
   Modus "browser": Live-Diktat über die Web Speech API (Chrome/Edge, kostenlos)
   Modus "ai":      Aufnahme, danach Transkription über OpenAI/Gemini (genauer bei Namen) */
const Speech = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let active = null; // { btn, stop }

  function insert(textarea, text) {
    if (!text) return;
    const v = textarea.value;
    const sep = v && !/\s$/.test(v) ? ' ' : '';
    textarea.value = v + sep + text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.scrollTop = textarea.scrollHeight;
  }

  function setBtn(btn, on, label) {
    if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
    btn.classList.toggle('recording', on);
    if (label) btn.textContent = label;
    else if (on) btn.textContent = '⏹ Stopp – ich höre zu…';
    else btn.innerHTML = btn.dataset.label;
  }

  function startBrowser(btn, ta, onError) {
    if (!SR) { onError('Dieser Browser unterstützt kein Live-Diktat. Nutze Chrome/Edge oder stelle in den Einstellungen auf „KI-Transkription“ um.'); return; }
    const rec = new SR();
    // Android-Chrome liefert im continuous-Modus doppelte Ergebnisse → dort satzweise + automatischer Neustart
    rec.lang = 'de-DE'; rec.continuous = !/Android/i.test(navigator.userAgent); rec.interimResults = true;
    let stopped = false;
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) insert(ta, r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      btn.title = interim;
    };
    rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') onError('Diktat-Fehler: ' + e.error); };
    rec.onend = () => { if (!stopped) { try { rec.start(); } catch (e) { finish(); } } else finish(); };
    const finish = () => { setBtn(btn, false); btn.title = ''; active = null; };
    rec.start();
    setBtn(btn, true);
    active = { btn, stop: () => { stopped = true; rec.stop(); } };
  }

  async function startAI(btn, ta, onError) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { onError('Kein Mikrofonzugriff: ' + e.message); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      setBtn(btn, true, '⏳ Transkribiere…');
      btn.disabled = true;
      try { insert(ta, await AI.transcribe(new Blob(chunks, { type: mr.mimeType }))); }
      catch (e) { onError(e.message); }
      btn.disabled = false; setBtn(btn, false); active = null;
    };
    mr.start();
    setBtn(btn, true, '⏹ Aufnahme beenden');
    active = { btn, stop: () => mr.stop() };
  }

  function toggle(btn, textarea, onError) {
    if (active) { const same = active.btn === btn; active.stop(); if (same) return; }
    // KI-Transkription nur mit eigener KI – sonst automatisch das kostenlose Live-Diktat
    if (Store.data.settings.speechMode === 'ai' && AI.available()) startAI(btn, textarea, onError);
    else startBrowser(btn, textarea, onError);
  }

  return { toggle, supported: !!SR };
})();
