# NAKLearn für mehrere Personen – Design

Stand: 2026-10-13 · Branch `multiuser` · live erst nach Lunas Prüfung am 2026-10-20

## 1. Ziel

Luna möchte, dass Freunde mit NAKLearn lernen. Inhalte (Module, Foliensätze, Folien,
Karten) sind gemeinsam, damit überschneidende Module nur einmal erzeugt werden.
**Lernstand und Statistik sind persönlich** – niemand beeinflusst die Wiederholungen
oder Zahlen einer anderen Person.

### Erfolgskriterien
- Luna lädt per Link ein; eingeladene Personen wählen Name und Passwort selbst.
- Jede Person wählt ihre Module aus „Alle Module“; Übersicht, Tagesstapel, Statistik
  und Handy umfassen nur die eigenen Module.
- Zwei Personen lernen dieselbe Karte → unabhängige Kartenstände, Fälligkeiten,
  „Heute gelernt“, Serie, Prüfungsdatum, neue Karten pro Tag, „zurückgestellt“.
- In der Android-App meldet man sich mit Name und Passwort an (kein QR-Code mehr).
- Lunas bestehende Daten und ihr gekoppeltes Handy funktionieren nach dem Update
  unverändert weiter, ohne Neu-Koppeln.

### Getroffene Entscheidungen
| Frage | Entscheidung |
|---|---|
| Wer darf Inhalte anlegen/ändern? | Alle (Hochladen, Erzeugen, Bearbeiten, Löschen von Karten) – Luna vertraut den Leuten |
| Was sieht man? | Jede Person wählt ihre Module („Meine Module“) aus „Alle Module“ |
| Konten | Einladungslink, nur der Admin (Luna) lädt ein |
| Handy | Anmelden in der App mit Name + Passwort; Server gibt ein Gerätetoken |
| Datenhaltung | Eine Datenbank; persönliche Tabellen; Server liefert jedem Gerät „seine Sicht“ in den bisherigen Zeilenformaten |

### Nicht Teil dieses Umbaus
Offene Registrierung, Rollen außer Admin, Rechte pro Modul, Chat/Kommentare,
Ranglisten, iOS-App, Offline in der Website, Änderungen an Lernlogik oder Erzeugung.

## 2. Datenmodell

Eigene serverseitige Migrationen (`SERVER_MIGRATIONS` in `apps/server/src/db.ts`, Version in `meta.server_version`); die `core`-Migrationen laufen auch auf dem Handy und bleiben unverändert. Der persönliche Kartenstand liegt in der neuen Tabelle `user_card_state` (`card_state` bleibt für das Handy).

```sql
CREATE TABLE user (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,  -- name_key = lower(trim(name))
  password_hash TEXT NOT NULL, session_epoch INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_seen_at INTEGER
);
CREATE TABLE membership (
  user_id TEXT NOT NULL, module_id TEXT NOT NULL,
  exam_date TEXT, new_per_day INTEGER NOT NULL DEFAULT 20, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, module_id)
);
CREATE TABLE card_flag (
  user_id TEXT NOT NULL, card_id TEXT NOT NULL, suspended INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_id)
);
CREATE TABLE device (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER
);
CREATE TABLE invite (
  token_hash TEXT PRIMARY KEY, user_id TEXT,          -- user_id gesetzt = Passwort-Reset
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
);
ALTER TABLE revlog ADD COLUMN user_id TEXT;
CREATE INDEX revlog_user_card ON revlog(user_id, card_id);
CREATE TABLE user_card_state (
  user_id TEXT NOT NULL, card_id TEXT NOT NULL, json TEXT NOT NULL, first_reviewed_at INTEGER,
  PRIMARY KEY (user_id, card_id)
);
```

- `module.exam_date` / `module.new_per_day` und `card.suspended` werden nicht mehr
  gelesen (Spalten bleiben, SQLite).
- **Gemeinsam:** `module` (Name, Sprache, gelöscht), `deck`, `slide`, `note`, `card`
  (gelöscht), `job`.
- **Persönlich:** `membership`, `card_flag`, `revlog` (über `user_id`), `card_state`,
  `device`.
