# 🏠 Vermietertagebuch

Die Web-App für eure Hausgemeinschaft – im **Liquid-Glass-Design**, für iPhone, iPad, Android, PC und Mac.

- ✅ **Aufgaben** – jede:r kann Aufgaben eintragen, zuweisen, wiederholen und reihum weitergeben; Übersicht pro Person, überfällig/heute/demnächst
- 🗑️ **Müllabfuhr** – Abholplan mit Kalender, „Wer ist dran?“-Rotation, **Bestätigungsfeld „Rausgestellt von …“** für alle sichtbar
- 📅 **Abfallkalender hochladen** – jede:r kann den .ics-Kalender der Stadt hochladen und festlegen, für wen er gilt (ganzes Haus, nur ich, bestimmte Personen)
- 🔔 **Push-Erinnerungen** – z. B. am Vorabend um 18 Uhr: „Gelber Sack rausstellen – du bist dran!“, mit Nachfassen, falls noch niemand bestätigt hat, und Button „✓ Rausgestellt“ direkt in der Mitteilung
- 📌 **Pinnwand** – Beiträge mit **Fotos & Videos**, **Sprachnachrichten**, Umfragen und Ereignisse mit Zu-/Absage; Likes, Emoji-Reaktionen und Kommentare
- 🌗 Hell/Dunkel, offline-fähig, installierbar als App (PWA)

---

## 1. Ausprobieren

```bash
npm start          # oder: python3 -m http.server 8080
```

Dann <http://localhost:8080> öffnen. Ohne weitere Einrichtung läuft die App im **lokalen Modus** (Daten nur auf diesem Gerät).

## 2. Online stellen (GitHub Pages, kostenlos)

1. Repository auf GitHub → **Settings → Pages → Source: „GitHub Actions“**.
2. Auf den Branch `main` pushen – der Workflow `.github/workflows/pages.yml` veröffentlicht die App unter `https://<name>.github.io/<repo>/`.

> HTTPS ist Pflicht für Mikrofon (Sprachnachrichten) und Push – GitHub Pages bringt das mit.

## 3. Gemeinsame Daten (Firebase, kostenlos)

Damit alle dieselben Daten sehen:

1. Auf <https://console.firebase.google.com> ein Projekt anlegen (Google Analytics nicht nötig).
2. **Build → Authentication → Sign-in method → Anonym** aktivieren.
3. **Build → Firestore Database → Datenbank erstellen** (Region z. B. `europe-west3`).
4. Unter **Regeln** den Inhalt von [`firestore.rules`](firestore.rules) einfügen und veröffentlichen.
5. **Projekteinstellungen → Allgemein → „Web-App hinzufügen“** – die angezeigte `firebaseConfig` kopieren.
6. Entweder in [`js/config.js`](js/config.js) bei `FIREBASE_CONFIG` eintragen **oder** in der App unter **Haus → Synchronisierung** einfügen.
7. In der App **Haus → Einladen → Link teilen** – die anderen öffnen den Link und wählen ihr Profil. Fertig! 🎉

Der **Haus-Code** (z. B. `K7QXM-3PZ9A`) ist euer gemeinsamer Schlüssel – nur wer ihn kennt, sieht eure Daten.

## 4. Push-Erinnerungen für die Müllabfuhr

Die Erinnerungen werden **stündlich per GitHub Action** verschickt (`.github/workflows/reminders.yml`) – kein eigener Server und keine Kosten.

1. VAPID-Schlüssel erzeugen:
   ```bash
   npm run vapid
   ```
2. Den **Public Key** in [`js/config.js`](js/config.js) bei `VAPID_PUBLIC_KEY` eintragen (oder in der App unter *Haus → Synchronisierung*).
3. Firebase → **Projekteinstellungen → Dienstkonten → „Neuen privaten Schlüssel generieren“** (JSON-Datei).
4. GitHub → **Settings → Secrets and variables → Actions** → diese Secrets anlegen:

   | Secret | Inhalt |
   | --- | --- |
   | `FIREBASE_SERVICE_ACCOUNT` | kompletter Inhalt der JSON-Datei aus Schritt 3 |
   | `VAPID_PUBLIC_KEY` | Public Key aus Schritt 1 |
   | `VAPID_PRIVATE_KEY` | Private Key aus Schritt 1 (**geheim halten!**) |
   | `VAPID_SUBJECT` | optional, z. B. `mailto:ihr@example.com` |

5. Im selben Bereich unter dem Reiter **Variables** die Variable `PUSH_ENABLED` mit dem Wert `true` anlegen – erst dann startet der stündliche Versand.
6. In der App: **Müll → Erinnerungen einschalten**, Uhrzeit wählen, speichern.

**iPhone/iPad:** Push funktioniert ab iOS 16.4 nur, wenn die App über **Teilen → „Zum Home-Bildschirm“** installiert und von dort geöffnet wurde.

Einstellungen pro Gerät:
- **Wann:** am Vorabend oder am Abholtag, Uhrzeit frei wählbar
- **Wofür:** alle Tonnen, die für mich gelten – oder nur, wenn ich dran bin
- **Nachfassen:** zweite Erinnerung (z. B. 21 Uhr) an die zuständige Person, wenn noch niemand „Rausgestellt“ bestätigt hat

Ohne Push-Einrichtung erinnert die App, solange sie geöffnet ist. Zusätzlich gibt es **„In meinen Kalender exportieren“** (.ics mit Erinnerung).

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Grundgerüst, SVG-Filter für die Glas-Lichtbrechung |
| `css/style.css` | Liquid-Glass-Designsystem (Hell/Dunkel) |
| `js/app.js` | Ansichten, Tab-Leiste mit ziehbarer Glas-Linse, Sheets, Aufnahme |
| `js/store.js` | Datenschicht: lokal (localStorage) oder Firebase Firestore |
| `js/trash-logic.js` | Abholtermine, Rotation, Erinnerungslogik (App **und** Server) |
| `js/ics.js` | iCalendar Import/Export |
| `js/media.js` | Fotos verkleinern, Videos/Fotos stückweise speichern & laden |
| `scripts/send-reminders.mjs` | Push-Versand (GitHub Action) |
| `sw.js` | Offline-Cache, Push-Empfang, „✓ Rausgestellt“ aus der Mitteilung |

Sprachnachrichten (ca. 32 kbit/s, max. ~2–3 Minuten), Fotos (automatisch auf max. 1600 px verkleinert) und Videos (bis 20 MB, in ~1-MB-Stücken) werden direkt in Firestore gespeichert – Firebase Storage (kostenpflichtiger Tarif) ist nicht nötig. Der kostenlose Firestore-Tarif bietet 1 GB Speicher; für viele lange Videos reicht das irgendwann nicht mehr – also lieber kurze Clips teilen.

**Tipp fürs iPhone:** Damit Android-Geräte die Videos abspielen können, unter *Einstellungen → Kamera → Formate* „Maximale Kompatibilität“ wählen (sonst nimmt das iPhone in HEVC auf).
