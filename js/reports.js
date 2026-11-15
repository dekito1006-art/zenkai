/* Zenkai – Berichtsstrukturen, Prompts und Textexport */
const Reports = (() => {

  /* ---------- Expeditionsbericht (Archäologie-Division) ---------- */
  const SECRECY = ['Öffentlich', 'Intern (Division)', 'Vertraulich', 'Geheim', 'Streng geheim (nur Kage)'];
  const RESULT = ['Ziel vollständig erreicht', 'Ziel teilweise erreicht', 'Ziel nicht erreicht', 'Abgebrochen'];
  const MISSION_RANKS = ['D', 'C', 'B', 'A', 'S'];

  const EXP_HEAD = [
    { key: 'berichtNr', label: 'Berichtsnummer', type: 'text', ph: 'z. B. ARCH-2026-014' },
    { key: 'geheimhaltung', label: 'Geheimhaltungsstufe', type: 'select', options: SECRECY },
    { key: 'missionsRang', label: 'Missionsrang', type: 'select', options: MISSION_RANKS },
    { key: 'auftraggeber', label: 'Auftraggeber', type: 'text', ph: 'z. B. Divisionsleitung, Hokage' },
    { key: 'leitung', label: 'Expeditionsleitung', type: 'text' },
    { key: 'zeitraum', label: 'Zeitraum (Ingame)', type: 'text', ph: 'z. B. 3 Tage, Frühling' },
    { key: 'einsatzgebiet', label: 'Einsatzgebiet / Fundstätte', type: 'text', ph: 'Land, Region, Ort' },
  ];

  const EXP_SECTIONS = [
    { key: 'teilnehmer', label: 'Teilnehmer', hint: 'Name – Rang – Dorf – Funktion im Team' },
    { key: 'auftrag', label: '1. Auftrag & Zielsetzung', hint: 'Was sollte erforscht, geborgen oder geprüft werden? Warum?' },
    { key: 'verlauf', label: '2. Verlauf der Expedition', hint: 'Chronologisch: Aufbruch, Anreise, Erkundung, Grabung/Bergung, Rückkehr' },
    { key: 'fundstaette', label: '3. Beschreibung der Fundstätte', hint: 'Gelände, Bauweise, geschätztes Alter, Zustand, Siegel, Fallen, Zugänge' },
    // 4. Funde = Tabelle
    { key: 'erkenntnisse', label: '5. Erkenntnisse & Auswertung', hint: 'Inschriften, Fuinjutsu, Chakra-Spuren, historische Einordnung, Bezug zu Clans/Dörfern' },
    { key: 'vorkommnisse', label: '6. Vorkommnisse & Gefahren', hint: 'Feindkontakt, Kämpfe, Verletzungen, Schäden, Verluste' },
    { key: 'bewertung', label: '7. Ergebnis & Bewertung', hint: 'Wurde das Ziel erreicht? Was ist offen geblieben?' },
    { key: 'empfehlungen', label: '8. Empfehlungen & weiteres Vorgehen', hint: 'Folgeexpedition, Sicherung der Stätte, Meldung an Behörden, Analyse der Funde' },
  ];

  const FIND_COLS = [
    { key: 'bezeichnung', label: 'Bezeichnung' },
    { key: 'beschreibung', label: 'Beschreibung' },
    { key: 'fundort', label: 'Fundort' },
    { key: 'zustand', label: 'Zustand' },
    { key: 'verbleib', label: 'Verbleib' },
  ];

  const emptyExpedition = () => ({ geheimhaltung: 'Intern (Division)', ergebnis: '', finds: [] });

  /* ---------- Kontext für die KI ---------- */
  function charLine(c) {
    if (!c) return '';
    return [c.name, c.age ? c.age + ' Jahre' : '', c.rank, c.village, c.division && c.division !== 'Keine' ? 'Division ' + c.division : '', c.clan ? 'Clan ' + c.clan : '']
      .filter(Boolean).join(', ');
  }

  function context(session) {
    const me = Store.myChar(session.myCharId);
    const parts = (session.participants || []).map(Store.person).filter(Boolean);
    const age = ageOf(session);
    let t = `SPIELCHARAKTER: ${charLine(me ? { ...me, age } : null) || 'unbekannt'}\n`;
    if (age) t += `ALTER DES CHARAKTERS IN DIESER SESSION: ${age} Jahre\n`;
    if (me && me.voice) t += `PERSÖNLICHKEIT & SPRECHWEISE: ${me.voice}\n`;
    if (session.ingameDate) t += `INGAME-DATUM: ${session.ingameDate}\n`;
    if (session.title) t += `SESSION-TITEL: ${session.title}\n`;
    if (parts.length) t += `BETEILIGTE PERSONEN:\n${parts.map(p => '- ' + charLine(p) + (p.relation ? ` (Beziehung: ${p.relation})` : '')).join('\n')}\n`;
    t += `\nERZÄHLUNG DES SPIELERS ZUR SESSION:\n${session.notes || '(keine)'}\n`;
    const qa = (session.qa || []).filter(x => x.a && x.a.trim());
    if (qa.length) t += `\nNACHFRAGEN UND ANTWORTEN DES SPIELERS:\n${qa.map(x => `F: ${x.q}\nA: ${x.a}`).join('\n')}\n`;
    return t;
  }

  function questionsPrompt(session, withExpedition) {
    return {
      system: 'Du hilfst einem Rollenspieler im Naruto-Universum, nach einer Spielsession Berichte zu schreiben. ' +
        'Er hat frei erzählt (oft per Spracheingabe, daher evtl. Tippfehler bei Namen). Antworte nur mit JSON.',
      user: context(session) +
        `\nAUFGABE: Daraus sollen entstehen: ein Tagebucheintrag (Erlebtes, Gefühle, Gelerntes)` +
        (withExpedition ? ' und ein Expeditionsbericht der Archäologie-Division (Auftrag, Ort, Teilnehmer, Verlauf, Fundstätte, Funde mit Zustand und Verbleib, Erkenntnisse, Vorkommnisse, Ergebnis, Empfehlungen)' : '') +
        '.\nPrüfe, welche WICHTIGEN Informationen fehlen oder unklar/widersprüchlich sind (auch unklar verstandene Namen). ' +
        'Stelle höchstens 5 kurze, konkrete Nachfragen in der Du-Form, die wichtigste zuerst. Frage nichts, was schon beantwortet ist. ' +
        'Wenn alles Wesentliche klar ist, gib eine leere Liste zurück. ' +
        'Format: {"questions":[{"q":"Frage","why":"wofür (z. B. Expeditionsbericht: Funde)"}]}',
    };
  }

  // Alter: Angabe in der Session hat Vorrang vor dem Alter am Charakter
  function ageOf(session) {
    const me = Store.myChar(session.myCharId);
    return String(session.age || (me && me.age) || '').trim();
  }

  // Wie ein Charakter dieses Alters schreibt – damit ein 11-jähriger Genin nicht wie ein Jonin klingt
  function ageStyle(age) {
    const n = parseInt(age, 10);
    if (!n) return '';
    if (n <= 9) return `Der Charakter ist ${n} Jahre alt: sehr einfache, kurze Sätze, kindliche Sicht, große Gefühle, wenig Reflexion, darf naiv und verspielt klingen.`;
    if (n <= 12) return `Der Charakter ist ${n} Jahre alt: einfache Sprache, eher kurze Sätze, kindlich-ehrlich, begeisterungsfähig, Gefühle direkt benannt (Angst, Stolz, Wut), wenig abstraktes Denken; Lektionen eher konkret („Ich muss mehr trainieren“).`;
    if (n <= 15) return `Der Charakter ist ${n} Jahre alt: jugendliche Sprache, schwankt zwischen Unsicherheit und Übermut, vergleicht sich mit anderen, beginnt über sich nachzudenken; keine erwachsenen Formulierungen.`;
    if (n <= 19) return `Der Charakter ist ${n} Jahre alt: junger Erwachsener, reflektierter, aber noch emotional; sucht seinen Platz, denkt über Verantwortung und Beziehungen nach.`;
    if (n <= 40) return `Der Charakter ist ${n} Jahre alt: erwachsen, reflektiert und gefasst, denkt an Verantwortung, Team und Dorf; Gefühle eher kontrolliert beschrieben.`;
    return `Der Charakter ist ${n} Jahre alt: erfahren und abgeklärt, oft rückblickend und weise, vergleicht mit früheren Erlebnissen.`;
  }

  function creativityRule() {
    return Store.data.settings.creativity === 'ausschmuecken'
      ? 'Du darfst Stimmung und Details passend ausschmücken, aber keine neuen Handlungsereignisse, Personen oder Funde erfinden.'
      : 'Halte dich streng an die Notizen. Erfinde keine Ereignisse, Personen, Funde oder Details, die nicht genannt sind.';
  }

  function diaryPrompt(session) {
    const s = Store.data.settings;
    const len = { 'sehr kurz': '80–120 Wörter', 'kurz': '150–220 Wörter', 'mittel': '250–350 Wörter' }[s.diaryLength] || '150–220 Wörter';
    const fmt = s.diaryFormat === 'gegliedert'
      ? 'Gliedere den Eintrag in drei kurze Abschnitte mit den Überschriften "Erlebt", "Gefühlt", "Gelernt".'
      : 'Schreibe einen zusammenhängenden Fließtext, der nacheinander behandelt, was erlebt wurde, was der Charakter dabei gefühlt hat und was er gelernt hat.';
    return {
      system: 'Du bist Schreibassistent für ein deutschsprachiges Rollenspiel im Naruto-Universum. ' +
        'Du schreibst Tagebucheinträge in der Ich-Form aus Sicht des gespielten Charakters – persönlich, ehrlich, im Ton des Charakters. ' +
        'Verwende Naruto-Begriffe (Jutsu, Chakra, Dorfnamen, Ränge) natürlich. ' + creativityRule(),
      user: context(session) +
        `\nAUFGABE: Schreibe den Tagebucheintrag zu dieser Session. Länge: ${len}. ${fmt} ` +
        (ageStyle(ageOf(session)) ? `\nALTERSGERECHT SCHREIBEN: ${ageStyle(ageOf(session))} Wortwahl, Satzbau, Gedankenwelt und Reife müssen zu diesem Alter passen.\n` : '') +
        'Beginne mit einer kurzen Datumszeile (Ingame-Datum, falls bekannt). Gib nur den Eintrag zurück, ohne Kommentar.',
    };
  }

  function refinePrompt(text, instruction, session) {
    const me = Store.myChar(session.myCharId);
    const age = ageOf(session);
    return {
      system: 'Du überarbeitest Rollenspiel-Texte im Naruto-Universum auf Deutsch. Behalte Inhalt und Ich-Perspektive bei, sofern nicht anders verlangt. Gib nur den überarbeiteten Text zurück.',
      user: `Charakter: ${charLine(me ? { ...me, age } : null)}\n${ageStyle(age) ? 'Stil: ' + ageStyle(age) + '\n' : ''}Anweisung: ${instruction}\n\nTEXT:\n${text}`,
    };
  }

  function expeditionPrompt(session) {
    const keys = [...EXP_HEAD, ...EXP_SECTIONS].map(f => f.key);
    return {
      system: 'Du bist Schreibassistent der Archäologie-Division eines Shinobi-Dorfes im Naruto-Universum. ' +
        'Du verfasst sachliche, präzise Expeditionsberichte in der dritten Person bzw. im Berichtsstil auf Deutsch. ' +
        creativityRule() + ' Wenn zu einem Feld keine Information vorliegt, gib einen leeren String zurück.',
      user: context(session) +
        `\nAUFGABE: Erstelle daraus einen Expeditionsbericht. Antworte ausschließlich mit einem JSON-Objekt mit den Schlüsseln: ${keys.join(', ')}, ergebnis, finds.\n` +
        `- geheimhaltung: einer von ${JSON.stringify(SECRECY)}\n- missionsRang: einer von ${JSON.stringify(MISSION_RANKS)} oder ""\n` +
        `- ergebnis: einer von ${JSON.stringify(RESULT)} oder ""\n` +
        '- teilnehmer: eine Zeile pro Person "Name – Rang – Dorf – Funktion"\n' +
        '- finds: Array von Objekten {bezeichnung, beschreibung, fundort, zustand, verbleib}\n' +
        '- Alle übrigen Felder: Text (Absätze mit \\n getrennt).',
    };
  }

  function detectPrompt(session) {
    const known = Store.data.people.map(p => p.name).join(', ') || '(keine)';
    const L = Store.data.settings.lists;
    return {
      system: 'Du extrahierst Personen aus Rollenspiel-Notizen im Naruto-Universum. Antworte nur mit JSON.',
      user: `Bereits bekannte Personen (NICHT erneut aufführen): ${known}\n` +
        `Eigener Charakter (NICHT aufführen): ${(Store.myChar(session.myCharId) || {}).name || '-'}\n\n` +
        `NOTIZEN:\n${session.notes}\n\n` +
        'Finde alle weiteren namentlich genannten Personen. Antworte als {"persons":[{"name","rank","village","division","clan","note"}]}. ' +
        `Nutze für rank möglichst: ${L.ranks.join(', ')}; für village: ${L.villages.join(', ')}; für division: ${L.divisions.join(', ')}. ` +
        'Unbekannte Werte als "". note = ein kurzer Satz, wie die Person in der Session vorkam.',
    };
  }

  /* ---------- KI-Bild zum Tagebuch / Bericht ---------- */
  const IMG_STYLES = {
    skizze: { label: '✏️ Skizze', en: 'pencil and ink field sketch on an aged, slightly stained notebook page, like an explorer\'s journal, loose cross-hatching, a few small illegible margin notes' },
    rolle: { label: '📜 Schriftrolle', en: 'traditional Japanese sumi-e ink painting on an unrolled ancient washi paper scroll, muted earthy colors, expressive brush strokes, a column of illegible brush calligraphy at the side' },
    manga: { label: '🖋️ Manga', en: 'black-and-white manga panel, dynamic composition, clean ink lines, screentone shading, dramatic angle' },
    foto: { label: '📷 Foto', en: 'cinematic photorealistic photograph, natural light, shallow depth of field, film still' },
  };

  function imagePrompt(session, kind, style) {
    const me = Store.myChar(session.myCharId);
    const age = ageOf(session);
    const parts = (session.participants || []).map(Store.person).filter(Boolean);
    const text = kind === 'diary' ? (session.diary && session.diary.text) : expeditionText(session);
    const who = [
      me ? `Main character: ${me.name}${age ? ', ' + age + ' years old' : ''}${me.rank ? ', rank ' + me.rank : ''}${me.looks ? ', appearance: ' + me.looks : ''}.` : '',
      ...parts.filter(p => p.looks).map(p => `${p.name}${p.age ? ' (' + p.age + ')' : ''}: ${p.looks}.`),
    ].filter(Boolean).join(' ');
    return {
      system: 'You write prompts for an image generation model. Output ONLY the prompt in English, max 90 words, no preamble.',
      user: `Pick the single most striking, visually clear moment from this ${kind === 'diary' ? 'diary entry' : 'expedition report'} of a Japanese-inspired ninja fantasy roleplay and describe it as one image.\n` +
        `Rules: original characters only (never depict existing anime or manga characters by name or likeness); describe characters by their appearance, age-appropriate body proportions; describe setting, lighting, mood and composition; no readable text, letters or logos in the image.\n` +
        (who ? `Characters: ${who}\n` : '') +
        `Art style (must be stated at the end of the prompt): ${IMG_STYLES[style].en}.\n\nTEXT:\n${text}`,
    };
  }

  /* ---------- Textexport ---------- */
  function diaryText(session) {
    const me = Store.myChar(session.myCharId);
    return `📖 Tagebuch – ${me ? me.name : ''}\n${session.ingameDate ? session.ingameDate + '\n' : ''}\n${(session.diary && session.diary.text) || ''}`.trim();
  }

  function expeditionText(session) {
    const e = session.expedition || {};
    const L = [];
    L.push('📜 EXPEDITIONSBERICHT – ARCHÄOLOGIE-DIVISION');
    L.push('════════════════════════════════');
    EXP_HEAD.forEach(f => { if (e[f.key]) L.push(`${f.label}: ${e[f.key]}`); });
    L.push(`Verfasser: ${charLine(Store.myChar(session.myCharId))}`);
    L.push(`Datum (real): ${session.date || ''}`);
    const sec = (f) => { if (e[f.key]) { L.push(''); L.push(f.label.toUpperCase()); L.push(e[f.key]); } };
    EXP_SECTIONS.slice(0, 4).forEach(sec);
    const finds = (e.finds || []).filter(f => FIND_COLS.some(c => f[c.key]));
    L.push(''); L.push('4. FUNDE & ARTEFAKTE');
    if (!finds.length) L.push('Keine Funde.');
    finds.forEach((f, i) => {
      L.push(`[F-${String(i + 1).padStart(2, '0')}] ${f.bezeichnung || 'Unbenannt'}`);
      FIND_COLS.slice(1).forEach(c => { if (f[c.key]) L.push(`   ${c.label}: ${f[c.key]}`); });
    });
    EXP_SECTIONS.slice(4, 6).forEach(sec);
    L.push(''); L.push('7. ERGEBNIS & BEWERTUNG');
    if (e.ergebnis) L.push(`Ergebnis: ${e.ergebnis}`);
    if (e.bewertung) L.push(e.bewertung);
    sec(EXP_SECTIONS[7]);
    L.push(''); L.push('════════════════════════════════');
    L.push(`Gez. ${(Store.myChar(session.myCharId) || {}).name || ''}`);
    return L.join('\n');
  }

  return {
    EXP_HEAD, EXP_SECTIONS, FIND_COLS, RESULT, emptyExpedition,
    diaryPrompt, refinePrompt, expeditionPrompt, detectPrompt, questionsPrompt, imagePrompt, IMG_STYLES, diaryText, expeditionText, charLine,
  };
})();