- Passwörter: `scrypt` (node:crypto) mit zufälligem Salt, gespeichert als
  `scrypt$N$r$p$salt$hash` (base64url). Gerätetokens und Einladungstokens: 32
  Zufallsbytes base64url, gespeichert nur als SHA-256.

## 3. Übernahme der bestehenden Daten

Beim Start prüft der Server nach den Migrationen: gibt es noch **keinen** `user`?
Dann, in einer Transaktion, nachdem eine Sicherung
`/data/backups/pre-multiuser-YYYY-MM-DD.db` (`VACUUM INTO`) geschrieben wurde:

1. Admin-Konto anlegen: Name aus `NAKLEARN_ADMIN` (Standard `luna`), Passwort aus
   `NAKLEARN_PASSWORD` (Pflicht für diesen ersten Start; fehlt es, bricht der Start mit
   klarer Meldung ab).
2. `revlog.user_id` und `card_state.user_id` → Admin für alle bestehenden Zeilen.
3. Für jedes nicht gelöschte Modul eine `membership` des Admins mit dem bisherigen
   `exam_date`/`new_per_day`.
4. Für jede Karte mit `suspended = 1` ein `card_flag` des Admins.
5. Das bisherige `token` aus `config.json` wird ein `device` des Admins
   („Bisheriges Handy“).

Danach wird `NAKLEARN_PASSWORD` nicht mehr gebraucht (Login über die Datenbank).
`config.json` behält `sessionSecret` und `deviceId`; `token` wird nicht mehr gelesen.

## 4. Konten, Login, Einladungen, Geräte

### Sitzung (Browser)
- `POST /api/login {name, password}` → Cookie `naklearn_session=<userId>.<ablauf>.<hmac>`.
  HMAC-Schlüssel: `sessionSecret` + `userId` + `session_epoch` der Person. Passwort
  ändern/zurücksetzen erhöht `session_epoch` → alle Sitzungen dieser Person ungültig.
- Login-Bremse wie bisher (5 Fehlversuche pro Client-IP → 15 min 429, Cloudflare-IP
  über `CF-Connecting-IP`); gilt für Browser- und App-Login gemeinsam.
- Gleiche Fehlermeldung für unbekannten Namen und falsches Passwort
  („Name oder Passwort falsch“); für unbekannte Namen wird trotzdem ein scrypt-Vergleich
  gegen einen Dummy-Hash gerechnet (keine Aufzählung über die Antwortzeit).

### Gerät (App)
- `POST /api/device/login {name, password, deviceName}` → `{token, user: {id, name}}`;
  legt ein `device` an. Gleiche Bremse und Fehlermeldung wie oben.
- `Authorization: Bearer <token>` → Person über `device.token_hash`; aktualisiert
  `device.last_seen_at` (höchstens einmal pro Minute).
- Gerät entfernen löscht die Zeile → Token sofort ungültig (App zeigt „bitte neu anmelden“).

### Einladen und Zurücksetzen (nur Admin)
- `POST /api/invites` → `{url}` mit `https://naklearn.torte-tech.de/#/einladung/<token>`,
  7 Tage gültig, einmal benutzbar.
- `POST /api/users/:id/reset` → derselbe Link-Typ mit `invite.user_id` gesetzt.
- `GET /api/invites/:token` (ohne Login) → `{kind: 'invite' | 'reset', name?}` oder 404
  (unbekannt, abgelaufen, benutzt).
- `POST /api/invites/:token/accept {name?, password}` (ohne Login): Einladung → neues
  Konto (Name 2–30 Zeichen, `name_key` eindeutig, Passwort ≥ 8 Zeichen); Reset → neues
  Passwort, `session_epoch + 1`. Setzt `used_at`, meldet an (Cookie). Unterliegt der
  Login-Bremse bei ungültigem Token.

### Konto und Personen
- `GET /api/me` → `{id, name, isAdmin}`.
- `POST /api/me/password {old, new}` → `session_epoch + 1`, neues Cookie für die
  aktuelle Sitzung.
