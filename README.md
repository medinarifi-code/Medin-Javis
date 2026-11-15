# J.A.R.V.I.S.

Ein futuristisches Sprach-Interface im Stil von Iron Man: ein leuchtender, pulsierender Orb, mit dem du sprichst. Jarvis merkt sich deine **Ziele**, verfolgt deinen Fortschritt und hat Zugriff auf deine **E-Mails** (lesen, suchen, zusammenfassen, Antworten senden nach Bestätigung).

- **Gehirn:** Claude (Anthropic API) mit Werkzeugen
- **Stimme:** ElevenLabs (Premium) – ohne Key automatisch die Browser-Stimme
- **Ohren:** Spracherkennung im Browser (Deutsch), optional mit Wake-Word „Jarvis“
- **Mails:** jeder Anbieter über IMAP/SMTP (Gmail, GMX, Web.de, Outlook …)

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20 und Google Chrome oder Microsoft Edge.

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# .env in einem Editor öffnen und ausfüllen (siehe unten)
npm start
```

Danach **http://localhost:3000** in Chrome öffnen, Mikrofon erlauben und auf den Orb klicken (oder Leertaste drücken).

## Einrichtung der `.env`

### 1. Claude (Pflicht)
API-Key unter https://console.anthropic.com → *API Keys* erstellen und bei `ANTHROPIC_API_KEY` eintragen.
`CLAUDE_EFFORT=low` sorgt für schnelle Antworten. Für schwierigere Aufgaben `medium` oder `high`.

### 2. Premium-Stimme (optional)
1. Account bei https://elevenlabs.io anlegen → *Profile → API Key* kopieren → `ELEVENLABS_API_KEY`.
2. In der *Voice Library* eine ruhige, tiefe Stimme wählen (Tipp: nach „British butler“ oder „calm narrator“ suchen), zu „My Voices“ hinzufügen und die **Voice ID** kopieren → `ELEVENLABS_VOICE_ID`.

Das Modell `eleven_multilingual_v2` spricht sauberes Deutsch.

### 3. E-Mail (optional)
Fast alle Anbieter verlangen für IMAP ein **App-Passwort** statt deines normalen Passworts:

| Anbieter | IMAP_HOST | SMTP_HOST | App-Passwort |
|---|---|---|---|
| Gmail | imap.gmail.com | smtp.gmail.com | Google-Konto → Sicherheit → 2-Faktor aktivieren → *App-Passwörter* |
| GMX | imap.gmx.net | mail.gmx.net | Einstellungen → POP3/IMAP aktivieren |
| Web.de | imap.web.de | smtp.web.de | Einstellungen → POP3/IMAP aktivieren |
| Outlook/Hotmail | outlook.office365.com | smtp.office365.com | Microsoft-Konto → Sicherheit → App-Kennwörter |

`MAIL_USER` ist deine volle Mail-Adresse, `MAIL_PASS` das App-Passwort.

## Was du sagen kannst

- „Jarvis, mein Ziel ist es, bis Juni 10 Kilo abzunehmen.“
- „Ich war heute dreimal joggen, trag das bei meinem Fitnessziel ein.“
- „Wie stehe ich bei meinen Zielen?“
- „Habe ich neue Mails?“ · „Was wollte Thomas von mir?“ · „Lies mir die Mail von Amazon vor.“
- „Antworte ihm, dass ich morgen Zeit habe.“ → Jarvis liest den Entwurf vor und sendet erst nach deinem „Ja, senden“.

**Bedienung:** Orb klicken oder `Leertaste` = sprechen · `Esc` = stoppen · *Wake-Word* einschalten = Jarvis hört dauerhaft zu und reagiert auf „Jarvis …“ · unten kannst du auch tippen.

## Sicherheit

- Alle Schlüssel und Passwörter bleiben in der `.env` auf deinem Rechner (wird nicht ins Git hochgeladen).
- Der Server ist nur lokal erreichbar (`127.0.0.1`).
- Mails werden nie ohne deine ausdrückliche Bestätigung gesendet – das ist im Server erzwungen, nicht nur im Prompt.
- Ziele liegen in `data/goals.json`.

## Projektstruktur

```
server/
  index.js        Express-Server & API
  agent.js        Jarvis-Persönlichkeit, Claude-Werkzeugschleife
  tts.js          ElevenLabs-Stimme
  tools/mail.js   IMAP/SMTP
  tools/goals.js  Ziele-Speicher
public/
  index.html, style.css   HUD-Oberfläche
  orb.js          3D-Orb (Three.js, Shader)
  app.js          Sprache, Audio-Pegel, Panels
test/             npm test
```

## Online betreiben (nur mit Handy, ohne Computer)

1. Auf https://render.com mit GitHub anmelden.
2. **New → Blueprint** wählen, das Repository `Medin-Javis` und den richtigen Branch auswählen.
3. `APP_PASSWORD` (frei wählbar) und `ANTHROPIC_API_KEY` eintragen → **Apply**.
4. Die angezeigte Adresse (`https://….onrender.com`) im Handy-Browser öffnen, Passwort eingeben (Benutzername beliebig).

Hinweis: Der kostenlose Plan schläft nach 15 Minuten ohne Nutzung ein (erster Aufruf dauert dann ca. 1 Minute), und gespeicherte Ziele gehen bei einem Neustart verloren.
