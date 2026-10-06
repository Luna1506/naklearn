# kartei – Design

**Datum:** 2026-10-06
**Status:** Entwurf zur Review

## 1. Ziel

Eine Lernkarten-App für Luna, mit der sie effektiv für Uni-Prüfungen lernen kann
(Anlass: Midterm in UI/UX Design, 8 Foliensätze als PDF). Aus Foliensätzen werden
mit Lunas Claude-Account sehr ausführliche Lernkarten erzeugt; gelernt wird mit
Spaced Repetition wie in Anki – auf dem Handy (Android, offline) und am Laptop.

### Erfolgskriterien
- Die 8 UIUX-Foliensätze ergeben ein vollständiges, prüfungstaugliches Kartenset
  (englisch), ohne dass Luna Karten von Hand schreiben muss.
- Luna kann auf dem Handy ohne Netz lernen; Fortschritt von Handy und Laptop
  wird ohne Verlust und ohne Konflikte zusammengeführt.
- Ein täglicher Stapel sorgt dafür, dass bis kurz vor dem Prüfungstermin alle
  Karten gesehen und gefestigt sind.
- Weitere Module und Foliensätze lassen sich jederzeit hinzufügen.

### Getroffene Entscheidungen
| Thema | Entscheidung |
|---|---|
| Plattformen | Laptop (Web-UI, NixOS) + Android-App |
| Handy | Offline-first, Sync mit dem Laptop bei Erreichbarkeit |
| Verbindung | Tailscale |
| Upload | Nur am Laptop (v1) |
| Prüfungsformat | Mischung → gemischte Kartentypen |
| Kartensprache | Pro Modul wählbar; UIUX = Englisch |
| Folienbilder | Vorschau auf jeder Rückseite + Diagramm-Karten mit Bild auf der Vorderseite |
| Tagesstapel | Anki-Logik + Prüfungsmodus pro Modul |
| Architektur | Eine TypeScript-Codebasis (Ansatz A), Android via Capacitor |
| Kartenerzeugung | `claude -p` (headless Claude Code, Lunas Abo), kein MCP-Server in v1 |

### Nicht in v1
Upload vom Handy, MCP-Server („mach mehr Karten zu X“), iOS, FSRS-Parameter-
Optimierung, Anki-Import/-Export, mehrere Nutzer.

## 2. Architektur

```
┌──────────────── Laptop (NixOS) ────────────────┐        ┌──── Android ────┐
│ systemd --user: kartei-server (Fastify)        │        │ kartei (Capacitor)│
│  ├─ SQLite  ~/.local/share/kartei/kartei.db    │  sync  │  ├─ SQLite lokal  │
│  ├─ PDF-Pipeline (pdftoppm, pdftotext)         │◄──────►│  ├─ Folienbilder  │
│  ├─ Job-Queue → `claude -p`                    │ Tail-  │  └─ core (FSRS,  │
│  ├─ REST-API + Sync-API                        │ scale  │     Stapel)      │
│  └─ liefert Web-Client aus (Studio + Lernen)   │        └──────────────────┘
└────────────────────────────────────────────────┘
```

### Monorepo (pnpm workspaces), `~/projects/kartei`
| Paket | Zweck | Abhängigkeiten |
|---|---|---|
| `packages/core` | Domänentypen, zod-Schemas (inkl. Sync-Protokoll), FSRS-Wrapper + Prüfungsmodus, Stapel-Bildung, Revlog-Replay, Statistik. Reine Funktionen, kein I/O. | `ts-fsrs`, `zod` |
| `packages/ui` | React-Lernkomponenten (Lernansicht, Bewertungsleiste, Markdown, Folien-Viewer, Übersicht). Spricht nur mit dem Interface `StudyDataSource`. | `core`, React |
| `apps/server` | Fastify-Server: DB, Migrationen, PDF-Pipeline, Claude-Runner, Job-Queue, REST/Sync-API, Backups, statische Auslieferung des Web-Builds. | `core`, `better-sqlite3`, `fastify` |
| `apps/client` | Vite + React. Build-Variante `web` (Studio + Lernen, `HttpDataSource`) und `android` (Lernen, Sync, Koppeln, `LocalDataSource` auf SQLite). Enthält das Capacitor-Android-Projekt. | `core`, `ui`, Capacitor |