- `GET /api/me/devices`, `DELETE /api/me/devices/:id`.
- Admin: `GET /api/users` (Name, zuletzt aktiv, Anzahl Module/Geräte),
  `DELETE /api/users/:id` (nicht sich selbst): löscht `membership`, `card_flag`,
  `card_state`, `device`, `revlog` der Person und das Konto; gemeinsame Inhalte bleiben.

## 5. Module: Auswahl und Rechte

- `GET /api/modules/all` → alle nicht gelöschten Module mit `memberCount` und `mine`.
- `POST /api/modules/:id/join`, `POST /api/modules/:id/leave`.
- `POST /api/modules` (Anlegen) → automatisch `membership` der anlegenden Person.
- `PATCH /api/modules/:id`: `name`/`language` gemeinsam; `examDate`/`newPerDay` in die
  `membership` der Person (nur wenn Mitglied).
- `DELETE /api/modules/:id`: nur erlaubt, wenn außer der anfragenden Person niemand
  Mitglied ist (sonst 409 „Andere lernen dieses Modul – nur aus deinen Modulen entfernen“).
- Alle anderen Inhaltsaktionen (Hochladen, Erzeugen, Neu erzeugen, Karten bearbeiten,
  löschen) dürfen alle angemeldeten Personen. „Zurückstellen“ (`/api/cards/:id/suspend`)
  schreibt `card_flag` der Person.
- Übersicht, Lernen (`/api/study/*`), Karten durchsuchen, Statistik: nur Module mit
  `membership` der Person, Kartenstand aus `card_state` der Person, Zähler aus `revlog`
  der Person.

## 6. Sync

### Push (Gerät → Server), Person aus dem Token
- **Module:** `name`, `language` per Last-Writer-Wins wie bisher; `examDate`,
  `newPerDay` → `membership` der Person (LWW über `membership.updated_at`).
  `deleted = true` → wie „Aus meinen Modulen entfernen“; ist danach niemand mehr
  Mitglied, wird das Modul auch gemeinsam gelöscht.
- **Karten:** `suspended` → `card_flag` (LWW über `card_flag.updated_at`); `deleted`
  gemeinsam wie bisher.
- **Notizen:** gemeinsam wie bisher.
- **Bewertungen:** `user_id` = Person; `card_state` nur für (Person, Karte) neu berechnen.

### Pull (Server → Gerät): „Sicht der Person“
Gleiches Protokoll (`cursor`, Seiten à 2000, `hasMore`), gleiche Zeilenformate:
- `deck`/`slide`/`note`/`card`-Zeilen nur aus Modulen mit `membership` der Person.
- `module`-Zeilen: Mitglied → mit `examDate`/`newPerDay` aus der `membership`;
  kein Mitglied → `deleted: true` (räumt abgewählte Module auf dem Gerät weg).
- `card`-Zeilen mit `suspended` aus `card_flag` der Person (fehlend = false).
- `revlog` nur mit `user_id` der Person.
- **Neu nummerieren** (neue `seq`), damit Geräte Änderungen ziehen:
  - `join`: alle Zeilen des Moduls (`module`, `deck`, `slide`, `note`, `card`) – so
    bekommt das Gerät auch den alten Inhalt;
  - `leave`, `membership`-Änderung: die `module`-Zeile;
  - `card_flag`-Änderung: die `card`-Zeile.
  Andere Geräte mit demselben Modul ziehen diese Zeilen erneut – harmlos (Upsert);
  vorhandene Folienbilder werden nicht neu geladen.

## 7. Android-App

- Einstellungen: „Anmelden“ (Name, Passwort; Adresse voreingestellt
  `https://naklearn.torte-tech.de`, unter „Erweitert“ änderbar) statt QR-Code/Token.
  Gespeichert werden Adresse, Token, Name – nie das Passwort.
- „Abmelden“: erst Sync versuchen; gibt es danach noch nicht synchronisierte
  Bewertungen, Rückfrage („X Bewertungen gehen verloren“). Dann lokale Daten und
  Folienbilder löschen, Token vergessen.
