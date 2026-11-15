# Zenkai – RP-Berichte

Erzähl nach der Session einfach, was passiert ist. Zenkai schreibt daraus das **Tagebuch** (Ich-Form, aus Sicht deines Charakters) und den **Expeditionsbericht der Archäologie-Division**. Wenn etwas unklar ist, fragt die App nach. Dazu gibt es ein **Verzeichnis** aller getroffenen Personen.

## So läuft eine Session
1. **Sessions → ＋ Neue Session**
2. **🎤 Erzähl einfach los**: frei reden, Reihenfolge egal
3. **✨ Weiter**: Die KI prüft auf Lücken und stellt bis zu 5 Rückfragen. Personen aus der Erzählung werden erkannt und fürs Verzeichnis vorgeschlagen.
4. Rückfragen beantworten (auch per Sprache) → **✨ Berichte schreiben**
5. Kurz prüfen, bei Bedarf mit einem Klick überarbeiten („Kürzer“, „Emotionaler“ …)
6. **✓ Export**: kopieren, teilen (z. B. in Discord/WhatsApp) oder als .txt speichern

## Charaktere, Alter und Bilder
- **Porträt** für eigene Charaktere und Personen im Verzeichnis („📷 Bild wählen“, Kamera oder Galerie)
- **Alter** am Charakter, optional pro Session überschreibbar („Alter in dieser Session“). Die KI schreibt das Tagebuch altersgerecht: ein 10-jähriger Genin klingt anders als ein 35-jähriger Jonin.
- **Aussehen** (Freitext) wird für KI-Bilder genutzt
- **Bild zum Tagebuch / Bericht** (je eins), Stil wählbar: Skizze, Schriftrolle, Manga, Foto
  - „🎨 Bild erstellen lassen“: Gemini-Bildmodell. **Nur mit hinterlegter Abrechnung** bei Google (ca. 4 Cent/Bild), im Gratis-Tarif nicht verfügbar.
  - „📋 Für ChatGPT“: Die App schreibt die Bildbeschreibung und kopiert sie. In der ChatGPT-App einfügen, Bild speichern, über „📤 Eigenes Bild“ hochladen. Kostenlos mit ChatGPT-Abo.
- Bilder liegen lokal auf dem Gerät und in einem privaten Supabase-Speicherordner (nur dein Login hat Zugriff). Andere Geräte laden sie erst beim Anzeigen.

## Einrichtung
- **Einstellungen → KI**: ChatGPT (OpenAI) oder Gemini wählen und API-Schlüssel eintragen
  - OpenAI: platform.openai.com → API keys (nutzungsbasiert, meist unter 1 Cent pro Bericht)
  - Gemini: aistudio.google.com → Get API key (kostenloses Kontingent verfügbar)
- **Meine Chars**: eigenen Charakter anlegen. Ist die Division „Archäologie“, wird automatisch ein Expeditionsbericht angelegt.
- **Spracheingabe**: „Live-Diktat“ ist kostenlos (Chrome/Edge/Android). „Aufnahme + KI-Transkription“ erkennt Naruto-Namen deutlich besser und eignet sich für längeres Erzählen.

## Auf dem Handy (Android) und im Web nutzen
Die App ist eine PWA. Damit sie auf Android installierbar ist, muss sie über **https** erreichbar sein:
1. Den Ordner online stellen, am einfachsten per **Netlify Drop** (app.netlify.com/drop, Ordner hineinziehen) oder **GitHub Pages**
2. Die Adresse auf dem Android-Handy in **Chrome** öffnen → Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“
3. Am PC dieselbe Adresse im Browser öffnen (Edge/Chrome bieten ebenfalls „App installieren“ an)

Nach Änderungen an der App in `sw.js` die `VERSION` erhöhen, damit die Geräte die neue Version laden.

## Sync zwischen PC und Handy (Supabase)
Einmal einrichten (ca. 10 Minuten), danach sind Sessions, Berichte, Verzeichnis und Einstellungen automatisch auf allen Geräten gleich.

1. Auf **supabase.com** kostenlos registrieren → **New project** (Region: *Central EU (Frankfurt)*, Datenbank-Passwort frei wählen)
2. Im Projekt links **SQL Editor** → Inhalt von [`supabase.sql`](supabase.sql) einfügen → **Run**
3. Optional, aber bequem: **Authentication → Sign In / Providers → Email** → „Confirm email“ ausschalten. Dann ist keine Bestätigungs-Mail nötig.
4. **Project Settings → API** (bzw. „API Keys“): **Project URL** und **Publishable key** (oder den „anon public“ Key) kopieren
5. Diese beiden Werte in [`js/config.js`](js/config.js) eintragen (empfohlen, dann musst du sie nirgends eintippen) *oder* in der App unter **Einstellungen → Sync**
6. In der App **Konto erstellen** (E-Mail + Passwort), auf den anderen Geräten mit denselben Daten **Anmelden**

So funktioniert der Abgleich:
- automatisch kurz nach jeder Änderung, beim Öffnen der App und alle 2 Minuten. Ohne Internet wird er nachgeholt.
- pro Session, Person und Charakter gewinnt die **zuletzt geänderte Version**. Bearbeitest du *dieselbe* Session gleichzeitig auf zwei Geräten, setzt sich die spätere Änderung komplett durch.
- Löschungen werden ebenfalls übertragen. „Alles löschen“ löscht daher auf allen Geräten.
- API-Schlüssel für ChatGPT/Gemini werden **nicht** synchronisiert. Sie bleiben auf dem jeweiligen Gerät.
- Die Kopfzeile zeigt den Status: ☁ ✓ = synchron, ⚠ = Problem (antippen für Details)

## Daten
Ohne Sync liegen die Daten nur **auf dem jeweiligen Gerät** (Browser-Speicher). Unter **Einstellungen → Daten** kannst du jederzeit eine Sicherungsdatei herunterladen und wieder laden. Der API-Schlüssel wird dabei nicht exportiert.

## Dateien
| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst |
| `js/app.js` | Oberfläche und Ablauf |
| `js/reports.js` | Berichtsstruktur, KI-Prompts, Textexport |
| `js/ai.js` | Anbindung an OpenAI / Gemini |
| `js/speech.js` | Spracheingabe |
| `js/store.js` | Datenspeicher, Sicherung, Änderungsverfolgung |
| `js/sync.js` | Sync über Supabase (Login, Abgleich, Konflikte) |
| `js/config.js` | Supabase-Zugangsdaten (optional) |
| `supabase.sql` | Tabelle und Zugriffsregeln für Supabase |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | PWA (installierbar, offline) |