Die Lern- und Planungslogik existiert nur in `core`. Der Server nutzt sie für die
Web-UI, die Android-App lokal – beide verhalten sich dadurch identisch.

## 3. Datenmodell

Gleiches Schema auf Server und Handy (SQLite). Alle IDs sind UUIDv7. Jede
synchronisierte Zeile hat `updated_at` (ms) und auf dem Server zusätzlich `seq`
(globaler, monoton steigender Änderungszähler).

- **module** – `id, name, language ('en'|'de'), exam_date (YYYY-MM-DD|null),
  new_per_day (default 20), deleted, updated_at`
- **deck** (Foliensatz) – `id, module_id, title, pdf_sha256, page_count,
  status ('pending'|'rendering'|'generating'|'ready'|'error'), error,
  position, deleted, updated_at`
- **slide** – `deck_id, page (1-basiert), text, image (Dateiname .webp)`;
  Primärschlüssel `(deck_id, page)`
- **note** (Inhalt) – `id, deck_id, kind ('qa'|'cloze'|'diagram'), front, back
  (Markdown; bei cloze enthält front `{{c1::…}}`-Lücken), slide_refs (JSON int[]),
  front_image_page (int|null, nur diagram), tags (JSON string[]), source
  ('chunk'|'synthesis'|'manual'), position, deleted, updated_at`
- **card** (lernbare Einheit) – `id, note_id, ordinal (Lücken-Nr. bzw. 0),
  suspended, deleted, updated_at`. qa/diagram → 1 Karte; cloze → 1 Karte je
  Lücken-Nummer.
- **revlog** – `id, card_id, rating (1–4), reviewed_at (ms), duration_ms,
  device_id, revokes (revlog-id|null)`. Append-only. Rückgängig = neuer Eintrag
  mit `revokes` = id der zurückgenommenen Bewertung (rating dann 0).
- **card_state** (nur lokaler Cache, wird nicht synchronisiert) – FSRS-Felder
  (`due, stability, difficulty, state, reps, lapses, last_review, …`),
  jederzeit aus revlog rekonstruierbar.
- **meta** – Key/Value: `device_id`, `sync_cursor`, `server_url`, `token`,
  `schema_version`.

Server-only: **job** (`id, deck_id, kind ('render'|'chunk'|'synthesis'),
chunk_from, chunk_to, status, attempts, error, result_json, created_at`).

Dateien: `~/.local/share/kartei/{kartei.db, pdfs/<sha256>.pdf,
slides/<deck_id>/<page>.webp, backups/, config.json}`.

## 4. Kartenerzeugung

### Pipeline
1. **Upload** (Studio, Drag & Drop, mehrere PDFs auf einmal) in ein Modul.
   SHA-256 berechnen; gleiche PDF im selben Modul → Ablehnung mit Hinweis.
   Titel = Dateiname ohne Endung (editierbar).
2. **Render-Job:** `pdftoppm -r 110` → PNG → WebP (Breite ≤ 1280 px, `sharp`),
   `pdftotext -layout -f N -l N` je Seite. Speichert `slide`-Zeilen.
3. **Chunk-Jobs:** Folien in Abschnitte zu 15 Seiten. Pro Abschnitt ein
   `claude -p`-Aufruf (Details unten).
4. **Synthese-Job:** ein Aufruf mit dem Gesamttext des Foliensatzes und der
   Liste aller bisher erzeugten Vorderseiten (mit note-ids). Liefert
   (a) zusätzliche folienübergreifende/prüfungstypische Karten und
   (b) note-ids von Duplikaten, die entfernt werden.
5. Karten sind sofort aktiv. Deck-Status `ready`.

### Claude-Aufruf
```
claude -p <prompt> --output-format json --allowedTools Read \
       --add-dir <slides/<deck_id>> [--model <config.claudeModel>]
```
- Läuft als User `luna` und nutzt deren eingeloggte Claude-Code-Session.
- Arbeitsverzeichnis: ein leeres temporäres Verzeichnis; Claude darf nur lesen.
- Prompt enthält: Modulsprache, Foliensatztitel, Gliederung (erste Zeile jeder
  Folie), den Text der Folien des Abschnitts mit Seitennummer, die absoluten
  Pfade der Folienbilder (Claude soll Folien mit Diagrammen/Abbildungen ansehen),
  Qualitätsregeln und das JSON-Ausgabeschema.