- HTTP 401 beim Sync → Status „Abgemeldet – bitte neu anmelden“ (Gerät entfernt).
- QR-Scanner-Plugin (`@capacitor-mlkit/barcode-scanning`) entfällt.
- Lernlogik und lokale Datenbank unverändert.
- Neue Version **v0.3.0**. Lunas v0.2.0 synchronisiert mit ihrem migrierten Token
  weiter.

## 8. Web-Oberfläche

- Kopfzeile: Name, „Konto“, für Admin „Personen“, „Abmelden“.
- Übersicht: „Meine Module“ (wie bisher, persönliche Zahlen), Link „Alle Module“.
- „Alle Module“: Liste mit „Hinzufügen“/„Entfernen“ und „N lernen das“; nach dem
  ersten Login einer neuen Person die Startseite, solange sie keine Module hat.
- Modulseite: persönliches Prüfungsdatum/neue Karten pro Tag, „Aus meinen Modulen
  entfernen“, „Für alle löschen“ nur wenn einziges Mitglied.
- Login-Seite: Name + Passwort.
- Einladungs-/Reset-Seite `#/einladung/<token>`: Name (nur bei Einladung) + Passwort
  (zweimal), Fehler für abgelaufene/benutzte Links.
- Konto-Seite: Passwort ändern, „Meine Handys“ (Name, zuletzt synchronisiert,
  Entfernen), Hinweis auf die App (GitHub Releases) bzw. die Website im Browser.
- Personen-Seite (Admin): Liste, „Person einladen“ (Link zum Kopieren),
  „Link zum Zurücksetzen“, „Konto löschen“ (Rückfrage).
- Die Koppeln-Seite mit QR-Code entfällt.

## 9. Einführung

- Entwicklung auf Branch `multiuser`; **kein Merge in `main` vor dem 2026-10-21**
  (Push auf `main` deployt sofort).
- Nach dem Merge: CI deployt; erster Start migriert (§3) mit automatischer Sicherung.
  Prüfen: Luna meldet sich mit `luna` + bisherigem Passwort an, Zahlen unverändert,
  ihr Handy (v0.2.0) synchronisiert weiter.
- Danach `npm run release minor` → v0.3.0; Luna lädt die erste Person ein.

## 10. Tests

- **core:** Migration 2 auf leerer und auf bestehender DB.
- **server (Vitest):**
  - Übernahme (§3): alle bestehenden Daten beim Admin, altes Token als Gerät,
    Sicherung geschrieben; zweiter Start ändert nichts.
  - Trennung: zwei Personen bewerten dieselbe Karte → unabhängige `card_state`,
    Übersicht, „Heute gelernt“, Serie; persönliche Moduleinstellungen und
    „zurückgestellt“ bleiben persönlich.
  - Konten: Einladung (nur Admin, 7 Tage, einmalig, Name eindeutig, Passwortlänge),
    Reset (beendet Sitzungen), Passwort ändern, Login mit falschem Namen/Passwort
    gleiche Meldung, Bremse für Browser- und App-Login, Gerät entfernen → 401,
    Konto löschen (nicht sich selbst, nur Admin).
  - Module: Anlegen → Mitglied; Löschen nur als einziges Mitglied (sonst 409);
    `all`/`join`/`leave`.
  - Sync: Join liefert alten Inhalt; Leave liefert `deleted`; fremde Bewertungen
    werden nie geliefert; Push trennt persönliche/gemeinsame Felder; Modul-„Löschen“
    vom Gerät = Leave.
  - Ende-zu-Ende: zwei LocalStores mit zwei Konten am selben Server lernen offline
    dasselbe Modul und synchronisieren → je eigener Stand, gemeinsame Karteninhalte.
- **client:** App-Login/-Logout (Token gespeichert, lokale Daten gelöscht, Rückfrage
  bei ungesyncten Bewertungen), 401 → abgemeldet; Web: 401 → Login-Seite.
- **Abnahme:** Luna + Testkonto, je im Browser und in der App: einladen, Modul wählen,
  dieselbe Karte lernen, Zahlen getrennt; Gerät entfernen; Reset-Link.
