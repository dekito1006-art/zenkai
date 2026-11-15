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
    return [c.name, c.age ? c.age + ' Jahre' : '', c.rank, c.profession ? 'Beruf: ' + c.profession : '', c.village,
      c.division && c.division !== 'Keine' ? 'Division ' + c.division : '', c.clan ? 'Clan ' + c.clan : '']
      .filter(Boolean).join(', ');
  }

  // Alter und Rang: Angabe in der Session hat Vorrang vor den Daten am Charakter (Charaktere entwickeln sich)
  function ageOf(session) {
    const me = Store.myChar(session.myCharId);
    return String(session.age || (me && me.age) || '').trim();
  }
  function rankOf(session) {
    const me = Store.myChar(session.myCharId);
    return String(session.rank || (me && me.rank) || '').trim();
  }
  const words = t => (t || '').trim().split(/\s+/).filter(Boolean).length;

  function context(session, withScenes = true) {
    const me = Store.myChar(session.myCharId);
    const parts = (session.participants || []).map(Store.person).filter(Boolean);
    const age = ageOf(session), rank = rankOf(session);
    let t = `SPIELCHARAKTER: ${charLine(me ? { ...me, age, rank } : null) || 'unbekannt'}\n`;
    if (rank) t += `RANG DES CHARAKTERS IN DIESER SESSION: ${rank}\n`;
    if (age) t += `ALTER DES CHARAKTERS IN DIESER SESSION: ${age} Jahre\n`;
    if (me && me.voice) t += `PERSÖNLICHKEIT & SPRECHWEISE: ${me.voice}\n`;
    if (session.ingameDate) t += `INGAME-DATUM: ${session.ingameDate}\n`;
    if (session.title) t += `SESSION-TITEL: ${session.title}\n`;
    if (parts.length) t += `BETEILIGTE PERSONEN (aus dem Verzeichnis):\n${parts.map(p => '- ' + charLine(p) + (p.relation ? ` (Beziehung: ${p.relation})` : '')).join('\n')}\n`;
    t += `\nERZÄHLUNG DES SPIELERS ZUR SESSION:\n${session.notes || '(keine)'}\n`;
    const qa = (session.qa || []).filter(x => x.a && x.a.trim());
    if (qa.length) t += `\nNACHFRAGEN UND ANTWORTEN DES SPIELERS:\n${qa.map(x => `F: ${x.q}\nA: ${x.a}`).join('\n')}\n`;
    const sc = withScenes && session.analysis && (session.analysis.scenes || []).filter(x => x.title || x.summary);
    if (sc && sc.length) t += `\nSZENEN DER SESSION (vom Spieler geprüft, chronologisch – das ist die verbindliche Struktur):\n` +
      sc.map((x, i) => `${i + 1}. ${x.title}: ${x.summary}${x.feeling ? ' [Gefühl: ' + x.feeling + ']' : ''}`).join('\n') + '\n';
    return t;
  }

  /* Schritt 1: Analyse – Szenen, Widersprüche, Expedition ja/nein, Rückfragen, Personen und Berufe */
  function analyzePrompt(session, expeditionPossible) {
    const L = Store.data.settings.lists;
    const known = Store.data.people.map(p => `${p.name}${p.profession ? ' (' + p.profession + ')' : ''}${p.rank ? ' [' + p.rank + ']' : ''}`).join('; ') || '(keine)';
    const me = Store.myChar(session.myCharId);
    return {
      system: 'Du analysierst die Erzählung eines Rollenspielers im Naruto-Universum nach einer Spielsession, damit daraus später ein Tagebuch' +
        (expeditionPossible ? ' und ggf. ein Expeditionsbericht' : '') + ' entsteht. Die Erzählung ist oft per Sprache diktiert (Tippfehler bei Namen möglich). ' +
        'Sei gründlich und genau. Antworte nur mit JSON.',
      user: context(session, false) +
        `\nBEKANNTE PERSONEN IM VERZEICHNIS: ${known}\nEIGENER CHARAKTER (nicht als Person aufführen): ${me ? me.name : '-'}\n` +
        `\nAUFGABE: Antworte als JSON:\n{\n` +
        ` "scenes": [{"title": "Überschrift, 2–5 Wörter", "summary": "was passierte – MIT Grund (warum) und Ergebnis/Folge, 1–3 Sätze", "people": ["Namen"], "feeling": "Gefühl des Charakters dabei, falls erwähnt, sonst \\"\\""}],\n` +
        (expeditionPossible ? ` "expedition": true oder false,\n` : '') +
        ` "conflicts": [{"type": "rank|age|title|other", "text": "kurze Frage in Du-Form", "value": "Wert, der laut Erzählung stimmt"}],\n` +
        ` "questions": [{"q": "Frage in Du-Form", "why": "wofür"}],\n` +
        ` "newPeople": [{"firstName": "", "lastName": "", "rank": "", "village": "", "division": "", "clan": "", "profession": "", "note": ""}],\n` +
        ` "updates": [{"name": "bekannter Name", "profession": "", "rank": "", "note": ""}],\n` +
        ` "lessons": ["was der Charakter gelernt hat"]\n}\n` +
        `REGELN:\n` +
        `- scenes: streng chronologisch; jede eigenständige Begebenheit (Ort- oder Personenwechsel, neues Vorhaben) ist eine eigene Szene; nichts zusammenlegen, nichts weglassen; Ursache und Folge festhalten (z. B. "schickt ihn ins Missionsbüro, um sich der Materialsammlung anzuschließen").\n` +
        `- GENAUIGKEIT: Begründungen ("weil", "deshalb") NUR, wenn sie so in der Erzählung stehen – nie selbst eine Ursache erfinden oder zwei Fakten falsch verknüpfen. Wer etwas getan hat, genau so wiedergeben, wie erzählt (z. B. "Ich habe Jinsei geschrieben, als ich Genin wurde; er antwortete viel später – er ist selbst noch kein Genin").\n` +
        `- Versprechen, Abmachungen, Gegenleistungen, Geldgeber, Ratschläge und neue Freundschaften immer mit Inhalt festhalten (z. B. "leiht ihm das Geld gegen das Versprechen, ein großer Ninja zu werden"; "sein Cousin hat ihm das Geld geliehen").\n` +
        (expeditionPossible ? `- expedition: nur true, wenn in der Session tatsächlich eine archäologische Expedition, Erkundung, Ausgrabung oder Bergung stattfand. Training, Alltag oder eine normale Mission sind KEINE Expedition.\n` : '') +
        `- conflicts: Widersprüche zwischen den Charakter-/Session-Daten (Rang, Alter, Titel) und der Erzählung, z. B. Rang "Chunin", aber Erzählung "als ich Genin wurde" oder Titel "Monat", Erzählung "Tag". Die Session kann in der Vergangenheit liegen – der Charakter hatte damals evtl. einen niedrigeren Rang. value = der Wert, der laut Erzählung ZUM ZEITPUNKT DER SESSION galt (im Beispiel "Genin"), beim Titel ein korrigierter Titel. Leere Liste, wenn keine. Für rank nutze: ${L.ranks.join(', ')}.\n` +
        `- questions: höchstens 4 wirklich wichtige fehlende oder unklare Informationen; nichts fragen, was beantwortet ist (auch nicht in den bisherigen Nachfragen).\n` +
        `- newPeople: alle namentlich genannten Personen, die NICHT im Verzeichnis stehen. Vor- und Nachname trennen (nur einer bekannt → anderer ""). Beschreibungen wie "Sensei mit den blauen Haaren" nur, wenn ein Name genannt wird. profession = Beruf/Funktion, falls erkennbar (z. B. Schmied, Händler, Sensei/Ausbilder, Medic, Missionsbüro). Für rank/village/division nutze möglichst: ${L.ranks.join(', ')} / ${L.villages.join(', ')} / ${L.divisions.join(', ')}. note = ein Satz, wie die Person vorkam.\n` +
        `- updates: für bekannte Personen nur NEUE Erkenntnisse laut Erzählung (z. B. Beruf, Rang), sonst weglassen.\n` +
        `- Unbekannte Werte als "".`,
    };
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
      ? 'Du darfst Stimmung, Sinneseindrücke und Gedanken ergänzen – aber keine Ereignisse, Personen oder Funde erfinden, verändern oder weglassen.'
      : 'Halte dich streng an die Erzählung. Erfinde keine Ereignisse, Personen, Funde oder Details, die nicht genannt sind, und lass nichts Wichtiges weg.';
  }

  // Länge: "auto" richtet sich nach der Menge der Erzählung – eine lange Session wird nicht auf 200 Wörter zusammengepresst
  function lengthRule(session) {
    const s = Store.data.settings;
    const n = words(session.notes) + (session.qa || []).reduce((a, x) => a + words(x.a), 0);
    const scenes = ((session.analysis && session.analysis.scenes) || []).length;
    const auto = Math.max(160, Math.min(800, Math.round(Math.max(n * 0.7, scenes * 45) / 10) * 10));
    return {
      auto: `ca. ${auto} Wörter (passend zur Länge der Erzählung)`, 'sehr kurz': '80–120 Wörter', kurz: '150–220 Wörter',
      mittel: '250–350 Wörter', 'ausführlich': '400–600 Wörter',
    }[s.diaryLength] || `ca. ${auto} Wörter`;
  }

  function diaryFormatRule() {
    const f = Store.data.settings.diaryFormat;
    if (f === 'fliesstext') return 'FORM: Zusammenhängender Text ohne Überschriften – ein Absatz pro Szene in chronologischer Reihenfolge, am Ende ein Absatz zu Gefühlen und Gelerntem.';
    if (f === 'gegliedert') return 'FORM: Drei Abschnitte mit den Überschriften "Erlebt", "Gefühlt", "Gelernt" (jeweils allein in einer Zeile). "Erlebt" chronologisch in mehreren Absätzen (ein Absatz pro Szene). Unter "Gefühlt" NUR Gefühle (mit Bezug, wodurch), unter "Gelernt" NUR Lehren und Erkenntnisse – keine Ereignisse wiederholen.';
    return 'FORM: Für jede Szene eine kurze, lebendige Überschrift allein in einer Zeile (aus Sicht des Charakters, z. B. "In der Schmiede"), darunter ein Absatz. ' +
      'Danach die Abschnitte "Wie ich mich fühle" und "Was ich heute gelernt habe" (jeweils allein in einer Zeile als Überschrift, darunter 1–4 Sätze; NUR echte Gefühle bzw. Lehren, keine Ereignisse wiederholen).';
  }

  /* Schritt 2: Tagebuch aus den geprüften Szenen */
  function diaryPrompt(session) {
    const age = ageOf(session);
    return {
      system: 'Du bist Schreibassistent für ein deutschsprachiges Rollenspiel im Naruto-Universum. ' +
        'Du schreibst Tagebucheinträge in der Ich-Form aus Sicht des gespielten Charakters – persönlich, ehrlich, im Ton des Charakters. ' +
        'Verwende Naruto-Begriffe (Jutsu, Chakra, Dorfnamen, Ränge) natürlich. ' + creativityRule(),
      user: context(session) +
        `\nAUFGABE: Schreibe den Tagebucheintrag zu dieser Session. Länge: ${lengthRule(session)}.\n${diaryFormatRule()}\n` +
        `INHALT – unbedingt einhalten:\n` +
        `- Alle Szenen in genau dieser Reihenfolge, keine weglassen, keine zusammenlegen.\n` +
        `- Zu jedem Ereignis den Grund und die Folge behalten (weil, deshalb, dafür, damit) – der Leser muss verstehen, warum etwas passiert.\n` +
        `- Jede Person beim ersten Auftreten mit ihrer Rolle nennen (z. B. "der Schmied Yokurai Yakasaki", "Kazuhiko, ein Chunin").\n` +
        `- Versprechen, Abmachungen, neue Freundschaften und gelernte Techniken sind wichtig – nie weglassen.\n` +
        (ageStyle(age) ? `- ALTERSGERECHT: ${ageStyle(age)} Wortwahl, Satzbau und Gedankenwelt müssen dazu passen.\n` : '') +
        (session.ingameDate ? `- Erste Zeile: ${session.ingameDate}\n` : `- KEINE Datumszeile und kein erfundenes Datum.\n`) +
        `- Kein Markdown (keine Sternchen, Rauten oder Aufzählungszeichen). Gib nur den Eintrag zurück.`,
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

  /* ---------- KI-Bild zum Tagebuch / Bericht ---------- */
  // Alle Stile lehnen sich an das Design von Naruto an
  const IMG_STYLES = {
    anime: { label: '🎬 Anime', en: 'Naruto anime style (Studio Pierrot look): clean cel shading, bold outlines, vibrant colors, cinematic anime key frame' },
    manga: { label: '🖋️ Manga', en: 'Naruto manga style (Masashi Kishimoto look): black-and-white manga panel, clean ink lines, screentone shading, dynamic angle' },
    skizze: { label: '✏️ Skizze', en: 'Naruto-style character/scene sketch in pencil and ink on an aged notebook page, like a shinobi field journal, loose cross-hatching, a few illegible margin notes' },
    rolle: { label: '📜 Schriftrolle', en: 'Naruto-world artwork painted as traditional sumi-e ink on an unrolled ancient ninja scroll, muted earthy colors, expressive brush strokes, illegible calligraphy at the side' },
  };

  function imagePrompt(session, kind, style) {
    const me = Store.myChar(session.myCharId);
    const age = ageOf(session), rank = rankOf(session);
    const text = kind === 'diary' ? (session.diary && session.diary.text) : expeditionText(session);
    const topic = imageTopic(session, kind);
    const cast = imageCast(session, topic.scene);
    const describe = (c, isMe) => {
      const bits = [
        (isMe ? age : c.age) && `${isMe ? age : c.age} years old`,
        (isMe ? rank : c.rank) && `ninja rank ${isMe ? rank : c.rank}`,
        c.village && `from ${c.village} (wears that village's forehead protector)`,
        c.clan && `${c.clan} clan`,
        c.profession && `works as ${c.profession}`,
        c.looks && `appearance: ${c.looks}`,
        c.imageId && 'a reference portrait is attached – match face, hair, colors and outfit exactly',
      ].filter(Boolean);
      return `- ${c.name}${isMe ? ' (main character, the diary writer)' : ''}: ${bits.join('; ') || 'no details known – keep neutral'}`;
    };
    const who = [me ? describe(me, true) : '', ...cast.map(p => describe(p, false))].filter(Boolean).join('\n');
    return {
      system: 'You write prompts for an image generation model. Output ONLY the prompt in English, 80–140 words, no preamble.',
      user: `Describe ONE image for a ${kind === 'diary' ? 'diary entry' : 'mission report'} of a Naruto roleplay.\n` +
        (topic.text ? `SUBJECT (chosen by the player – depict exactly this): ${topic.text}\n` : `SUBJECT: pick the single most striking, visually clear moment of the text.\n`) +
        `CHARACTERS – depict them exactly as specified, never invent different hair, eye colors or outfits:\n${who || '- (no stored character details)'}\n` +
        `RULES: the look must follow the Naruto anime/manga design (ninja world of the Hidden Villages, shinobi outfits, forehead protectors, flak vests for Chunin and above, Japanese-inspired architecture and nature); ` +
        `these are original roleplay characters – do not depict canon Naruto characters; age-appropriate body proportions; describe setting, lighting, mood and composition; no readable text, letters or logos.\n` +
        `Art style (state it at the end of the prompt): ${IMG_STYLES[style].en}.\n\nTEXT:\n${text}`,
    };
  }

  // Ohne KI: Bildbeschreibung aus Motiv + gespeicherten Figuren-Daten zusammensetzen (auf Deutsch, für ChatGPT/Gemini)
  function localImagePrompt(session, kind, style) {
    const me = Store.myChar(session.myCharId);
    const topic = imageTopic(session, kind);
    const cast = imageCast(session, topic.scene);
    const line = (c, isMe) => '- ' + [c.name, (isMe ? ageOf(session) : c.age) && `${isMe ? ageOf(session) : c.age} Jahre`, (isMe ? rankOf(session) : c.rank),
      c.village && `aus ${c.village} (mit dessen Stirnband)`, c.clan && `Clan ${c.clan}`, c.profession, c.looks && `Aussehen: ${c.looks}`].filter(Boolean).join(', ');
    const styleDe = { anime: 'im Stil des Naruto-Animes (klare Konturen, Cel-Shading, kräftige Farben)', manga: 'als Schwarz-Weiß-Panel im Stil des Naruto-Mangas (Tusche, Rasterfolie)', skizze: 'als Bleistift-/Tusche-Skizze im Naruto-Stil auf einer alten Notizbuchseite', rolle: 'als Sumi-e-Tuschmalerei im Naruto-Stil auf einer alten Ninja-Schriftrolle' }[style];
    return `Motiv: ${topic.text || '(bitte Motiv ergänzen)'}\n` +
      `Figuren (genau so darstellen, keine anderen Haare/Augen/Kleidung erfinden):\n${[me ? line(me, true) : '', ...cast.map(p => line(p, false))].filter(Boolean).join('\n')}\n` +
      `Design: Naruto-Welt (Shinobi-Kleidung, Stirnbänder, Chunin-Westen ab Chunin, japanisch inspirierte Dörfer und Natur). Eigene RP-Figuren, keine bekannten Naruto-Charaktere. Kein Text im Bild.\n` +
      `Stil: ${styleDe}.`;
  }

  // Worüber das Bild sein soll: gewählte Szene und/oder eigene Beschreibung
  function imageTopic(session, kind) {
    const t = (session.imageTopics || {})[kind] || {};
    const scene = (session.analysis && session.analysis.scenes || [])[t.scene];
    const text = [scene ? `${scene.title}: ${scene.summary}` : '', (t.text || '').trim()].filter(Boolean).join(' – ');
    return { scene, text };
  }

  // Welche Personen aufs Bild gehören: Personen der gewählten Szene, sonst alle Beteiligten (max. 5)
  function imageCast(session, scene) {
    const parts = (session.participants || []).map(Store.person).filter(Boolean);
    if (scene && (scene.people || []).length) {
      const names = scene.people.map(n => n.toLowerCase());
      const hit = parts.filter(p => names.some(n => n.includes((p.firstName || p.name).toLowerCase()) || (p.lastName && n.includes(p.lastName.toLowerCase()))));
      if (hit.length) return hit.slice(0, 5);
    }
    return parts.slice(0, 5);
  }

  // Porträts als Vorlage: eigener Charakter + abgebildete Personen mit hinterlegtem Bild
  function imageRefs(session, kind) {
    const me = Store.myChar(session.myCharId);
    const cast = imageCast(session, imageTopic(session, kind).scene);
    return [me, ...cast].filter(c => c && c.imageId).slice(0, 4).map(c => ({ name: c.name, imageId: c.imageId }));
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
    const me = Store.myChar(session.myCharId);
    L.push(`Verfasser: ${charLine(me ? { ...me, rank: rankOf(session), age: '' } : null)}`);
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
    diaryPrompt, refinePrompt, expeditionPrompt, analyzePrompt, imagePrompt, localImagePrompt, imageRefs, IMG_STYLES, rankOf, ageOf, diaryText, expeditionText, charLine,
  };
})();