- Qualitätsregeln: Titel-/Agenda-/Organisationsfolien überspringen; pro inhaltlicher
  Folie ca. 1–3 Karten; Antworten ausführlich (Definition, Erklärung, Beispiel,
  ggf. Abgrenzung), aber eine Karte = ein Lernziel; Mischung aus Definitions-,
  Erklär-, Vergleichs- und Aufzähl-Fragen (qa), Lückentexten (cloze) für
  Merksätze/Listen und Diagramm-Karten für aussagekräftige Abbildungen;
  Fachbegriffe exakt wie auf den Folien.
- Ausgabeschema (zod-validiert, aus dem `result`-Feld des JSON-Outputs extrahiert;
  ein ```json-Block wird ebenfalls akzeptiert):
  ```json
  { "notes": [ { "kind": "qa|cloze|diagram", "front": "…", "back": "…",
                 "slides": [12, 13], "frontImagePage": 12, "tags": ["…"] } ] }
  ```
  Synthese zusätzlich: `"removeNoteIds": ["…"]`.
- Timeout 10 min pro Aufruf.

### Warteschlange und Fehler
- Ein Worker, Jobs strikt nacheinander (schont das Rate-Limit). Zustand in der
  `job`-Tabelle → nach Neustart wird fortgesetzt.
- Ungültiges/fehlendes JSON → bis zu 2 Wiederholungen, dann Job `failed`;
  übrige Jobs laufen weiter. Studio: „Erneut versuchen“ pro Job.
- Exit-Code/Output deutet auf fehlenden Login → Queue pausiert, Studio zeigt
  „`claude` ist nicht eingeloggt – bitte `claude` im Terminal starten“.
- Rate-Limit erkannt → Queue pausiert mit Backoff (5 min, 15 min, 60 min).
- Render-Fehler → Deck `error` mit Meldung.
- Fortschritt live im Studio (Polling alle 2 s): „Abschnitt 3/5 …“.

### Neu erzeugen
„Foliensatz neu erzeugen“ löscht (soft) alle Notes des Decks, deren Karten noch
keine Bewertung haben, und erzeugt neu. Bewertete Karten bleiben erhalten.

## 5. Planung (core)

### FSRS
`ts-fsrs` mit `request_retention 0.9`, `enable_fuzz true`,
`enable_short_term true`, Lernschritte `1m, 10m`, Wiederlernschritt `10m`,
Standardparameter. Die Bewertungsknöpfe zeigen das jeweils resultierende
Intervall (`<10m`, `1d`, `3d`, …).

### Replay
Kartenzustand = Faltung aller revlog-Einträge der Karte, sortiert nach
`(reviewed_at, id)`, ohne zurückgenommene Einträge. Deterministisch: gleiche
Einträge in beliebiger Ankunftsreihenfolge ⇒ identischer Zustand. Nach jedem
Sync werden die Karten mit neuen Einträgen neu berechnet.

### Tagesgrenze
Ein Lerntag beginnt um 04:00 Uhr Gerätezeit.

### Prüfungsmodus (Modul mit `exam_date` in der Zukunft)
- **Effektive Fälligkeit** (zur Abfragezeit berechnet, nicht gespeichert):
  Liegt die FSRS-Fälligkeit nach `exam_date − 1 Tag`, wird sie auf einen der
  letzten 3 Tage vor der Prüfung gelegt; welcher, bestimmt `hash(card_id) mod 3`
  (gleichmäßig verteilt, deterministisch). Ändert sich das Prüfungsdatum, passt
  sich alles automatisch an.
- **Neue Karten heute:**
  `ziel = max(new_per_day, ceil(neu_übrig / max(1, tage_bis(exam_date − 3))))`,
  davon abgezogen die heute in diesem Modul bereits eingeführten Karten.
  `ziel > 60` → Warnung im Modul.
- Nach dem Prüfungsdatum: normales Verhalten ohne Obergrenze.

### Stapel
- **Heute (alle Module)** und **Modul X** (optional eingeschränkt auf
  **Foliensatz Y**).
- Reihenfolge: (1) fällige Lern-/Wiederlernkarten; (2) fällige Wiederholungen,
  Module mit näherer Prüfung zuerst, innerhalb nach Überfälligkeit; (3) neue
  Karten, in Folienreihenfolge (deck.position, note.position, ordinal),
  verteilt zwischen die Wiederholungen (jede 4. Karte eine neue, solange
  vorhanden).
- **Learn-ahead:** Ist sonst nichts übrig, werden Lernkarten bis zu 20 min vor
  Fälligkeit gezeigt.
- **Geschwister vergraben:** Wurde heute eine Karte einer Note gelernt, kommen
  ihre Geschwister (andere Lücken) erst am nächsten Tag.
- Pausierte und gelöschte Karten werden nie gezeigt.

### Statistik
Heute gelernt, Serie (aufeinanderfolgende Tage mit ≥ 1 Bewertung), pro Modul:
Anzahl neu/lernend/Wiederholung, „X % gesehen, Y Tage bis zur Prüfung“,
heute fällig.

## 6. Oberflächen

### Studio (Web, Laptop)
- **Start:** Module mit Statistik, „Heute lernen“, „Neues Modul“.
- **Modul:** Einstellungen (Name, Sprache, Prüfungsdatum, neue Karten/Tag),
  Foliensätze (Status, Fortschritt), PDF-Upload, „Modul lernen“.
- **Foliensatz:** Job-Fortschritt, Fehler mit „Erneut versuchen“,
  Karten-Liste mit Folienbild, „Neu erzeugen“, „Lernen“.
- **Karten-Browser:** Suche über Vorder-/Rückseite, Filter nach Modul,
  Foliensatz, Typ; Bearbeiten (Markdown mit Vorschau), Pausieren, Löschen.
- **Koppeln:** QR-Code mit `{ url, token }`.
- **Lernen:** gemeinsame Komponente aus `ui`.

### Android-App
- **Start:** Heute-Stapel mit Zahlen, Module-Liste, Sync-Status
  („Zuletzt synchronisiert vor 2 h“), Pull-to-Refresh.
- **Modul:** Statistik, Prüfungsdatum/neue Karten pro Tag, Foliensätze →
  gezielt lernen.
- **Lernen:** gemeinsame Komponente.
- **Einstellungen:** Koppeln per QR-Scan, manueller Sync, Server-Adresse.

### Lernansicht (gemeinsam)
Vorderseite (bei Diagramm-Karten mit Folienbild) → „Antwort zeigen“ →
Rückseite (Markdown) + Folienvorschau der Quellfolien (Tipp/Klick → Vollbild
mit Zoom) → vier Knöpfe mit Intervallen. Tastatur: Leertaste = Antwort zeigen /
„Gut“, `1`–`4` = Bewertung, `z` = Rückgängig, `e` = Bearbeiten, `p` = Pausieren.
Lücken: Vorderseite zeigt `[…]` an der aktiven Lücke, andere Lücken im Klartext;
Rückseite zeigt den vollständigen Text mit hervorgehobener Lücke, darunter `back`
als optionale Zusatzerklärung.

## 7. Sync

### Transport und Auth
- Server lauscht auf Port **8742**. Firewall-Freigabe nur auf `tailscale0`.
- Requests von Loopback (Web-UI am Laptop) brauchen kein Token, alle anderen
  `Authorization: Bearer <token>`. Token wird beim ersten Start erzeugt
  (32 Byte, base64url) und liegt in `config.json`.
- QR-Code enthält `http://<magicdns-hostname>:8742` und Token. HTTP genügt, da
  Tailscale (WireGuard) verschlüsselt; die Android-App erlaubt Cleartext nur für
  diese Server-Adresse (Network Security Config: `*.ts.net` und `100.64.0.0/10`).

### Protokoll
`POST /api/sync`
```
Request:  { deviceId, cursor,
            push: { revlog: Revlog[], notes: Note[], cards: Card[], modules: Module[] } }
Response: { cursor,
            pull: { modules, decks, slides, notes, cards, revlog } }
```
- Server übernimmt `push` idempotent: revlog per id `INSERT OR IGNORE`;
  notes/cards/modules nur, wenn `updated_at` neuer als der Serverstand
  (Last-Writer-Wins pro Zeile). Jede übernommene Änderung erhält ein neues `seq`.
- `pull` enthält alle Zeilen mit `seq > cursor` (auch die eigenen – harmlos,
  da idempotent); `cursor` = höchstes `seq`.
- Seitengröße 2000 Zeilen; `hasMore` → Client wiederholt.
- Der Client merkt sich, welche lokalen Änderungen noch nicht bestätigt sind
  (`dirty`-Flag), und markiert sie nach erfolgreicher Antwort als synchron.

`GET /api/slides/:deckId/:page.webp` – Folienbilder. Das Handy lädt nach dem
Sync alle fehlenden Bilder in den App-Speicher (Capacitor Filesystem).

### Auslöser
App-Start, Ende jeder Lernsitzung, alle 5 min im Vordergrund, Pull-to-Refresh,
Knopf. Fehler werden still wiederholt; der Status zeigt den letzten Erfolg.

## 8. NixOS-Integration und Build

### Projekt-Flake (`~/projects/kartei/flake.nix`)
- `packages.x86_64-linux.default` – Server + Web-Build (pnpm), Wrapper mit
  `poppler-utils` im `PATH`.
- `homeManagerModules.default` – `services.kartei = { enable; port (8742);
  dataDir (~/.local/share/kartei); claudePath (~/.local/bin/claude);
  claudeModel (null) }` → `systemd.user.services.kartei` (Restart=on-failure).
- `devShells.default` – Node 22, pnpm, JDK 21, `ANDROID_HOME=~/Android/Sdk`,
  Gradle-Override für `aapt2` aus dem SDK (Mavens aapt2 läuft unter NixOS nicht).

### Dotfiles (`~/nixos/dotfiles`)
- Input `kartei` (zunächst `path:/home/luna/projects/kartei`).
- Home-Manager: `services.kartei.enable = true;`
- NixOS: `services.tailscale.enable = true;`,
  `networking.firewall.interfaces.tailscale0.allowedTCPPorts = [ 8742 ];`
- Anwenden über Lunas `rebuild`-Skript.

### Android
`pnpm android:build` (Vite-Build Variante `android` → `cap sync` →
`gradlew assembleDebug`), Installation per `adb install`. App-ID
`de.luna.kartei`. Plugins: `@capacitor-community/sqlite`,
`@capacitor/filesystem`, `@capacitor-mlkit/barcode-scanning`.

### Backups
Täglich beim ersten Start/um 04:00: `VACUUM INTO backups/kartei-YYYY-MM-DD.db`,
die letzten 7 bleiben.

### Migrationen
Nummerierte SQL-Migrationen in `core` (gemeinsam für Server und Handy),
`schema_version` in `meta`.

## 9. Tests

- **core (Vitest):** Intervalle je Bewertung inkl. Lernschritte; Prüfungs-
  Obergrenze und Verteilung auf 3 Tage; Neue-Karten-Formel inkl. Warnschwelle;
  Stapelreihenfolge, Learn-ahead, Geschwister vergraben; Replay mit Rückgängig;
  **Eigenschaftstest:** zufällige revlog-Mengen in permutierter Reihenfolge
  ⇒ identischer Zustand; Tagesgrenze 04:00.
- **server (Vitest):** Pipeline mit kleiner Test-PDF und **Fake-claude**
  (Skript mit festem JSON, auch ungültigem JSON und Login-Fehler); Job-
  Wiederaufnahme nach Neustart; Sync mit zwei simulierten Geräten (offline
  gelernt, gleichzeitige Bearbeitung, Rückgängig über Geräte hinweg);
  Auth (Loopback vs. Token).
- **client:** Tests für `LocalDataSource`-Sync-Logik gegen einen In-Memory-
  Server; Lernansicht-Komponententest.
- **Abnahme:** Die 8 UIUX-Foliensätze echt erzeugen und Stichproben prüfen;
  App im Android-Emulator und auf Lunas Handy; Offline lernen → Sync → Laptop
  zeigt denselben Stand.
