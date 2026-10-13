# NAKLearn für mehrere Personen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mehrere Personen lernen mit eigenen Konten in einer NAKLearn-Instanz: Inhalte gemeinsam, Lernstand/Statistik/Einstellungen persönlich; Einladung per Link; Anmeldung in der Android-App mit Name und Passwort.

**Architecture:** Neue, nur serverseitige Migrationen (Konten, Mitgliedschaften, persönlicher Kartenstand, Geräte, Einladungen) neben den gemeinsamen `core`-Migrationen. Jede Anfrage bekommt eine Person (Sitzungs-Cookie mit Benutzer-ID und `session_epoch`, oder Gerätetoken); Lernen, Übersicht und Sync arbeiten mit der `userId`. Der Sync liefert jedem Gerät „seine Sicht“ in den bisherigen Zeilenformaten, sodass Lernlogik und lokale Datenbank der App unverändert bleiben.

**Tech Stack:** Node 24 (TypeScript direkt), Fastify 5, node:sqlite, node:crypto (scrypt), React 19 + Vite, Capacitor 8, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-naklearn-multiuser-design.md`

## Global Constraints

- Branch `multiuser`; **kein Merge in `main` vor dem 2026-10-21** (Push auf `main` deployt sofort auf torte).
- Gemeinsam: `module` (Name, Sprache, gelöscht), `deck`, `slide`, `note`, `card` (gelöscht), `job`. Persönlich: `membership`, `card_flag`, `user_card_state`, `revlog.user_id`, `device`.
- Passwörter: scrypt (`N=16384, r=8, p=1`, 16 Byte Salt, 32 Byte Hash), Format `scrypt$N$r$p$salt$hash` (base64url). Tokens: 32 Zufallsbytes base64url, gespeichert nur als SHA-256 (base64url).
- Name 2–30 Zeichen (getrimmt), eindeutig über `lower(trim(name))`; Passwort mindestens 8, höchstens 200 Zeichen.
- Einladungs-/Reset-Links: `<publicUrl>/#/einladung/<token>`, 7 Tage gültig, einmal benutzbar; nur Admin erzeugt sie.
- Login-Fehlermeldung immer „Name oder Passwort falsch“; Bremse 5 Fehlversuche/IP → 15 min 429 (bestehender `LoginLimiter`, `clientIp`), gilt für Browser-, App-Login und ungültige Einladungslinks.
- Ein neues Passwort (ändern oder zurücksetzen) erhöht `session_epoch` → alle Sitzungen der Person ungültig.
- Modul „für alle löschen“ nur, wenn außer der anfragenden Person niemand Mitglied ist (sonst 409).
- Erststart-Übernahme: Admin `NAKLEARN_ADMIN` (Standard `luna`) mit `NAKLEARN_PASSWORD`; vorher Sicherung `backups/pre-multiuser-YYYY-MM-DD.db`.
- UI-Texte deutsch; Code-Kommentare deutsch, knapp; Stil der bestehenden Dateien.
- Tests: `nix develop -c npm test` (core/server/store mit `TZ=Asia/Seoul`), `nix develop -c npm run typecheck`. Kein TypeScript-Syntax, der nicht „erasable“ ist (keine Parameter-Properties, keine Enums).
- Nach Änderungen an `package-lock.json`: `npmDepsHash` in `flake.nix` aktualisieren (`nix develop -c prefetch-npm-deps package-lock.json`).
- Kartenerzeugung/Lernlogik nicht verändern.

## Review Focus

1. **Spät gewähltes Modul auf dem Handy:** Person B wählt ein Modul, dessen Inhalte längst existieren und deren `seq` unter B's Cursor liegen → B's Handy muss trotzdem alle Foliensätze, Folien, Notizen und Karten bekommen → Test in Task 6 („Join liefert alten Inhalt“).
2. **Kontowechsel auf einem Handy:** Jemand meldet sich in der App als andere Person an, ohne sich vorher abzumelden → lokale Daten der vorherigen Person dürfen sich nicht mit denen der neuen mischen → Test in Task 8 („anderer Name löscht vorher lokale Daten“).
3. **Gerät entfernt, App synchronisiert weiter:** Nach „Entfernen“ in „Meine Handys“ antwortet `/api/sync` mit 401 → die App zeigt „Abgemeldet – bitte neu anmelden“, statt in einer Fehlerschleife zu hängen → Test in Task 8.
4. **Gleichzeitige Einladungsannahme:** Ein Link wird zweimal abgeschickt (Doppelklick, zwei Tabs) → genau ein Konto, zweiter Versuch 404 → Test in Task 2 („Link nur einmal“).
5. **Fremde Bewertungen beim Kartenstand:** Eine Bewertung von Person A darf B's Kartenstand nie verändern, auch nicht über `applyPush` mit A's Gerät oder über `undo` mit A's revlog-ID durch B → Tests in Task 5 und Task 6.

---

## Dateiübersicht

| Datei | Aktion | Verantwortung |
|---|---|---|
| `apps/server/src/db.ts` | ändern | `SERVER_MIGRATIONS`, `migrateServer`, `openDb` wendet beide an |
| `apps/server/src/password.ts` | neu | scrypt-Hash/-Prüfung, `DUMMY_HASH` |
| `apps/server/src/accounts.ts` | neu | Konten, Geräte, Einladungen (reine DB-Logik) |
| `apps/server/src/bootstrap.ts` | neu | Erststart: Admin anlegen, bestehende Daten zuordnen |
| `apps/server/src/config.ts` | ändern | `password` optional, `adminName`; `rotateToken` entfällt |
| `apps/server/src/main.ts` | ändern | Bootstrap aufrufen |
| `apps/server/src/auth.ts` | ändern | Sitzungen mit Benutzer-ID und Epoche |
| `apps/server/src/http.ts` | neu | `Auth`-Typ an der Anfrage, `NotFound`, `must`, `me`, `requireAdmin` |
| `apps/server/src/accountRoutes.ts` | neu | Login, Logout, App-Login, Konto, Geräte, Einladungen, Personen |
| `apps/server/src/app.ts` | ändern | Auth-Hook mit Person, Modulauswahl, persönliche Routen; Koppeln entfällt |
| `apps/server/src/repo.ts` | ändern | persönliche Abfragen, Mitgliedschaften, Flags, `bumpModuleContent` |
| `apps/server/src/study.ts` | ändern | `userId` in Lernen/Übersicht |
| `apps/server/src/sync.ts` | ändern | Push trennt persönlich/gemeinsam, Pull liefert Sicht der Person |
| `apps/server/src/pair.ts`, `apps/server/test/pair.test.ts` | löschen | QR-Kopplung entfällt |
| `packages/store/src/store.ts` | ändern | `wipe()`, `unsyncedCount()` |
| `apps/client/src/api.ts`, `router.ts`, `main.tsx`, `pages/*` | ändern/neu | Login mit Name, Einladung, Konto, Personen, Alle Module |
| `apps/client/src/native/*` | ändern | Anmelden/Abmelden in der App, 401-Behandlung, Bilder löschen |
| `apps/client/package.json`, `apps/server/package.json`, `package-lock.json`, `flake.nix` | ändern | `qrcode`, `@capacitor-mlkit/barcode-scanning` entfernen, Hash |
| `docs/superpowers/specs/2026-10-13-naklearn-multiuser-design.md` | ändern | Abschnitt 2: serverseitige Migrationen statt `core` |

---

### Task 1: Server-Schema und Passwort-Hashing

**Files:**
- Modify: `apps/server/src/db.ts`
- Create: `apps/server/src/password.ts`
- Modify: `apps/server/test/helpers.ts`
- Test: `apps/server/test/db.test.ts` (neu), `apps/server/test/password.test.ts` (neu)
- Modify: `docs/superpowers/specs/2026-10-13-naklearn-multiuser-design.md` (§2)

**Interfaces:**
- Produces:
  - `SERVER_MIGRATIONS: string[]`, `migrateServer(db: Db, migrations?: string[]): void` (Version in `meta`-Schlüssel `server_version`); `openDb` ruft nach `migrate(db, CORE_MIGRATIONS)` `migrateServer(db)` auf.
  - Tabellen: `user(id, name, name_key UNIQUE, password_hash, session_epoch, is_admin, created_at, last_seen_at)`, `membership(user_id, module_id, exam_date, new_per_day, updated_at)`, `card_flag(user_id, card_id, suspended, updated_at)`, `user_card_state(user_id, card_id, json, first_reviewed_at)`, `device(id, user_id, token_hash UNIQUE, name, created_at, last_seen_at)`, `invite(token_hash, user_id, created_at, expires_at, used_at)`, Spalte `revlog.user_id`.
  - `hashPassword(pw: string): string`, `verifyPassword(pw: string, stored: string): boolean`, `DUMMY_HASH: string`.
  - Test-Helfer: `memDb()` wendet beide Migrationslisten an; `addUser(db, id = 'u1', name = id, isAdmin = false): string` (fügt direkt ein, ohne scrypt).

Warum serverseitig: Die `core`-Migrationen laufen auch auf dem Handy; eine geänderte `card_state` oder neue Tabellen dort würden die lokale Datenbank der App brechen. Spec §2 wird entsprechend angepasst.

- [ ] **Step 1: Failing tests schreiben**

`apps/server/test/db.test.ts`:
```ts
import { CORE_MIGRATIONS } from '@naklearn/core';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate, migrateServer, SERVER_MIGRATIONS } from '../src/db.ts';

describe('migrateServer', () => {
  it('legt die Server-Tabellen an und ist wiederholbar', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, CORE_MIGRATIONS);
    migrateServer(db);
    migrateServer(db);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ['user', 'membership', 'card_flag', 'user_card_state', 'device', 'invite']) expect(tables).toContain(t);
    const cols = (db.prepare('PRAGMA table_info(revlog)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('user_id');
    const v = db.prepare("SELECT value FROM meta WHERE key = 'server_version'").get() as { value: string };
    expect(Number(v.value)).toBe(SERVER_MIGRATIONS.length);
  });
  it('lässt das Handy-Schema (core) unverändert', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, CORE_MIGRATIONS);
    const before = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'card_state'").get();
    migrateServer(db);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'card_state'").get()).toEqual(before);
  });
});
```

`apps/server/test/password.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../src/password.ts';

describe('Passwort-Hash', () => {
  it('prüft richtig und falsch, Salt macht Hashes verschieden', () => {
    const a = hashPassword('geheim123');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(verifyPassword('geheim123', a)).toBe(true);
    expect(verifyPassword('geheim124', a)).toBe(false);
    expect(hashPassword('geheim123')).not.toBe(a);
  });
  it('lehnt kaputte Hashes ab, ohne zu werfen', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$1$2')).toBe(false);
    expect(verifyPassword('naklearn-dummy', DUMMY_HASH)).toBe(true);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `cd apps/server && nix develop -c npx vitest run test/db.test.ts test/password.test.ts`
Expected: FAIL – `migrateServer` nicht exportiert / `../src/password.ts` fehlt.

- [ ] **Step 3: Implementierung**

`apps/server/src/db.ts` – nach `tx` anfügen, `openDb` erweitern:
```ts
/** Nur auf dem Server (das Handy teilt nur CORE_MIGRATIONS): Konten und persönlicher Lernstand. */
export const SERVER_MIGRATIONS: string[] = [
  `
  CREATE TABLE user (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    session_epoch INTEGER NOT NULL DEFAULT 0, is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, last_seen_at INTEGER
  );
  CREATE TABLE membership (
    user_id TEXT NOT NULL, module_id TEXT NOT NULL, exam_date TEXT, new_per_day INTEGER NOT NULL DEFAULT 20,
    updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, module_id)
  );
  CREATE INDEX membership_module ON membership(module_id);
  CREATE TABLE card_flag (
    user_id TEXT NOT NULL, card_id TEXT NOT NULL, suspended INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, card_id)
  );
  CREATE TABLE user_card_state (
    user_id TEXT NOT NULL, card_id TEXT NOT NULL, json TEXT NOT NULL, first_reviewed_at INTEGER,
    PRIMARY KEY (user_id, card_id)
  );
  CREATE TABLE device (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_seen_at INTEGER
  );
  CREATE TABLE invite (
    token_hash TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
  );
  ALTER TABLE revlog ADD COLUMN user_id TEXT;
  CREATE INDEX revlog_user_card ON revlog(user_id, card_id);
  `,
];

export function migrateServer(db: Db, migrations: string[] = SERVER_MIGRATIONS): void {
  const r = db.prepare("SELECT value FROM meta WHERE key = 'server_version'").get() as { value: string } | undefined;
  for (let v = r ? Number(r.value) : 0; v < migrations.length; v++) {
    tx(db, () => {
      db.exec(migrations[v]!);
      db.prepare("INSERT INTO meta (key, value) VALUES ('server_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(v + 1));
    });
  }
}
```
In `openDb` nach `migrate(db, CORE_MIGRATIONS);`: `migrateServer(db);`

`apps/server/src/password.ts`:
```ts
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash, ...rest] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash || rest.length) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = scryptSync(pw, Buffer.from(salt, 'base64url'), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Für unbekannte Namen: genauso teuer vergleichen, damit die Antwortzeit nichts verrät. */
export const DUMMY_HASH = hashPassword('naklearn-dummy');
```

`apps/server/test/helpers.ts` komplett:
```ts
import { CORE_MIGRATIONS } from '@naklearn/core';
import { DatabaseSync } from 'node:sqlite';
import { migrate, migrateServer, type Db } from '../src/db.ts';

export function memDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, CORE_MIGRATIONS);
  migrateServer(db);
  return db;
}

/** Legt eine Person direkt an (ohne scrypt, für schnelle Tests). */
export function addUser(db: Db, id = 'u1', name = id, isAdmin = false): string {
  db.prepare('INSERT INTO user (id, name, name_key, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, 0)')
    .run(id, name, name.toLowerCase(), 'x', isAdmin ? 1 : 0);
  return id;
}
```

Spec §2 anpassen: den Satz „Neue Migration (Index 2) in `packages/core/src/migrations.ts`. Server und Handy teilen die Migrationen; die neuen Tabellen nutzt nur der Server (wie `job`).“ ersetzen durch: „Eigene serverseitige Migrationen (`SERVER_MIGRATIONS` in `apps/server/src/db.ts`, Version in `meta.server_version`); die `core`-Migrationen laufen auch auf dem Handy und bleiben unverändert. Der persönliche Kartenstand liegt in der neuen Tabelle `user_card_state` (`card_state` bleibt für das Handy).“ und im SQL-Block den Kommentar zu `card_state` durch die `user_card_state`-Definition aus Step 3 ersetzen.

- [ ] **Step 4: Tests**

Run: `cd apps/server && nix develop -c npx vitest run test/db.test.ts test/password.test.ts && nix develop -c npm test && cd ../.. && nix develop -c npm run typecheck`
Expected: alles PASS (bestehende Tests unverändert grün, weil `revlog.user_id` nullable ist).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db.ts apps/server/src/password.ts apps/server/test/helpers.ts apps/server/test/db.test.ts apps/server/test/password.test.ts docs/superpowers/specs/2026-10-13-naklearn-multiuser-design.md
git commit -m "feat(server): server-only schema for accounts and personal progress, scrypt passwords"
```

---

### Task 2: Konten, Geräte, Einladungen (`accounts.ts`)

**Files:**
- Create: `apps/server/src/accounts.ts`
- Test: `apps/server/test/accounts.test.ts`

**Interfaces:**
- Consumes: Tabellen aus Task 1, `hashPassword`, `verifyPassword`, `DUMMY_HASH`
- Produces:
  - `interface User { id: string; name: string; isAdmin: boolean; sessionEpoch: number; createdAt: number; lastSeenAt: number | null }`
  - `class AccountError extends Error { statusCode: number }` (400 ungültig, 404 unbekannt, 409 Konflikt)
  - `INVITE_TTL_MS = 7 * 24 * 3600_000`, `hashToken(token: string): string`
  - `createUser(db, i: { name: string; password: string; isAdmin?: boolean; now: number }): User`
  - `getUser(db, id: string): User | undefined`
  - `checkLogin(db, name: string, password: string): User | null`
  - `setPassword(db, userId: string, password: string): User` (erhöht `sessionEpoch`)
  - `touchUser(db, userId: string, now: number): void` (höchstens einmal pro Minute)
  - `interface UserListItem extends User { moduleCount: number; deviceCount: number }`, `listUsers(db): UserListItem[]`
  - `deleteUser(db, userId: string): void`
  - `interface Device { id: string; name: string; createdAt: number; lastSeenAt: number | null }`
  - `addDevice(db, userId: string, name: string, now: number, token?: string): { device: Device; token: string }`
  - `authenticateToken(db, token: string, now: number): { user: User; deviceId: string } | null`
  - `listDevices(db, userId: string): Device[]`, `removeDevice(db, userId: string, deviceId: string): boolean`
  - `createInvite(db, i: { userId?: string | null; now: number }): string` (liefert Klartext-Token)
  - `inviteInfo(db, token: string, now: number): { kind: 'invite' | 'reset'; name: string | null } | null`
  - `acceptInvite(db, token: string, i: { name?: string; password: string; now: number }): User`

- [ ] **Step 1: Failing tests schreiben**

`apps/server/test/accounts.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  AccountError, INVITE_TTL_MS, acceptInvite, addDevice, authenticateToken, checkLogin, createInvite, createUser,
  deleteUser, getUser, inviteInfo, listDevices, listUsers, removeDevice, setPassword, touchUser,
} from '../src/accounts.ts';
import { memDb } from './helpers.ts';

const NOW = 1_800_000_000_000;

describe('Konten', () => {
  it('legt Personen an, Namen sind ohne Groß/Klein eindeutig', () => {
    const db = memDb();
    const u = createUser(db, { name: '  Luna ', password: 'geheim123', isAdmin: true, now: NOW });
    expect(u).toMatchObject({ name: 'Luna', isAdmin: true, sessionEpoch: 0, createdAt: NOW });
    expect(() => createUser(db, { name: 'luna', password: 'geheim123', now: NOW })).toThrow(/vergeben/);
    expect(() => createUser(db, { name: 'L', password: 'geheim123', now: NOW })).toThrow(/2–30/);
    expect(() => createUser(db, { name: 'Mia', password: 'kurz', now: NOW })).toThrow(/8 Zeichen/);
    try { createUser(db, { name: 'LUNA', password: 'geheim123', now: NOW }); } catch (e) { expect((e as AccountError).statusCode).toBe(409); }
  });

  it('Login: richtig, falsch, unbekannt; Name ohne Groß/Klein', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    expect(checkLogin(db, 'luna', 'geheim123')?.id).toBe(u.id);
    expect(checkLogin(db, 'Luna', 'falsch123')).toBeNull();
    expect(checkLogin(db, 'Niemand', 'geheim123')).toBeNull();
  });

  it('neues Passwort erhöht die Sitzungs-Epoche', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    const after = setPassword(db, u.id, 'neuesPasswort');
    expect(after.sessionEpoch).toBe(1);
    expect(checkLogin(db, 'Luna', 'neuesPasswort')).not.toBeNull();
    expect(checkLogin(db, 'Luna', 'geheim123')).toBeNull();
    expect(() => setPassword(db, u.id, 'kurz')).toThrow(/8 Zeichen/);
  });

  it('zuletzt aktiv wird höchstens einmal pro Minute geschrieben', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    touchUser(db, u.id, NOW);
    touchUser(db, u.id, NOW + 30_000);
    expect(getUser(db, u.id)!.lastSeenAt).toBe(NOW);
    touchUser(db, u.id, NOW + 61_000);
    expect(getUser(db, u.id)!.lastSeenAt).toBe(NOW + 61_000);
  });

  it('Personen-Liste zählt Module und Geräte; Löschen entfernt Persönliches', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Mia', password: 'geheim123', now: NOW });
    addDevice(db, u.id, 'Pixel', NOW);
    db.prepare("INSERT INTO membership (user_id, module_id, updated_at) VALUES (?, 'm1', 0)").run(u.id);
    db.prepare("INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, user_id) VALUES ('r1', 'c1', 3, 1, 1, 'd', ?)").run(u.id);
    expect(listUsers(db)).toMatchObject([{ name: 'Mia', moduleCount: 1, deviceCount: 1 }]);
    deleteUser(db, u.id);
    expect(getUser(db, u.id)).toBeUndefined();
    for (const t of ['membership', 'device', 'revlog']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(0);
    }
  });
});

describe('Geräte', () => {
  it('Token meldet die Person an, gespeichert wird nur der Hash; Entfernen macht es ungültig', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    const { device, token } = addDevice(db, u.id, '  Pixel 8 ', NOW);
    expect(device.name).toBe('Pixel 8');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(db.prepare('SELECT * FROM device').all())).not.toContain(token);
    expect(authenticateToken(db, token, NOW)).toMatchObject({ user: { id: u.id }, deviceId: device.id });
    expect(listDevices(db, u.id)[0]!.lastSeenAt).toBe(NOW);
    expect(authenticateToken(db, 'falsch', NOW)).toBeNull();
    expect(removeDevice(db, 'jemand-anders', device.id)).toBe(false);
    expect(removeDevice(db, u.id, device.id)).toBe(true);
    expect(authenticateToken(db, token, NOW)).toBeNull();
  });
  it('übernimmt ein vorhandenes Token (Altbestand)', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    addDevice(db, u.id, 'Bisheriges Handy', NOW, 'altes-token');
    expect(authenticateToken(db, 'altes-token', NOW)?.user.id).toBe(u.id);
  });
});

describe('Einladungen', () => {
  it('Einladung: Info, Annahme legt Konto an, Link nur einmal', () => {
    const db = memDb();
    const token = createInvite(db, { now: NOW });
    expect(inviteInfo(db, token, NOW)).toEqual({ kind: 'invite', name: null });
    const u = acceptInvite(db, token, { name: 'Mia', password: 'geheim123', now: NOW + 1 });
    expect(u.name).toBe('Mia');
    expect(inviteInfo(db, token, NOW + 2)).toBeNull();
    expect(() => acceptInvite(db, token, { name: 'Ben', password: 'geheim123', now: NOW + 2 })).toThrow(/ungültig/);
  });
  it('abgelaufen nach 7 Tagen', () => {
    const db = memDb();
    const token = createInvite(db, { now: NOW });
    expect(inviteInfo(db, token, NOW + INVITE_TTL_MS)).toBeNull();
  });
  it('fehlerhafte Eingabe lässt den Link gültig', () => {
    const db = memDb();
    createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    const token = createInvite(db, { now: NOW });
    expect(() => acceptInvite(db, token, { name: 'luna', password: 'geheim123', now: NOW })).toThrow(/vergeben/);
    expect(() => acceptInvite(db, token, { name: 'Mia', password: 'kurz', now: NOW })).toThrow(/8 Zeichen/);
    expect(inviteInfo(db, token, NOW)).not.toBeNull();
  });
  it('Reset-Link setzt das Passwort der Person und beendet ihre Sitzungen', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Mia', password: 'geheim123', now: NOW });
    const token = createInvite(db, { userId: u.id, now: NOW });
    expect(inviteInfo(db, token, NOW)).toEqual({ kind: 'reset', name: 'Mia' });
    const after = acceptInvite(db, token, { password: 'neuesPasswort', now: NOW });
    expect(after.sessionEpoch).toBe(1);
    expect(checkLogin(db, 'Mia', 'neuesPasswort')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `cd apps/server && nix develop -c npx vitest run test/accounts.test.ts`
Expected: FAIL – `Cannot find module '../src/accounts.ts'`

- [ ] **Step 3: Implementierung**

`apps/server/src/accounts.ts`:
```ts
import { newId } from '@naklearn/core';
import { createHash, randomBytes } from 'node:crypto';
import { tx, type Db } from './db.ts';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.ts';

type Row = Record<string, any>;

export interface User {
  id: string;
  name: string;
  isAdmin: boolean;
  sessionEpoch: number;
  createdAt: number;
  lastSeenAt: number | null;
}

/** Fehler mit HTTP-Status für die API (400 ungültig, 404 unbekannt, 409 Konflikt). */
export class AccountError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const INVITE_TTL_MS = 7 * 24 * 3600_000;
const TOUCH_MS = 60_000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');
const newToken = () => randomBytes(32).toString('base64url');
const nameKey = (name: string) => name.trim().toLowerCase();

const toUser = (r: Row): User => ({
  id: r.id, name: r.name, isAdmin: !!r.is_admin, sessionEpoch: r.session_epoch, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? null,
});

function checkName(name: string): string {
  const n = name.trim();
  if (n.length < 2 || n.length > 30) throw new AccountError('Name muss 2–30 Zeichen lang sein');
  return n;
}

function checkPassword(pw: string): void {
  if (pw.length < 8) throw new AccountError('Passwort muss mindestens 8 Zeichen lang sein');
  if (pw.length > 200) throw new AccountError('Passwort ist zu lang');
}

// ---------- Personen ----------

export function getUser(db: Db, id: string): User | undefined {
  const r = db.prepare('SELECT * FROM user WHERE id = ?').get(id) as Row | undefined;
  return r && toUser(r);
}

export function createUser(db: Db, i: { name: string; password: string; isAdmin?: boolean; now: number }): User {
  const name = checkName(i.name);
  checkPassword(i.password);
  if (db.prepare('SELECT 1 FROM user WHERE name_key = ?').get(nameKey(name))) throw new AccountError('Name ist schon vergeben', 409);
  const id = newId();
  db.prepare('INSERT INTO user (id, name, name_key, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, nameKey(name), hashPassword(i.password), i.isAdmin ? 1 : 0, i.now);
  return getUser(db, id)!;
}

export function checkLogin(db: Db, name: string, password: string): User | null {
  const r = db.prepare('SELECT * FROM user WHERE name_key = ?').get(nameKey(name)) as Row | undefined;
  const ok = verifyPassword(password, r?.password_hash ?? DUMMY_HASH);
  return r && ok ? toUser(r) : null;
}

export function setPassword(db: Db, userId: string, password: string): User {
  checkPassword(password);
  db.prepare('UPDATE user SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?').run(hashPassword(password), userId);
  const u = getUser(db, userId);
  if (!u) throw new AccountError('Person nicht gefunden', 404);
  return u;
}

export function touchUser(db: Db, userId: string, now: number): void {
  db.prepare('UPDATE user SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)').run(now, userId, now - TOUCH_MS);
}

export interface UserListItem extends User {
  moduleCount: number;
  deviceCount: number;
}

export function listUsers(db: Db): UserListItem[] {
  return (db.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM membership m WHERE m.user_id = u.id) AS module_count,
            (SELECT COUNT(*) FROM device d WHERE d.user_id = u.id) AS device_count
     FROM user u ORDER BY u.name_key`,
  ).all() as Row[]).map((r) => ({ ...toUser(r), moduleCount: r.module_count, deviceCount: r.device_count }));
}

/** Entfernt die Person und alles Persönliche; gemeinsame Inhalte bleiben. */
export function deleteUser(db: Db, userId: string): void {
  tx(db, () => {
    for (const t of ['membership', 'card_flag', 'user_card_state', 'device', 'revlog', 'invite']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    }
    db.prepare('DELETE FROM user WHERE id = ?').run(userId);
  });
}

// ---------- Geräte ----------

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
}

const toDevice = (r: Row): Device => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? null });

export function addDevice(db: Db, userId: string, name: string, now: number, token = newToken()): { device: Device; token: string } {
  const id = newId();
  const label = name.trim().slice(0, 60) || 'Handy';
  db.prepare('INSERT INTO device (id, user_id, token_hash, name, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, hashToken(token), label, now);
  return { device: toDevice(db.prepare('SELECT * FROM device WHERE id = ?').get(id) as Row), token };
}

export function authenticateToken(db: Db, token: string, now: number): { user: User; deviceId: string } | null {
  const r = db.prepare(
    'SELECT d.id AS device_id, d.last_seen_at AS device_seen, u.* FROM device d JOIN user u ON u.id = d.user_id WHERE d.token_hash = ?',
  ).get(hashToken(token)) as Row | undefined;
  if (!r) return null;
  if (r.device_seen === null || r.device_seen <= now - TOUCH_MS) {
    db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').run(now, r.device_id);
  }
  return { user: toUser(r), deviceId: r.device_id };
}

export function listDevices(db: Db, userId: string): Device[] {
  return (db.prepare('SELECT * FROM device WHERE user_id = ? ORDER BY created_at').all(userId) as Row[]).map(toDevice);
}

export function removeDevice(db: Db, userId: string, deviceId: string): boolean {
  const r = db.prepare('DELETE FROM device WHERE id = ? AND user_id = ? RETURNING id').get(deviceId, userId);
  return !!r;
}

// ---------- Einladungen und Zurücksetzen ----------

export function createInvite(db: Db, i: { userId?: string | null; now: number }): string {
  const token = newToken();
  db.prepare('INSERT INTO invite (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), i.userId ?? null, i.now, i.now + INVITE_TTL_MS);
  return token;
}

function openInvite(db: Db, token: string, now: number): Row | undefined {
  return db.prepare('SELECT * FROM invite WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(hashToken(token), now) as Row | undefined;
}

export function inviteInfo(db: Db, token: string, now: number): { kind: 'invite' | 'reset'; name: string | null } | null {
  const inv = openInvite(db, token, now);
  if (!inv) return null;
  if (!inv.user_id) return { kind: 'invite', name: null };
  const u = getUser(db, inv.user_id);
  return u ? { kind: 'reset', name: u.name } : null;
}

export function acceptInvite(db: Db, token: string, i: { name?: string; password: string; now: number }): User {
  return tx(db, () => {
    const inv = openInvite(db, token, i.now);
    if (!inv || (inv.user_id && !getUser(db, inv.user_id))) {
      throw new AccountError('Link ist ungültig, abgelaufen oder schon benutzt', 404);
    }
    const user = inv.user_id
      ? setPassword(db, inv.user_id, i.password)
      : createUser(db, { name: i.name ?? '', password: i.password, now: i.now });
    db.prepare('UPDATE invite SET used_at = ? WHERE token_hash = ?').run(i.now, inv.token_hash);
    return user;
  });
}
```

- [ ] **Step 4: Tests**

Run: `cd apps/server && nix develop -c npx vitest run test/accounts.test.ts && cd ../.. && nix develop -c npm run typecheck`
Expected: PASS; `tsc` ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/accounts.ts apps/server/test/accounts.test.ts
git commit -m "feat(server): accounts, devices and invite links"
```

---

### Task 3: Erststart – bestehende Daten dem Admin zuordnen

**Files:**
- Create: `apps/server/src/bootstrap.ts`
- Modify: `apps/server/src/config.ts`, `apps/server/src/main.ts`
- Test: `apps/server/test/bootstrap.test.ts` (neu), `apps/server/test/config.test.ts`

**Interfaces:**
- Consumes: `createUser`, `addDevice`, `authenticateToken` (Task 2)
- Produces:
  - `bootstrapAccounts(db, o: { adminName: string; password: string | null; legacyToken: string | null; backupDir: string; now: number }): { created: boolean; backup: string | null }`
  - `Config.password: string | null` (kein Abbruch mehr beim Laden), `Config.adminName: string`; `rotateToken` entfällt. `Config.token` bleibt (nur noch als Altbestand für den Erststart gelesen).

- [ ] **Step 1: Failing tests schreiben**

`apps/server/test/bootstrap.test.ts`:
```ts
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { authenticateToken, checkLogin, listUsers } from '../src/accounts.ts';
import { bootstrapAccounts } from '../src/bootstrap.ts';
import * as repo from '../src/repo.ts';
import { memDb } from './helpers.ts';

const NOW = new Date('2026-10-21T10:00:00+09:00').getTime();
const backupDir = () => mkdtempSync(path.join(tmpdir(), 'naklearn-boot-'));

function legacy() {
  const db = memDb();
  const mod = repo.createModule(db, { name: 'Cloud Security', language: 'en', examDate: '2026-10-20', newPerDay: 22 }, 1);
  db.prepare('UPDATE module SET exam_date = ?, new_per_day = ? WHERE id = ?').run('2026-10-20', 22, mod.id);
  const gone = repo.createModule(db, { name: 'Alt', language: 'en' }, 1);
  repo.deleteModule(db, gone.id, 2);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' }, 1);
  const { cards } = repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 }, 1);
  const cardId = cards[0]!.id;
  db.prepare('UPDATE card SET suspended = 1 WHERE id = ?').run(cardId);
  db.prepare("INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id) VALUES ('r1', ?, 3, 5, 100, 'phone')").run(cardId);
  db.prepare("INSERT INTO card_state (card_id, json, first_reviewed_at) VALUES (?, '{\"reps\":1}', 5)").run(cardId);
  return { db, mod, gone, cardId };
}

describe('bootstrapAccounts', () => {
  it('ordnet alle bestehenden Daten dem Admin zu und sichert vorher', () => {
    const { db, mod, gone, cardId } = legacy();
    const dir = backupDir();
    const r = bootstrapAccounts(db, { adminName: 'luna', password: 'altesPasswort', legacyToken: 'altes-token', backupDir: dir, now: NOW });
    expect(r.created).toBe(true);
    expect(r.backup).toBe(path.join(dir, 'pre-multiuser-2026-10-21.db'));
    expect(existsSync(r.backup!)).toBe(true);
    const admin = checkLogin(db, 'Luna', 'altesPasswort')!;
    expect(admin).toMatchObject({ name: 'luna', isAdmin: true });
    expect(authenticateToken(db, 'altes-token', NOW)?.user.id).toBe(admin.id);
    const ms = db.prepare('SELECT module_id, exam_date, new_per_day FROM membership WHERE user_id = ?').all(admin.id);
    expect(ms).toEqual([{ module_id: mod.id, exam_date: '2026-10-20', new_per_day: 22 }]);
    expect(ms.some((m: any) => m.module_id === gone.id)).toBe(false);
    expect(db.prepare('SELECT suspended FROM card_flag WHERE user_id = ? AND card_id = ?').get(admin.id, cardId)).toEqual({ suspended: 1 });
    expect(db.prepare('SELECT json, first_reviewed_at FROM user_card_state WHERE user_id = ? AND card_id = ?').get(admin.id, cardId))
      .toEqual({ json: '{"reps":1}', first_reviewed_at: 5 });
    expect(db.prepare("SELECT user_id FROM revlog WHERE id = 'r1'").get()).toEqual({ user_id: admin.id });
  });

  it('ein zweiter Start ändert nichts', () => {
    const { db } = legacy();
    const dir = backupDir();
    bootstrapAccounts(db, { adminName: 'luna', password: 'altesPasswort', legacyToken: null, backupDir: dir, now: NOW });
    const again = bootstrapAccounts(db, { adminName: 'jemand', password: null, legacyToken: null, backupDir: dir, now: NOW });
    expect(again).toEqual({ created: false, backup: null });
    expect(listUsers(db)).toHaveLength(1);
  });

  it('frische Installation: Admin ohne Sicherung', () => {
    const db = memDb();
    const r = bootstrapAccounts(db, { adminName: 'luna', password: 'altesPasswort', legacyToken: null, backupDir: backupDir(), now: NOW });
    expect(r).toEqual({ created: true, backup: null });
  });

  it('ohne Konto und ohne Passwort bricht der Start mit klarer Meldung ab', () => {
    const db = memDb();
    expect(() => bootstrapAccounts(db, { adminName: 'luna', password: null, legacyToken: null, backupDir: backupDir(), now: NOW }))
      .toThrow(/NAKLEARN_PASSWORD/);
  });
});
```

`apps/server/test/config.test.ts` – den Test „verweigert den Start ohne Passwort“ ersetzen durch:
```ts
  it('Passwort und Admin-Name sind optional (nur für den Erststart)', () => {
    const { NAKLEARN_PASSWORD: _, ...noPw } = env();
    const c = loadConfig(noPw);
    expect(c.password).toBeNull();
    expect(c.adminName).toBe('luna');
    expect(loadConfig(env({ NAKLEARN_ADMIN: 'Mia' })).adminName).toBe('Mia');
  });
```
und den ganzen `describe('rotateToken', …)`-Block sowie `rotateToken` aus dem Import entfernen.

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `cd apps/server && nix develop -c npx vitest run test/bootstrap.test.ts test/config.test.ts`
Expected: FAIL – `../src/bootstrap.ts` fehlt; `adminName` undefined.

- [ ] **Step 3: Implementierung**

`apps/server/src/bootstrap.ts`:
```ts
import { studyDay } from '@naklearn/core';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { addDevice, createUser } from './accounts.ts';
import { tx, type Db } from './db.ts';

/**
 * Erststart der Mehrbenutzer-Version: legt den Admin an und ordnet ihm alle bisherigen
 * Lernstände, Moduleinstellungen, zurückgestellten Karten und das bisherige Handy-Token zu.
 */
export function bootstrapAccounts(
  db: Db,
  o: { adminName: string; password: string | null; legacyToken: string | null; backupDir: string; now: number },
): { created: boolean; backup: string | null } {
  if (db.prepare('SELECT 1 FROM user LIMIT 1').get()) return { created: false, backup: null };
  if (!o.password) {
    throw new Error(`Noch kein Konto: NAKLEARN_PASSWORD muss beim ersten Start gesetzt sein (Passwort für „${o.adminName}“).`);
  }
  let backup: string | null = null;
  if (db.prepare('SELECT 1 FROM module LIMIT 1').get()) {
    mkdirSync(o.backupDir, { recursive: true });
    backup = path.join(o.backupDir, `pre-multiuser-${studyDay(o.now)}.db`);
    if (!existsSync(backup)) db.prepare('VACUUM INTO ?').run(backup);
  }
  const password = o.password;
  tx(db, () => {
    const admin = createUser(db, { name: o.adminName, password, isAdmin: true, now: o.now });
    db.prepare('UPDATE revlog SET user_id = ? WHERE user_id IS NULL').run(admin.id);
    db.prepare('INSERT INTO user_card_state (user_id, card_id, json, first_reviewed_at) SELECT ?, card_id, json, first_reviewed_at FROM card_state')
      .run(admin.id);
    db.prepare('INSERT INTO membership (user_id, module_id, exam_date, new_per_day, updated_at) SELECT ?, id, exam_date, new_per_day, ? FROM module WHERE deleted = 0')
      .run(admin.id, o.now);
    db.prepare('INSERT INTO card_flag (user_id, card_id, suspended, updated_at) SELECT ?, id, 1, ? FROM card WHERE suspended = 1')
      .run(admin.id, o.now);
    if (o.legacyToken) addDevice(db, admin.id, 'Bisheriges Handy', o.now, o.legacyToken);
  });
  return { created: true, backup };
}
```

`apps/server/src/config.ts`:
- Im Interface `password: string;` ersetzen durch
```ts
  /** Nur für den Erststart: Passwort des Admin-Kontos. */
  password: string | null;
  /** Name des Admin-Kontos beim Erststart. */
  adminName: string;
```
- In `loadConfig` die zwei Zeilen `const password = …` und `if (!password) throw …` entfernen; im Rückgabeobjekt `password,` ersetzen durch
```ts
    password: env.NAKLEARN_PASSWORD || null,
    adminName: env.NAKLEARN_ADMIN?.trim() || 'luna',
```
- Die Funktion `rotateToken` löschen.

`apps/server/src/main.ts` – nach `resetRunningJobs(db);`:
```ts
const boot = bootstrapAccounts(db, {
  adminName: cfg.adminName, password: cfg.password, legacyToken: cfg.token,
  backupDir: path.join(cfg.dataDir, 'backups'), now: Date.now(),
});
if (boot.created) console.log(`[naklearn] Konto „${cfg.adminName}“ angelegt${boot.backup ? ` (Sicherung: ${boot.backup})` : ''}`);
```
mit Import `import { bootstrapAccounts } from './bootstrap.ts';`.

`app.ts` benutzt noch `cfg.password` und `rotateToken` – bis Task 4 übergangsweise: in `app.ts` `rotateToken` aus dem Import entfernen, die Route `/api/pair/rotate` löschen und `const sessionKey = \`${cfg.sessionSecret}\0${cfg.password ?? ''}\`;` sowie `passwordMatches(password, cfg.password ?? '')` schreiben (Task 4 ersetzt das ganz). In `apps/server/test/app.test.ts` den Test „Token neu erzeugen: …“ löschen und im Test-Config-Literal `adminName: 'luna',` ergänzen; ebenso im Config-Literal in `apps/server/test/sync-e2e.test.ts`.

- [ ] **Step 4: Tests**

Run: `cd apps/server && nix develop -c npm test && cd ../.. && nix develop -c npm run typecheck`
Expected: alles PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/bootstrap.ts apps/server/src/config.ts apps/server/src/main.ts apps/server/src/app.ts apps/server/test/bootstrap.test.ts apps/server/test/config.test.ts apps/server/test/app.test.ts apps/server/test/sync-e2e.test.ts
git commit -m "feat(server): first start creates the admin account and assigns existing progress"
```

---

### Task 4: Anmeldung pro Person – Auth-Hook und Konto-Routen

**Files:**
- Modify: `apps/server/src/auth.ts`
- Create: `apps/server/src/http.ts`, `apps/server/src/accountRoutes.ts`
- Modify: `apps/server/src/app.ts` (Kopf, `buildApp` bis zum Error-Handler, Login/Logout/Koppeln entfernen)
- Delete: `apps/server/src/pair.ts`, `apps/server/test/pair.test.ts`
- Test: `apps/server/test/auth.test.ts`, `apps/server/test/accountRoutes.test.ts` (neu), `apps/server/test/app.test.ts`, `apps/server/test/sync-e2e.test.ts`

**Interfaces:**
- Consumes: alles aus Task 2; `LoginLimiter`, `clientIp`, Cookie-Helfer aus `auth.ts`
- Produces:
  - `auth.ts`: `createUserSession(secret: string, userId: string, epoch: number, now: number): string`, `sessionUserId(value: string | undefined): string | null`, `verifyUserSession(value: string | undefined, secret: string, userId: string, epoch: number, now: number): boolean`
  - `http.ts`: `interface Auth { user: User; deviceId: string | null }`; Modul-Augmentation `FastifyRequest.auth: Auth | null`; `class NotFound extends Error`; `must<T>(v: T | undefined, what: string): T`; `me(req): User`; `requireAdmin(req): User` (wirft `AccountError` 403)
  - `accountRoutes.ts`: `registerAccountRoutes(app, ctx: { db: Db; cfg: Config; now: () => number; limiter: LoginLimiter }): void`
  - HTTP:
    - `POST /api/login {name, password}` → `{id, name, isAdmin}` + Cookie; 401 „Name oder Passwort falsch“; 429
    - `POST /api/logout` → Cookie löschen
    - `POST /api/device/login {name, password, deviceName?}` → `{token, user: {id, name}}`
    - `GET /api/me` → `{id, name, isAdmin}`
    - `POST /api/me/password {old, new}` → `{ok}` + neues Cookie
    - `GET /api/me/devices` → `Device[]`; `DELETE /api/me/devices/:id`
    - `POST /api/invites` (Admin) → `{url}`; `GET /api/invites/:token` (öffentlich) → `{kind, name}` | 404; `POST /api/invites/:token/accept {name?, password}` (öffentlich) → `{id, name, isAdmin}` + Cookie
    - `GET /api/users` (Admin) → `UserListItem[]`; `POST /api/users/:id/reset` (Admin) → `{url}`; `DELETE /api/users/:id` (Admin, nicht sich selbst)
  - Alle übrigen `/api/*`-Routen verlangen `req.auth` (Gerätetoken oder Sitzung).

- [ ] **Step 1: Failing tests schreiben**

In `apps/server/test/auth.test.ts` Import um `createUserSession, sessionUserId, verifyUserSession` erweitern und anfügen:
```ts
describe('Personen-Sitzung', () => {
  it('enthält die Person, gilt nur mit passender Epoche und Geheimnis', () => {
    const s = createUserSession('k', 'user-1', 0, NOW);
    expect(sessionUserId(s)).toBe('user-1');
    expect(verifyUserSession(s, 'k', 'user-1', 0, NOW)).toBe(true);
    expect(verifyUserSession(s, 'k', 'user-1', 1, NOW)).toBe(false);
    expect(verifyUserSession(s, 'k', 'user-2', 0, NOW)).toBe(false);
    expect(verifyUserSession(s, 'anders', 'user-1', 0, NOW)).toBe(false);
    expect(verifyUserSession(s, 'k', 'user-1', 0, NOW + SESSION_TTL_MS)).toBe(false);
    expect(sessionUserId(undefined)).toBeNull();
    expect(sessionUserId('ohne-punkt')).toBeNull();
  });
});
```

`apps/server/test/accountRoutes.test.ts`:
```ts
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDevice, createUser } from '../src/accounts.ts';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { memDb } from './helpers.ts';

function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'naklearn-acc-'));
  for (const d of ['pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });
  const cfg: Config = {
    dataDir, port: 0, host: '127.0.0.1', token: 'legacy', deviceId: 'server', password: null, adminName: 'luna',
    sessionSecret: 'session-secret', publicUrl: 'https://naklearn.example', claudePath: '/bin/false',
    summaryModel: null, cardsModel: null, webDir: null,
  };
  const db = memDb();
  let t = new Date('2026-10-21T10:00:00+09:00').getTime();
  const worker = { wake: () => {}, resume: () => {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
  const app = buildApp({ db, cfg, worker, now: () => t });
  const luna = createUser(db, { name: 'Luna', password: 'luna-pass-1', isAdmin: true, now: t });
  const mia = createUser(db, { name: 'Mia', password: 'mia-pass-1', now: t });
  return { app, db, luna, mia, advance: (ms: number) => void (t += ms), now: () => t };
}

type App = ReturnType<typeof setup>['app'];
async function login(app: App, name: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { name, password } });
  return { r, cookie: r.statusCode === 200 ? String(r.headers['set-cookie']).split(';')[0]! : '' };
}

describe('Login im Browser', () => {
  it('meldet mit Name+Passwort an, /api/me kennt die Person', async () => {
    const { app } = setup();
    const { r, cookie } = await login(app, 'luna', 'luna-pass-1');
    expect(r.json()).toMatchObject({ name: 'Luna', isAdmin: true });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json()).toMatchObject({ name: 'Luna' });
  });
  it('gleiche Meldung für falsches Passwort und unbekannten Namen', async () => {
    const { app } = setup();
    const a = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'falsch-123' } });
    const b = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Niemand', password: 'falsch-123' } });
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
    expect(a.json()).toEqual({ error: 'Name oder Passwort falsch' });
    expect(b.json()).toEqual(a.json());
  });
  it('Bremse gilt für Browser- und App-Login gemeinsam', async () => {
    const { app } = setup();
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'x' } });
    for (let i = 0; i < 2; i++) await app.inject({ method: 'POST', url: '/api/device/login', payload: { name: 'Luna', password: 'x' } });
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'luna-pass-1' } })).statusCode).toBe(429);
  });
  it('Passwort ändern beendet alte Sitzungen, die aktuelle bekommt ein neues Cookie', async () => {
    const { app } = setup();
    const first = (await login(app, 'Mia', 'mia-pass-1')).cookie;
    const second = (await login(app, 'Mia', 'mia-pass-1')).cookie;
    const bad = await app.inject({ method: 'POST', url: '/api/me/password', headers: { cookie: second }, payload: { old: 'falsch-123', new: 'neues-pass-1' } });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/api/me/password', headers: { cookie: second }, payload: { old: 'mia-pass-1', new: 'neues-pass-1' } });
    expect(r.statusCode).toBe(200);
    const fresh = String(r.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: first } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: fresh } })).statusCode).toBe(200);
  });
});

describe('App-Login und Geräte', () => {
  it('liefert ein Gerätetoken; Entfernen macht es ungültig', async () => {
    const { app } = setup();
    const r = await app.inject({ method: 'POST', url: '/api/device/login', payload: { name: 'mia', password: 'mia-pass-1', deviceName: 'Pixel' } });
    expect(r.statusCode).toBe(200);
    const { token, user } = r.json();
    expect(user).toMatchObject({ name: 'Mia' });
    const auth = { authorization: `Bearer ${token}` };
    const devices = (await app.inject({ method: 'GET', url: '/api/me/devices', headers: auth })).json();
    expect(devices).toMatchObject([{ name: 'Pixel' }]);
    expect((await app.inject({ method: 'DELETE', url: `/api/me/devices/${devices[0].id}`, headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth })).statusCode).toBe(401);
  });
  it('fremde Geräte lassen sich nicht entfernen', async () => {
    const { app, db, luna, mia } = setup();
    const { device } = addDevice(db, luna.id, 'Lunas Handy', 0);
    const { token } = addDevice(db, mia.id, 'Mias Handy', 0);
    const r = await app.inject({ method: 'DELETE', url: `/api/me/devices/${device.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(404);
  });
});

describe('Einladungen und Personen', () => {
  it('nur der Admin lädt ein; der Link legt ein Konto an und meldet an', async () => {
    const { app } = setup();
    const mia = (await login(app, 'Mia', 'mia-pass-1')).cookie;
    expect((await app.inject({ method: 'POST', url: '/api/invites', headers: { cookie: mia } })).statusCode).toBe(403);
    const luna = (await login(app, 'Luna', 'luna-pass-1')).cookie;
    const { url } = (await app.inject({ method: 'POST', url: '/api/invites', headers: { cookie: luna } })).json();
    expect(url).toMatch(/^https:\/\/naklearn\.example\/#\/einladung\/[A-Za-z0-9_-]{43}$/);
    const token = url.split('/').pop();
    expect((await app.inject({ method: 'GET', url: `/api/invites/${token}` })).json()).toEqual({ kind: 'invite', name: null });
    const acc = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, payload: { name: 'Ben', password: 'ben-pass-1' } });
    expect(acc.statusCode).toBe(200);
    const ben = String(acc.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: ben } })).json()).toMatchObject({ name: 'Ben', isAdmin: false });
    expect((await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, payload: { name: 'Ben2', password: 'ben-pass-1' } })).statusCode).toBe(404);
  });
  it('ungültige Einladungslinks zählen für die Bremse', async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: `/api/invites/${'x'.repeat(43)}/accept`, payload: { name: 'Ben', password: 'ben-pass-1' } });
    }
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'luna-pass-1' } })).statusCode).toBe(429);
  });
  it('Reset-Link und Personen-Liste, Löschen nicht von sich selbst', async () => {
    const { app, db, mia, luna } = setup();
    const admin = (await login(app, 'Luna', 'luna-pass-1')).cookie;
    const list = (await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: admin } })).json();
    expect(list.map((u: { name: string }) => u.name)).toEqual(['Luna', 'Mia']);
    const { url } = (await app.inject({ method: 'POST', url: `/api/users/${mia.id}/reset`, headers: { cookie: admin } })).json();
    const token = url.split('/').pop();
    expect((await app.inject({ method: 'GET', url: `/api/invites/${token}` })).json()).toEqual({ kind: 'reset', name: 'Mia' });
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${luna.id}`, headers: { cookie: admin } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${mia.id}`, headers: { cookie: admin } })).statusCode).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user').get()).toEqual({ n: 1 });
  });
});
```

`apps/server/test/app.test.ts` umstellen:
- Import ergänzen: `import { addDevice, createUser } from '../src/accounts.ts';`
- Im `setup()`-Config-Literal `password: 'pw'` → `password: null`.
- In `setup()` nach `const raw = buildApp(...)`: 
```ts
  const user = createUser(db, { name: 'luna', password: 'pw-luna-123', isAdmin: true, now: t });
  const { token } = addDevice(db, user.id, 'Test-Handy', t);
```
  und im Wrapper `authorization: 'Bearer secret'` → `` authorization: `Bearer ${token}` ``; `user` und `token` mit zurückgeben.
- `login()`-Helfer: `payload: { name: 'luna', password }` mit Standard `password = 'pw-luna-123'`.
- In allen Tests im `describe('Anmeldung')`: `'Bearer secret'` → `` `Bearer ${token}` `` (aus `setup()` holen), Login-Payloads `{ password: 'pw' }` → `{ name: 'luna', password: 'pw-luna-123' }`, `{ password: 'falsch' }` → `{ name: 'luna', password: 'falsch' }`, Erwartung `'Falsches Passwort'` entfällt (nur Status prüfen).
- Im Test „manipuliertes Cookie gilt nicht“ hat der Cookie-Wert jetzt drei Teile: `const [uid, exp, mac] = value!.split('.');` und `const forged = \`${name}=${uid}.${Number(exp) + 86_400_000}.${mac}\`;`.
- Diese Tests löschen: „Koppeln nur mit Sitzung, Adresse aus der Konfiguration“, `describe('Passwortwechsel')` (ersetzt durch den Test in `accountRoutes.test.ts`).

`apps/server/test/sync-e2e.test.ts`: im `setup()` nach `buildApp`:
```ts
  const owner = createUser(db, { name: 'luna', password: 'pw-luna-123', isAdmin: true, now: NOW });
  const { token } = addDevice(db, owner.id, 'Handy', NOW);
```
und im Transport `authorization: 'Bearer t'` → `` authorization: `Bearer ${token}` ``; Config-Literal `password: 'pw'` → `password: null`. Import `createUser, addDevice` aus `../src/accounts.ts`.

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `cd apps/server && nix develop -c npx vitest run test/auth.test.ts test/accountRoutes.test.ts`
Expected: FAIL – `createUserSession` nicht exportiert; `/api/login` erwartet nur `password`.

- [ ] **Step 3: Implementierung**

`apps/server/src/auth.ts` anfügen:
```ts
const userKey = (secret: string, userId: string, epoch: number) => `${secret}\0${userId}\0${epoch}`;

/** Sitzung einer Person: `<userId>.<ablauf>.<hmac>`; die Epoche steckt im Schlüssel (neues Passwort → ungültig). */
export function createUserSession(secret: string, userId: string, epoch: number, now: number): string {
  return `${userId}.${createSession(userKey(secret, userId, epoch), now)}`;
}

export function sessionUserId(value: string | undefined): string | null {
  const i = value ? value.indexOf('.') : -1;
  return i > 0 ? value!.slice(0, i) : null;
}

export function verifyUserSession(value: string | undefined, secret: string, userId: string, epoch: number, now: number): boolean {
  if (!value || sessionUserId(value) !== userId) return false;
  return verifySession(value.slice(userId.length + 1), userKey(secret, userId, epoch), now);
}
```
`passwordMatches` bleibt (wird nicht mehr benutzt, Test bleibt grün) – oder löschen samt Test; hier: **löschen** inklusive des Tests „passwordMatches“ in `auth.test.ts`.

`apps/server/src/http.ts`:
```ts
import type { FastifyRequest } from 'fastify';
import { AccountError, type User } from './accounts.ts';

export interface Auth {
  user: User;
  /** Gerät bei Anmeldung per App-Token, sonst null (Browser-Sitzung). */
  deviceId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null;
  }
}

export class NotFound extends Error {}

export function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new NotFound(`${what} nicht gefunden`);
  return v;
}

/** Die angemeldete Person (der Auth-Hook garantiert sie für alle nicht öffentlichen Routen). */
export function me(req: FastifyRequest): User {
  if (!req.auth) throw new AccountError('Nicht angemeldet', 401);
  return req.auth.user;
}

export function requireAdmin(req: FastifyRequest): User {
  const u = me(req);
  if (!u.isAdmin) throw new AccountError('Nur für Admins', 403);
  return u;
}
```

`apps/server/src/accountRoutes.ts`:
```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AccountError, acceptInvite, addDevice, checkLogin, createInvite, deleteUser, getUser, inviteInfo, listDevices,
  listUsers, removeDevice, setPassword, type User,
} from './accounts.ts';
import { clearSessionCookie, createUserSession, sessionCookie, type LoginLimiter } from './auth.ts';
import { clientIp } from './clientip.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { NotFound, me, requireAdmin } from './http.ts';

const LoginInput = z.object({ name: z.string().max(100), password: z.string().max(1000) });
const DeviceLoginInput = LoginInput.extend({ deviceName: z.string().max(100).optional() });
const PasswordInput = z.object({ old: z.string().max(1000), new: z.string().max(1000) });
const AcceptInput = z.object({ name: z.string().max(100).optional(), password: z.string().max(1000) });
const TokenParam = z.object({ token: z.string().min(10).max(200) });
const IdParam = z.object({ id: z.string().min(1) });

const WRONG = 'Name oder Passwort falsch';
const TOO_MANY = 'Zu viele Fehlversuche – bitte 15 Minuten warten.';

export const publicUser = (u: User) => ({ id: u.id, name: u.name, isAdmin: u.isAdmin });

export function registerAccountRoutes(
  app: FastifyInstance,
  ctx: { db: Db; cfg: Config; now: () => number; limiter: LoginLimiter },
): void {
  const { db, cfg, now, limiter } = ctx;
  const secure = (req: FastifyRequest) => req.protocol === 'https';
  const ipOf = (req: FastifyRequest) => clientIp(req.ip, req.headers['cf-connecting-ip']);
  const setSession = (req: FastifyRequest, reply: FastifyReply, u: User) =>
    reply.header('set-cookie', sessionCookie(createUserSession(cfg.sessionSecret, u.id, u.sessionEpoch, now()), secure(req)));
  const linkFor = (req: FastifyRequest, token: string) =>
    `${cfg.publicUrl ?? `${req.protocol}://${req.headers.host}`}/#/einladung/${token}`;

  /** Login-Versuch mit Bremse; liefert die Person oder hat schon 401/429 geantwortet. */
  function attempt(req: FastifyRequest, reply: FastifyReply, name: string, password: string): User | null {
    const ip = ipOf(req);
    const t = now();
    if (limiter.blocked(ip, t)) {
      void reply.code(429).send({ error: TOO_MANY });
      return null;
    }
    const user = checkLogin(db, name, password);
    if (!user) {
      limiter.fail(ip, t);
      void reply.code(401).send({ error: WRONG });
      return null;
    }
    limiter.reset(ip);
    return user;
  }

  app.post('/api/login', async (req, reply) => {
    const { name, password } = LoginInput.parse(req.body);
    const user = attempt(req, reply, name, password);
    if (!user) return reply;
    setSession(req, reply, user);
    return publicUser(user);
  });

  app.post('/api/logout', async (req, reply) => {
    reply.header('set-cookie', clearSessionCookie(secure(req)));
    return { ok: true };
  });

  app.post('/api/device/login', async (req, reply) => {
    const { name, password, deviceName } = DeviceLoginInput.parse(req.body);
    const user = attempt(req, reply, name, password);
    if (!user) return reply;
    const { token } = addDevice(db, user.id, deviceName ?? 'Handy', now());
    return { token, user: { id: user.id, name: user.name } };
  });

  app.get('/api/me', async (req) => publicUser(me(req)));

  app.post('/api/me/password', async (req, reply) => {
    const u = me(req);
    const body = PasswordInput.parse(req.body);
    if (!checkLogin(db, u.name, body.old)) throw new AccountError('Altes Passwort stimmt nicht');
    const updated = setPassword(db, u.id, body.new);
    setSession(req, reply, updated);
    return { ok: true };
  });

  app.get('/api/me/devices', async (req) => listDevices(db, me(req).id));

  app.delete('/api/me/devices/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    if (!removeDevice(db, me(req).id, id)) throw new NotFound('Gerät nicht gefunden');
    return { ok: true };
  });

  app.post('/api/invites', async (req) => {
    requireAdmin(req);
    return { url: linkFor(req, createInvite(db, { now: now() })) };
  });

  app.get('/api/invites/:token', async (req) => {
    const { token } = TokenParam.parse(req.params);
    const info = inviteInfo(db, token, now());
    if (!info) throw new NotFound('Link ist ungültig, abgelaufen oder schon benutzt');
    return info;
  });

  app.post('/api/invites/:token/accept', async (req, reply) => {
    const { token } = TokenParam.parse(req.params);
    const body = AcceptInput.parse(req.body);
    const ip = ipOf(req);
    if (limiter.blocked(ip, now())) return reply.code(429).send({ error: TOO_MANY });
    let user: User;
    try {
      user = acceptInvite(db, token, { name: body.name, password: body.password, now: now() });
    } catch (e) {
      if (e instanceof AccountError && e.statusCode === 404) limiter.fail(ip, now());
      throw e;
    }
    setSession(req, reply, user);
    return publicUser(user);
  });

  app.get('/api/users', async (req) => {
    requireAdmin(req);
    return listUsers(db);
  });

  app.post('/api/users/:id/reset', async (req) => {
    requireAdmin(req);
    const { id } = IdParam.parse(req.params);
    if (!getUser(db, id)) throw new NotFound('Person nicht gefunden');
    return { url: linkFor(req, createInvite(db, { userId: id, now: now() })) };
  });

  app.delete('/api/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const { id } = IdParam.parse(req.params);
    if (id === admin.id) throw new AccountError('Du kannst dich nicht selbst löschen');
    if (!getUser(db, id)) throw new NotFound('Person nicht gefunden');
    deleteUser(db, id);
    return { ok: true };
  });
}
```

`apps/server/src/app.ts`:
- Imports: `passwordMatches`, `createSession`, `sessionCookie`, `clearSessionCookie`, `verifySession`, `QRCode`, `pairingPayload`, `rotateToken` entfernen. Neu:
```ts
import { authenticateToken, getUser, touchUser } from './accounts.ts';
import { registerAccountRoutes } from './accountRoutes.ts';
import { LoginLimiter, SESSION_COOKIE, readCookie, sessionUserId, verifyUserSession } from './auth.ts';
import { NotFound, must, type Auth } from './http.ts';
```
  Die lokalen Definitionen `class NotFound` und `function must` und `LoginInput` in `app.ts` löschen (kommen aus `http.ts`).
- `PUBLIC_ROUTES`:
```ts
const PUBLIC_ROUTES = new Set(['/api/login', '/api/logout', '/api/health', '/api/device/login', '/api/invites/:token', '/api/invites/:token/accept']);
```
- In `buildApp` die Zeilen `sessionKey`, `hasSession`, `hasToken` ersetzen durch:
```ts
  const sessionAuth = (req: FastifyRequest): Auth | null => {
    const value = readCookie(req.headers.cookie, SESSION_COOKIE);
    const id = sessionUserId(value);
    const user = id ? getUser(db, id) : undefined;
    return user && verifyUserSession(value, cfg.sessionSecret, user.id, user.sessionEpoch, now()) ? { user, deviceId: null } : null;
  };
  const deviceAuth = (req: FastifyRequest): Auth | null => {
    const h = req.headers.authorization;
    const r = h?.startsWith('Bearer ') ? authenticateToken(db, h.slice(7), now()) : null;
    return r ? { user: r.user, deviceId: r.deviceId } : null;
  };
  app.decorateRequest('auth', null);
```
- Im `onRequest`-Hook `const bearer = hasToken(req);` ersetzen durch `const device = deviceAuth(req);`, in der CSRF-Bedingung `!bearer` → `!device`, und das Ende ab `const route = …` ersetzen durch:
```ts
    req.auth = device ?? sessionAuth(req);
    const route = req.routeOptions.url;
    if (route !== undefined && (!route.startsWith('/api/') || PUBLIC_ROUTES.has(route))) return;
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    touchUser(db, req.auth.user.id, now());
```
- Den Block „---- Anmeldung ----“ bis vor „---- Übersicht und Module ----“ ersetzen durch:
```ts
  // ---- Anmeldung und Konten ----
  app.get('/api/health', async () => ({ ok: true }));
  registerAccountRoutes(app, { db, cfg, now, limiter });
```
- Den Block „---- Koppeln …“ (`/api/pair`) löschen.
- Imports, die dadurch unbenutzt werden (`clientIp`, `z`-Schema `LoginInput`, `fastifyStatic` bleibt), entfernen; `tsc` meldet Reste.

`git rm apps/server/src/pair.ts apps/server/test/pair.test.ts`

- [ ] **Step 4: Tests und Typprüfung**

Run: `cd apps/server && nix develop -c npm test && cd ../.. && nix develop -c npm run typecheck`
Expected: alles PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/server
git commit -m "feat(server): per-person login, app login with device tokens, invites and people admin"
```

---

### Task 5: Persönlicher Lernstand – Repo, Lernen, Modulauswahl

**Files:**
- Modify: `apps/server/src/repo.ts`, `apps/server/src/study.ts`, `apps/server/src/app.ts` (Modul-, Notiz-, Karten-, Lern-, Sync-Routen), `apps/server/src/sync.ts` (nur `applyPush`-Signatur + Bewertungen)
- Test: `apps/server/test/personal.test.ts` (neu), `apps/server/test/study.test.ts`, `apps/server/test/repo.test.ts`, `apps/server/test/sync.test.ts`, `apps/server/test/sync-e2e.test.ts`, `apps/server/test/app.test.ts`, `apps/server/test/generation.test.ts`

**Interfaces:**
- Consumes: Tabellen (Task 1), `me(req)` (Task 4)
- Produces (`repo.ts`):
  - `createModule(db, input: { name; language; examDate?; newPerDay?; createdBy?: string }, now?): Module` – mit `createdBy` sofort Mitglied (mit `examDate`/`newPerDay`)
  - `updateModule(db, id, patch: Partial<Pick<Module, 'name' | 'language'>>, now?): Module` (nur Gemeinsames)
  - `getMyModule(db, userId, id): Module | undefined`, `listMyModules(db, userId): Module[]` (mit persönlichem `examDate`/`newPerDay`, `updatedAt = max(Modul, Mitgliedschaft)`)
  - `interface ModuleListItem { id: string; name: string; language: Language; memberCount: number; mine: boolean }`, `listAllModules(db, userId): ModuleListItem[]`
  - `memberIds(db, moduleId): string[]`
  - `joinModule(db, userId, moduleId, now, settings?: { examDate?: string | null; newPerDay?: number }): void` (nummeriert den Modulinhalt neu, wenn neu beigetreten)
  - `leaveModule(db, userId, moduleId): void` (nummeriert die Modulzeile neu)
  - `updateMembership(db, userId, moduleId, patch: { examDate?: string | null; newPerDay?: number }, now): void` (nummeriert die Modulzeile neu)
  - `bumpModuleContent(db, moduleId): void`
  - `setCardFlag(db, userId, cardId, suspended: boolean, now): void` (nummeriert die Karte neu); `setCardSuspended` entfällt
  - `insertRevlog(db, e: RevlogEntry, userId: string): void`; `revlogOwner(db, id): string | null`
  - `listRevlogForCard(db, userId, cardId)`, `saveCardState(db, userId, cardId, state, first)`, `studyRows(db, userId)`, `allReviewTimes(db, userId)`
  - `listNotes(db, filter & { userId?: string })` – mit `userId` nur eigene Module und Karten-`suspended` aus `card_flag`
- Produces (`study.ts`): `getNext(db, userId, scope, now)`, `recomputeCard(db, userId, cardId)`, `answer(db, { userId, cardId, rating, durationMs, deviceId, now })`, `undo(db, userId, revlogId, deviceId, now)`, `getOverview(db, userId, now)`
- Produces (`sync.ts`): `applyPush(db, userId, push)` (Bewertungen mit Person; Rest wie bisher bis Task 6)
- HTTP: `GET /api/modules/all`, `POST /api/modules/:id/join`, `POST /api/modules/:id/leave`; `GET /api/modules/:id` → `{ module, decks, mine, memberCount }`; `PATCH /api/modules/:id` trennt gemeinsam/persönlich (persönlich ohne Mitgliedschaft → 409); `DELETE /api/modules/:id` → 409, wenn andere Mitglied sind.

- [ ] **Step 1: Failing tests schreiben**

`apps/server/test/personal.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as repo from '../src/repo.ts';
import { answer, getNext, getOverview, undo } from '../src/study.ts';
import { addUser, memDb } from './helpers.ts';

const NOW = new Date('2026-10-21T10:00:00+09:00').getTime();

function setup() {
  const db = memDb();
  const luna = addUser(db, 'luna');
  const mia = addUser(db, 'mia');
  const mod = repo.createModule(db, { name: 'Cloud Security', language: 'en', examDate: '2026-11-20', createdBy: luna }, 1);
  repo.joinModule(db, mia, mod.id, 2);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' }, 1);
  const base = { deckId: deck.id, back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk' as const };
  const n1 = repo.insertNote(db, { ...base, kind: 'qa', front: 'Q1', position: 1 }, 1);
  repo.insertNote(db, { ...base, kind: 'qa', front: 'Q2', position: 2 }, 1);
  return { db, luna, mia, mod, deck, cardId: n1.cards[0]!.id };
}

describe('persönlicher Lernstand', () => {
  it('Bewertungen von Luna ändern nichts bei Mia', () => {
    const { db, luna, mia, cardId } = setup();
    answer(db, { userId: luna, cardId, rating: 4, durationMs: 1, deviceId: 'web', now: NOW });
    expect(getNext(db, luna, {}, NOW).counts).toEqual({ learning: 0, review: 0, new: 1 });
    expect(getNext(db, mia, {}, NOW).counts).toEqual({ learning: 0, review: 0, new: 2 });
    expect(getOverview(db, luna, NOW).studiedToday).toBe(1);
    expect(getOverview(db, mia, NOW).studiedToday).toBe(0);
    expect(repo.studyRows(db, mia).find((r) => r.cardId === cardId)!.state.reps).toBe(0);
  });

  it('fremde Bewertung lässt sich nicht zurücknehmen', () => {
    const { db, luna, mia, cardId } = setup();
    const { revlogId } = answer(db, { userId: luna, cardId, rating: 3, durationMs: 1, deviceId: 'web', now: NOW });
    expect(() => undo(db, mia, revlogId, 'web', NOW)).toThrow(/nicht gefunden/);
    undo(db, luna, revlogId, 'web', NOW);
  });

  it('Prüfungsdatum, neue Karten pro Tag und Zurückstellen sind persönlich', () => {
    const { db, luna, mia, mod, cardId } = setup();
    repo.updateMembership(db, mia, mod.id, { examDate: '2026-12-01', newPerDay: 5 }, 3);
    expect(repo.getMyModule(db, luna, mod.id)).toMatchObject({ examDate: '2026-11-20', newPerDay: 20 });
    expect(repo.getMyModule(db, mia, mod.id)).toMatchObject({ examDate: '2026-12-01', newPerDay: 5 });
    repo.setCardFlag(db, mia, cardId, true, 4);
    expect(repo.studyRows(db, mia).find((r) => r.cardId === cardId)!.suspended).toBe(true);
    expect(repo.studyRows(db, luna).find((r) => r.cardId === cardId)!.suspended).toBe(false);
  });

  it('Übersicht und Lernen nur mit eigenen Modulen', () => {
    const { db, luna, mia } = setup();
    repo.createModule(db, { name: 'Nur Mia', language: 'de', createdBy: mia }, 5);
    expect(getOverview(db, luna, NOW).modules.map((m) => m.name)).toEqual(['Cloud Security']);
    expect(getOverview(db, mia, NOW).modules.map((m) => m.name)).toEqual(['Cloud Security', 'Nur Mia']);
  });
});

describe('Modulauswahl', () => {
  it('alle Module mit Anzahl und eigener Auswahl; Beitreten und Verlassen', () => {
    const { db, luna, mia, mod } = setup();
    const other = repo.createModule(db, { name: 'UI/UX', language: 'en', createdBy: mia }, 5);
    expect(repo.listAllModules(db, luna)).toEqual([
      { id: mod.id, name: 'Cloud Security', language: 'en', memberCount: 2, mine: true },
      { id: other.id, name: 'UI/UX', language: 'en', memberCount: 1, mine: false },
    ]);
    repo.joinModule(db, luna, other.id, 6);
    repo.joinModule(db, luna, other.id, 7);
    expect(repo.memberIds(db, other.id).sort()).toEqual([luna, mia].sort());
    repo.leaveModule(db, luna, mod.id);
    expect(repo.listMyModules(db, luna).map((m) => m.name)).toEqual(['UI/UX']);
  });

  it('Beitreten nummeriert den Modulinhalt neu, damit Geräte ihn nachladen', () => {
    const { db, luna, deck } = setup();
    const other = repo.createModule(db, { name: 'Neu', language: 'en' }, 5);
    const d2 = repo.createDeck(db, { moduleId: other.id, title: 'D2', pdfSha256: 't' }, 5);
    const seqBefore = (db.prepare('SELECT seq FROM deck WHERE id = ?').get(d2.id) as { seq: number }).seq;
    repo.joinModule(db, luna, other.id, 6);
    expect((db.prepare('SELECT seq FROM deck WHERE id = ?').get(d2.id) as { seq: number }).seq).toBeGreaterThan(seqBefore);
    const lunaDeckSeq = (db.prepare('SELECT seq FROM deck WHERE id = ?').get(deck.id) as { seq: number }).seq;
    expect(lunaDeckSeq).toBeLessThan(seqBefore);
  });
});
```

Bestehende Tests mechanisch umstellen:
- `apps/server/test/study.test.ts`: Import `addUser` aus `./helpers.ts`; in `setup()` nach `memDb()` `const U = addUser(db);` und `createModule(..., { …, createdBy: U })`; `setup` gibt `U` mit zurück. Überall: `getNext(db, X, t)` → `getNext(db, U, X, t)`, `answer(db, { … })` → `answer(db, { userId: U, … })`, `undo(db, id, d, t)` → `undo(db, U, id, d, t)`, `getOverview(db, t)` → `getOverview(db, U, t)`, `repo.studyRows(db)` → `repo.studyRows(db, U)`, `repo.updateModule(db, id, { examDate… })` → `repo.updateMembership(db, U, id, { … }, t)`, `repo.setCardSuspended(db, id, s)` → `repo.setCardFlag(db, U, id, s, Date.now())`, `repo.insertRevlog(db, e)` → `repo.insertRevlog(db, e, U)`.
- `apps/server/test/repo.test.ts`: gleiche Regeln; Tests, die `updateModule` mit `examDate`/`newPerDay` prüfen, prüfen stattdessen `updateMembership` + `getMyModule`.
- `apps/server/test/sync.test.ts`: in `seeded()` `const U = addUser(db);`, `createModule(…, { …, createdBy: U })`; `applyPush(db, push)` → `applyPush(db, U, push)`; `getNext(db, {}, t)` → `getNext(db, U, {}, t)`; `repo.getModule(db, mod.id)!.examDate` → `repo.getMyModule(db, U, mod.id)!.examDate`.
- `apps/server/test/sync-e2e.test.ts`: `createModule(…, { …, createdBy: owner.id })` (dafür `owner` vor dem Modul anlegen); `getNext(db, …)` / `answer(db, …)` / `repo.studyRows(db)` mit `owner.id` wie oben.
- `apps/server/test/app.test.ts`: `repo.createModule(db, { … })` → `{ …, createdBy: user.id }`; `repo.insertRevlog(db, e)` → `repo.insertRevlog(db, e, user.id)`.
- `apps/server/test/generation.test.ts`: `repo.createModule` unverändert (ohne `createdBy`) – Erzeugung ist gemeinsam.

Neue HTTP-Tests in `apps/server/test/app.test.ts` am Ende anfügen:
```ts
describe('Module für mehrere Personen', () => {
  it('Anlegen macht zum Mitglied; Löschen nur, wenn niemand sonst das Modul hat', async () => {
    const { app, db } = await setup();
    const m = (await app.inject({ method: 'POST', url: '/api/modules', payload: { name: 'UI/UX', language: 'en' } })).json();
    expect((await app.inject({ method: 'GET', url: `/api/modules/${m.id}` })).json()).toMatchObject({ mine: true, memberCount: 1 });
    const other = addUser(db, 'mia');
    repo.joinModule(db, other, m.id, 1);
    const del = await app.inject({ method: 'DELETE', url: `/api/modules/${m.id}` });
    expect(del.statusCode).toBe(409);
    repo.leaveModule(db, other, m.id);
    expect((await app.inject({ method: 'DELETE', url: `/api/modules/${m.id}` })).statusCode).toBe(200);
  });
  it('alle Module, beitreten, verlassen; persönliche Einstellungen nur als Mitglied', async () => {
    const { app, db } = await setup();
    const fremd = repo.createModule(db, { name: 'Fremd', language: 'de' });
    expect((await app.inject({ method: 'GET', url: '/api/modules/all' })).json()).toMatchObject([{ name: 'Fremd', mine: false, memberCount: 0 }]);
    expect((await app.inject({ method: 'PATCH', url: `/api/modules/${fremd.id}`, payload: { examDate: '2026-12-01' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/modules/${fremd.id}/join` })).statusCode).toBe(200);
    const patched = await app.inject({ method: 'PATCH', url: `/api/modules/${fremd.id}`, payload: { examDate: '2026-12-01', name: 'Fremd 2' } });
    expect(patched.json()).toMatchObject({ name: 'Fremd 2', examDate: '2026-12-01' });
    expect((await app.inject({ method: 'POST', url: `/api/modules/${fremd.id}/leave` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/overview' })).json().modules).toEqual([]);
  });
});
```
(Import `addUser` aus `./helpers.ts` ergänzen.)

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `cd apps/server && nix develop -c npx vitest run test/personal.test.ts`
Expected: FAIL – `repo.joinModule is not a function` bzw. Signaturfehler.

- [ ] **Step 3: Implementierung `repo.ts`**

Module-Abschnitt ersetzen/ergänzen:
```ts
const toMyModule = (r: Row): Module => ({
  ...toModule(r), examDate: r.ms_exam_date ?? null, newPerDay: r.ms_new_per_day, updatedAt: Math.max(r.updated_at, r.ms_updated_at),
});

const MY_MODULES = `SELECT m.*, ms.exam_date AS ms_exam_date, ms.new_per_day AS ms_new_per_day, ms.updated_at AS ms_updated_at
  FROM module m JOIN membership ms ON ms.module_id = m.id AND ms.user_id = ? WHERE m.deleted = 0`;

export function getMyModule(db: Db, userId: string, id: string): Module | undefined {
  const r = db.prepare(`${MY_MODULES} AND m.id = ?`).get(userId, id) as Row | undefined;
  return r && toMyModule(r);
}

export function listMyModules(db: Db, userId: string): Module[] {
  return (db.prepare(`${MY_MODULES} ORDER BY m.name`).all(userId) as Row[]).map(toMyModule);
}

export interface ModuleListItem {
  id: string;
  name: string;
  language: Language;
  memberCount: number;
  mine: boolean;
}

export function listAllModules(db: Db, userId: string): ModuleListItem[] {
  return (db.prepare(
    `SELECT m.id, m.name, m.language,
            (SELECT COUNT(*) FROM membership ms WHERE ms.module_id = m.id) AS member_count,
            EXISTS (SELECT 1 FROM membership ms WHERE ms.module_id = m.id AND ms.user_id = ?) AS mine
     FROM module m WHERE m.deleted = 0 ORDER BY m.name`,
  ).all(userId) as Row[]).map((r) => ({ id: r.id, name: r.name, language: r.language, memberCount: r.member_count, mine: !!r.mine }));
}

export function memberIds(db: Db, moduleId: string): string[] {
  return (db.prepare('SELECT user_id FROM membership WHERE module_id = ?').all(moduleId) as Row[]).map((r) => r.user_id);
}

export function createModule(
  db: Db,
  input: { name: string; language: Language; examDate?: string | null; newPerDay?: number; createdBy?: string },
  now = Date.now(),
): Module {
  const id = newId();
  return tx(db, () => {
    db.prepare('INSERT INTO module (id, name, language, updated_at, seq) VALUES (?, ?, ?, ?, ?)').run(id, input.name, input.language, now, nextSeq(db));
    if (input.createdBy) joinModule(db, input.createdBy, id, now, { examDate: input.examDate, newPerDay: input.newPerDay });
    return getModule(db, id)!;
  });
}

export function updateModule(db: Db, id: string, patch: Partial<Pick<Module, 'name' | 'language'>>, now = Date.now()): Module {
  const cur = getModule(db, id);
  if (!cur) throw new Error(`Modul ${id} nicht gefunden`);
  const next = { ...cur, ...patch };
  db.prepare('UPDATE module SET name = ?, language = ?, updated_at = ?, seq = ? WHERE id = ?').run(next.name, next.language, now, nextSeq(db), id);
  return getModule(db, id)!;
}

/** Neue seq für alle Zeilen eines Moduls: Geräte, die es gerade gewählt haben, laden auch den alten Inhalt. */
export function bumpModuleContent(db: Db, moduleId: string): void {
  tx(db, () => {
    db.prepare('UPDATE module SET seq = ? WHERE id = ?').run(nextSeq(db), moduleId);
    for (const d of db.prepare('SELECT id FROM deck WHERE module_id = ?').all(moduleId) as Row[]) {
      db.prepare('UPDATE deck SET seq = ? WHERE id = ?').run(nextSeq(db), d.id);
      for (const s of db.prepare('SELECT page FROM slide WHERE deck_id = ?').all(d.id) as Row[]) {
        db.prepare('UPDATE slide SET seq = ? WHERE deck_id = ? AND page = ?').run(nextSeq(db), d.id, s.page);
      }
      for (const n of db.prepare('SELECT id FROM note WHERE deck_id = ?').all(d.id) as Row[]) {
        db.prepare('UPDATE note SET seq = ? WHERE id = ?').run(nextSeq(db), n.id);
        for (const c of db.prepare('SELECT id FROM card WHERE note_id = ?').all(n.id) as Row[]) {
          db.prepare('UPDATE card SET seq = ? WHERE id = ?').run(nextSeq(db), c.id);
        }
      }
    }
  });
}

export function joinModule(
  db: Db, userId: string, moduleId: string, now: number, settings: { examDate?: string | null; newPerDay?: number } = {},
): void {
  tx(db, () => {
    const r = db.prepare(
      'INSERT OR IGNORE INTO membership (user_id, module_id, exam_date, new_per_day, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING user_id',
    ).get(userId, moduleId, settings.examDate ?? null, settings.newPerDay ?? 20, now);
    if (r) bumpModuleContent(db, moduleId);
  });
}

export function leaveModule(db: Db, userId: string, moduleId: string): void {
  tx(db, () => {
    db.prepare('DELETE FROM membership WHERE user_id = ? AND module_id = ?').run(userId, moduleId);
    db.prepare('UPDATE module SET seq = ? WHERE id = ?').run(nextSeq(db), moduleId);
  });
}

export function updateMembership(
  db: Db, userId: string, moduleId: string, patch: { examDate?: string | null; newPerDay?: number }, now: number,
): void {
  const cur = getMyModule(db, userId, moduleId);
  if (!cur) throw new Error('Modul ist nicht in deinen Modulen');
  tx(db, () => {
    db.prepare('UPDATE membership SET exam_date = ?, new_per_day = ?, updated_at = ? WHERE user_id = ? AND module_id = ?')
      .run(patch.examDate !== undefined ? patch.examDate : cur.examDate, patch.newPerDay ?? cur.newPerDay, now, userId, moduleId);
    db.prepare('UPDATE module SET seq = ? WHERE id = ?').run(nextSeq(db), moduleId);
  });
}
```
Karten/Bewertungen:
```ts
export function setCardFlag(db: Db, userId: string, cardId: string, suspended: boolean, now: number): void {
  tx(db, () => {
    db.prepare(
      `INSERT INTO card_flag (user_id, card_id, suspended, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, card_id) DO UPDATE SET suspended = excluded.suspended, updated_at = excluded.updated_at`,
    ).run(userId, cardId, suspended ? 1 : 0, now);
    db.prepare('UPDATE card SET seq = ? WHERE id = ?').run(nextSeq(db), cardId);
  });
}
```
`setCardSuspended` löschen.

```ts
export function insertRevlog(db: Db, e: RevlogEntry, userId: string): void {
  const exists = db.prepare('SELECT 1 FROM revlog WHERE id = ?').get(e.id);
  if (exists) return;
  db.prepare(
    'INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, revokes, seq, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.id, e.cardId, e.rating, e.reviewedAt, e.durationMs, e.deviceId, e.revokes, nextSeq(db), userId);
}

export function revlogOwner(db: Db, id: string): string | null {
  const r = db.prepare('SELECT user_id FROM revlog WHERE id = ?').get(id) as Row | undefined;
  return r?.user_id ?? null;
}

export function listRevlogForCard(db: Db, userId: string, cardId: string): RevlogEntry[] {
  return (db.prepare('SELECT * FROM revlog WHERE user_id = ? AND card_id = ?').all(userId, cardId) as Row[]).map(toRevlog);
}

export function saveCardState(db: Db, userId: string, cardId: string, state: CardState, firstReviewedAt: number | null): void {
  db.prepare(
    `INSERT INTO user_card_state (user_id, card_id, json, first_reviewed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, card_id) DO UPDATE SET json = excluded.json, first_reviewed_at = excluded.first_reviewed_at`,
  ).run(userId, cardId, JSON.stringify(state), firstReviewedAt);
}

export function studyRows(db: Db, userId: string): QueueCard[] {
  const rows = db.prepare(
    `SELECT c.id AS card_id, c.ordinal, COALESCE(f.suspended, 0) AS suspended, n.id AS note_id, n.position AS note_pos,
            d.id AS deck_id, d.position AS deck_pos, d.module_id, s.json, s.first_reviewed_at
     FROM card c
     JOIN note n ON n.id = c.note_id
     JOIN deck d ON d.id = n.deck_id
     JOIN module m ON m.id = d.module_id
     JOIN membership ms ON ms.module_id = m.id AND ms.user_id = ?
     LEFT JOIN user_card_state s ON s.card_id = c.id AND s.user_id = ?
     LEFT JOIN card_flag f ON f.card_id = c.id AND f.user_id = ?
     WHERE c.deleted = 0 AND n.deleted = 0 AND d.deleted = 0 AND m.deleted = 0`,
  ).all(userId, userId, userId) as Row[];
  return rows.map((r) => ({
    cardId: r.card_id,
    noteId: r.note_id,
    deckId: r.deck_id,
    moduleId: r.module_id,
    sortKey: [r.deck_pos, r.note_pos, r.ordinal] as [number, number, number],
    state: r.json ? (JSON.parse(r.json) as CardState) : emptyState(),
    firstReviewedAt: r.first_reviewed_at ?? null,
    suspended: !!r.suspended,
  }));
}

export function allReviewTimes(db: Db, userId: string): number[] {
  return (db.prepare(
    `SELECT reviewed_at FROM revlog r WHERE r.user_id = ? AND rating >= 1
     AND NOT EXISTS (SELECT 1 FROM revlog u WHERE u.revokes = r.id)`,
  ).all(userId) as Row[]).map((r) => r.reviewed_at);
}
```

`listNotes`: Filter um `userId?: string` erweitern; wenn gesetzt:
```ts
  if (filter.userId) { where.push('d.module_id IN (SELECT module_id FROM membership WHERE user_id = ?)'); params.push(filter.userId); }
```
(vor `params.push(filter.limit ?? 500)`), und die Karten personalisieren:
```ts
  const flags = (cardId: string) => filter.userId
    ? !!(db.prepare('SELECT suspended FROM card_flag WHERE user_id = ? AND card_id = ?').get(filter.userId, cardId) as Row | undefined)?.suspended
    : false;
  return rows.map((r) => ({
    ...toNote(r), deckTitle: r.deck_title,
    cards: listCardsOfNote(db, r.id).filter((c) => !c.deleted).map((c) => ({ ...c, suspended: flags(c.id) })),
  }));
```

- [ ] **Step 4: Implementierung `study.ts`**

```ts
function queueModules(db: Db, userId: string): QueueModule[] {
  return repo.listMyModules(db, userId).map((m) => ({ id: m.id, examDate: m.examDate, newPerDay: m.newPerDay }));
}

export function getNext(db: Db, userId: string, scope: Scope, now: number): { card: StudyCard | null; counts: QueueCounts } {
  const mods = repo.listMyModules(db, userId);
  const { next, counts } = nextCard(repo.studyRows(db, userId), queueModules(db, userId), scope, now);
  // … Rest unverändert …
}

export function recomputeCard(db: Db, userId: string, cardId: string): void {
  const logs = repo.listRevlogForCard(db, userId, cardId);
  const first = effectiveLogs(logs)[0]?.reviewedAt ?? null;
  repo.saveCardState(db, userId, cardId, replay(logs), first);
}

export function answer(
  db: Db,
  i: { userId: string; cardId: string; rating: Grade; durationMs: number; deviceId: string; now: number },
): { revlogId: string } {
  if (!repo.getCard(db, i.cardId)) throw new Error(`Karte ${i.cardId} nicht gefunden`);
  const id = newId();
  tx(db, () => {
    repo.insertRevlog(db, {
      id, cardId: i.cardId, rating: i.rating, reviewedAt: i.now, durationMs: Math.max(0, Math.round(i.durationMs)),
      deviceId: i.deviceId, revokes: null,
    }, i.userId);
    recomputeCard(db, i.userId, i.cardId);
  });
  return { revlogId: id };
}

export function undo(db: Db, userId: string, revlogId: string, deviceId: string, now: number): void {
  const target = repo.getRevlog(db, revlogId);
  if (!target || target.revokes !== null || repo.revlogOwner(db, revlogId) !== userId) throw new Error('Bewertung nicht gefunden');
  const already = db.prepare('SELECT 1 FROM revlog WHERE revokes = ?').get(revlogId);
  if (already) throw new Error('Bewertung wurde bereits zurückgenommen');
  tx(db, () => {
    repo.insertRevlog(db, { id: newId(), cardId: target.cardId, rating: 0, reviewedAt: now, durationMs: 0, deviceId, revokes: revlogId }, userId);
    recomputeCard(db, userId, target.cardId);
  });
}

export function getOverview(db: Db, userId: string, now: number): Overview {
  const times = repo.allReviewTimes(db, userId);
  const today = studyDay(now);
  const rows = repo.studyRows(db, userId);
  return {
    studiedToday: times.filter((t) => studyDay(t) === today).length,
    streak: streak(times, now),
    modules: repo.listMyModules(db, userId).map((m) => ({
      ...moduleStats(rows, { id: m.id, examDate: m.examDate, newPerDay: m.newPerDay }, now),
      name: m.name, language: m.language, examDate: m.examDate, newPerDay: m.newPerDay,
    })),
  };
}
```

`sync.ts`: `export function applyPush(db: Db, userId: string, push: SyncPush): void` – im Bewertungsteil `insertRevlog(db, r)` → `insertRevlog(db, r, userId)` und `recomputeCard(db, id)` → `recomputeCard(db, userId, id)`. Modul- und Kartenteil bleiben bis Task 6 wie sie sind, nur `exam_date`/`new_per_day` werden jetzt über die Mitgliedschaft geschrieben:
```ts
    for (const m of push.modules) {
      const cur = current(db, 'module', m.id);
      if (!cur) continue;
      if ((cur.deleted && !m.deleted) || m.updatedAt <= cur.updated_at) {
        bump(db, 'module', m.id);
        continue;
      }
      db.prepare('UPDATE module SET name = ?, language = ?, deleted = ?, updated_at = ?, seq = ? WHERE id = ?')
        .run(m.name, m.language, m.deleted ? 1 : 0, m.updatedAt, nextSeq(db), m.id);
      if (getMyModule(db, userId, m.id)) updateMembership(db, userId, m.id, { examDate: m.examDate, newPerDay: m.newPerDay }, m.updatedAt);
    }
```
(Imports `getMyModule`, `updateMembership` aus `./repo.ts`.)

- [ ] **Step 5: Routen in `app.ts`**

Import `me` aus `./http.ts`. Schemas:
```ts
const ModuleInput = z.object({
  name: z.string().trim().min(1).max(100),
  language: z.enum(['en', 'de']),
  examDate: DateStr.nullable().optional(),
  newPerDay: z.number().int().min(0).max(500).optional(),
});
const ModulePatch = ModuleInput.partial();
```
(unverändert). Routen:
```ts
  app.get('/api/overview', async (req) => getOverview(db, me(req).id, now()));

  app.get('/api/modules/all', async (req) => repo.listAllModules(db, me(req).id));

  app.post('/api/modules', async (req) => {
    const input = ModuleInput.parse(req.body);
    const uid = me(req).id;
    const m = repo.createModule(db, { ...input, createdBy: uid }, now());
    return repo.getMyModule(db, uid, m.id)!;
  });

  app.get('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const uid = me(req).id;
    const shared = must(repo.getModule(db, id), 'Modul');
    const mine = repo.getMyModule(db, uid, id);
    const decks = repo.listDecks(db, id).map((d) => ({ ...d, noteCount: repo.countNotes(db, d.id) }));
    return { module: mine ?? shared, decks, mine: !!mine, memberCount: repo.memberIds(db, id).length };
  });

  app.patch('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const uid = me(req).id;
    must(repo.getModule(db, id), 'Modul');
    const patch = ModulePatch.parse(req.body);
    const personal = patch.examDate !== undefined || patch.newPerDay !== undefined;
    if (personal && !repo.getMyModule(db, uid, id)) {
      throw Object.assign(new Error('Erst zu deinen Modulen hinzufügen'), { statusCode: 409 });
    }
    if (patch.name !== undefined || patch.language !== undefined) {
      repo.updateModule(db, id, { ...(patch.name !== undefined && { name: patch.name }), ...(patch.language !== undefined && { language: patch.language }) }, now());
    }
    if (personal) repo.updateMembership(db, uid, id, { examDate: patch.examDate, newPerDay: patch.newPerDay }, now());
    return repo.getMyModule(db, uid, id) ?? repo.getModule(db, id)!;
  });

  app.delete('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const uid = me(req).id;
    must(repo.getModule(db, id), 'Modul');
    if (repo.memberIds(db, id).some((u) => u !== uid)) {
      throw Object.assign(new Error('Andere lernen dieses Modul – nur aus deinen Modulen entfernen'), { statusCode: 409 });
    }
    repo.leaveModule(db, uid, id);
    repo.deleteModule(db, id, now());
    return { ok: true };
  });

  app.post('/api/modules/:id/join', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getModule(db, id), 'Modul');
    repo.joinModule(db, me(req).id, id, now());
    return { ok: true };
  });

  app.post('/api/modules/:id/leave', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getModule(db, id), 'Modul');
    repo.leaveModule(db, me(req).id, id);
    return { ok: true };
  });
```
Weitere Routen:
- `GET /api/notes`: `repo.listNotes(db, { ...NotesQuery.parse(req.query), userId: me(req).id })`
- `POST /api/cards/:id/suspend`: `repo.setCardFlag(db, me(req).id, id, suspended, now())`
- `GET /api/study/next`: `getNext(db, me(req).id, ScopeQuery.parse(req.query), now())`
- `POST /api/study/answer`: `answer(db, { ...a, userId: me(req).id, deviceId: cfg.deviceId, now: now() })`
- `POST /api/study/undo`: `undo(db, me(req).id, revlogId, cfg.deviceId, now())`
- `POST /api/sync`: `applyPush(db, me(req).id, body.push)` (Pull bleibt bis Task 6 `pullSince(db, body.cursor)`)

- [ ] **Step 6: Tests und Typprüfung**

Run: `cd apps/server && nix develop -c npm test && cd ../.. && nix develop -c npm run typecheck`
Expected: alles PASS.

- [ ] **Step 7: Commit**

```bash
git add -A apps/server
git commit -m "feat(server): personal progress, module selection and personal settings per person"
```

---

### Task 6: Sync – Sicht der Person

**Files:**
- Modify: `apps/server/src/sync.ts`, `apps/server/src/app.ts` (Sync-Route)
- Test: `apps/server/test/sync.test.ts`, `apps/server/test/sync-e2e.test.ts`

**Interfaces:**
- Consumes: `getMyModule`, `updateMembership`, `leaveModule`, `memberIds`, `deleteModule`, `setCardFlag`, `insertRevlog`, `recomputeCard` (Task 5)
- Produces: `applyPush(db, userId, push)` (vollständig getrennt), `pullSince(db, userId, cursor, limit?)`

- [ ] **Step 1: Failing tests schreiben**

In `apps/server/test/sync.test.ts` (nach Task-5-Umstellung, `seeded()` liefert `U`) anfügen:
```ts
describe('Sicht der Person', () => {
  it('liefert nur Inhalte eigener Module, fremde Module als gelöscht', () => {
    const { db, mod } = seeded();
    const mia = addUser(db, 'mia');
    const page = pullSince(db, mia, 0);
    expect(page.pull.decks).toEqual([]);
    expect(page.pull.notes).toEqual([]);
    expect(page.pull.modules).toEqual([expect.objectContaining({ id: mod.id, deleted: true })]);
  });

  it('Join liefert alten Inhalt, auch wenn der Cursor schon weiter ist', () => {
    const { db, mod } = seeded();
    const mia = addUser(db, 'mia');
    const cursor = pullSince(db, mia, 0).cursor;
    repo.joinModule(db, mia, mod.id, 5000);
    const page = pullSince(db, mia, cursor);
    expect(page.pull.modules).toEqual([expect.objectContaining({ id: mod.id, deleted: false })]);
    expect(page.pull.decks).toHaveLength(1);
    expect(page.pull.slides).toHaveLength(1);
    expect(page.pull.notes).toHaveLength(2);
    expect(page.pull.cards).toHaveLength(2);
  });

  it('Leave liefert das Modul als gelöscht', () => {
    const { db, mod, U } = seeded();
    const cursor = pullSince(db, U, 0).cursor;
    repo.leaveModule(db, U, mod.id);
    expect(pullSince(db, U, cursor).pull.modules).toEqual([expect.objectContaining({ id: mod.id, deleted: true })]);
  });

  it('fremde Bewertungen werden nie geliefert', () => {
    const { db, mod, qa, U } = seeded();
    const mia = addUser(db, 'mia');
    repo.joinModule(db, mia, mod.id, 2000);
    applyPush(db, mia, { ...emptyPush(), revlog: [{ id: 'r-mia', cardId: qa.cards[0]!.id, rating: 3, reviewedAt: 3000, durationMs: 1, deviceId: 'mia-phone', revokes: null }] });
    expect(pullSince(db, U, 0).pull.revlog).toEqual([]);
    expect(pullSince(db, mia, 0).pull.revlog.map((r) => r.id)).toEqual(['r-mia']);
    expect(repo.studyRows(db, U).find((r) => r.cardId === qa.cards[0]!.id)!.state.reps).toBe(0);
  });

  it('persönliche Felder kommen aus Mitgliedschaft und Flags', () => {
    const { db, mod, qa, U } = seeded();
    repo.updateMembership(db, U, mod.id, { examDate: '2026-12-01', newPerDay: 7 }, 6000);
    repo.setCardFlag(db, U, qa.cards[0]!.id, true, 6000);
    const page = pullSince(db, U, 0).pull;
    expect(page.modules[0]).toMatchObject({ examDate: '2026-12-01', newPerDay: 7 });
    expect(page.cards.find((c) => c.id === qa.cards[0]!.id)).toMatchObject({ suspended: true, updatedAt: 6000 });
  });

  it('Push trennt persönlich und gemeinsam; Löschen vom Gerät = Verlassen', () => {
    const { db, mod, qa, U } = seeded();
    const mia = addUser(db, 'mia');
    repo.joinModule(db, mia, mod.id, 2000);
    applyPush(db, mia, {
      ...emptyPush(),
      modules: [{ ...mod, examDate: '2026-12-24', newPerDay: 3, updatedAt: 7000 }],
      cards: [{ ...qa.cards[0]!, suspended: true, updatedAt: 7000 }],
    });
    expect(repo.getMyModule(db, mia, mod.id)).toMatchObject({ examDate: '2026-12-24', newPerDay: 3 });
    expect(repo.getMyModule(db, U, mod.id)!.examDate).toBeNull();
    expect(repo.studyRows(db, U).find((r) => r.cardId === qa.cards[0]!.id)!.suspended).toBe(false);
    applyPush(db, mia, { ...emptyPush(), modules: [{ ...mod, deleted: true, updatedAt: 8000 }] });
    expect(repo.memberIds(db, mod.id)).toEqual([U]);
    expect(repo.getModule(db, mod.id)).toBeDefined();
    applyPush(db, U, { ...emptyPush(), modules: [{ ...mod, deleted: true, updatedAt: 9000 }] });
    expect(repo.getModule(db, mod.id)).toBeUndefined();
  });
});
```
(Import `addUser` aus `./helpers.ts`.) Die bestehenden Tests in `sync.test.ts` rufen `pullSince(db, U, …)` statt `pullSince(db, …)`; der Test „legt neue Lücken-Karten vom Handy an und übernimmt Pausieren“ prüft das Pausieren jetzt über `repo.studyRows(db, U)` bzw. `card_flag`:
```ts
    const cards = repo.listCardsOfNote(db, cz.note.id);
    expect(cards.map((c) => c.ordinal)).toEqual([1, 2]);
    const flagged = repo.studyRows(db, U).filter((r) => r.suspended).map((r) => r.cardId);
    expect(flagged).toEqual([cz.cards[0]!.id]);
```

In `apps/server/test/sync-e2e.test.ts` anfügen (nutzt `nodeAdapter`, `memDb`, `buildApp` der Datei):
```ts
describe('zwei Personen, zwei Handys', () => {
  it('lernen dasselbe Modul offline, jede behält ihren Stand, Karteninhalte sind gemeinsam', async () => {
    const db = memDb();
    const cfg = { dataDir: '/tmp', port: 0, host: '127.0.0.1', token: 't', deviceId: 'server', password: null, adminName: 'luna', sessionSecret: 's', publicUrl: null, claudePath: '', summaryModel: null, cardsModel: null, webDir: null };
    const worker = { wake() {}, resume() {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
    const app = buildApp({ db, cfg, worker, now: () => NOW });
    const luna = createUser(db, { name: 'luna', password: 'pw-luna-123', isAdmin: true, now: NOW });
    const mia = createUser(db, { name: 'mia', password: 'pw-mia-1234', now: NOW });
    const mod = repo.createModule(db, { name: 'Cloud', language: 'en', createdBy: luna.id }, NOW - 60_000);
    repo.joinModule(db, mia.id, mod.id, NOW - 60_000);
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' }, NOW - 60_000);
    for (let i = 0; i < 2; i++) {
      repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: `Q${i}`, back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: i }, NOW - 60_000);
    }
    const phoneOf = async (userId: string) => {
      const { token } = addDevice(db, userId, 'Handy', NOW);
      const transport = async (req: SyncRequest): Promise<SyncResponse> => {
        const r = await app.inject({ method: 'POST', url: '/api/sync', payload: req, headers: { authorization: `Bearer ${token}` } });
        if (r.statusCode !== 200) throw new Error(r.body);
        return r.json();
      };
      return { store: await LocalStore.open(nodeAdapter(), { now: () => NOW }), transport };
    };
    const a = await phoneOf(luna.id);
    const b = await phoneOf(mia.id);
    await syncStore(a.store, a.transport);
    await syncStore(b.store, b.transport);
    const card = (await a.store.next({})).card!;
    await a.store.answer(card.cardId, 4, 1000);
    await a.store.updateNote(card.noteId, { front: 'Q0 verbessert', back: 'A' });
    await syncStore(a.store, a.transport);
    await syncStore(b.store, b.transport);
    expect((await a.store.next({})).counts.new).toBe(1);
    expect((await b.store.next({})).counts.new).toBe(2);
    const [note] = await b.store.db.all<{ front: string }>('SELECT front FROM note WHERE id = ?', [card.noteId]);
    expect(note!.front).toBe('Q0 verbessert');
    expect(await b.store.db.all('SELECT * FROM revlog')).toEqual([]);
  });
});
```
(Imports `createUser`, `addDevice` aus `../src/accounts.ts` – aus Task 4 schon vorhanden.)

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `cd apps/server && nix develop -c npx vitest run test/sync.test.ts test/sync-e2e.test.ts`
Expected: FAIL – `pullSince` liefert fremde Inhalte/Bewertungen; `deleted: true` fehlt.

- [ ] **Step 3: Implementierung `sync.ts`**

Imports ergänzen: `deleteModule, getMyModule, leaveModule, memberIds, setCardFlag, updateMembership` aus `./repo.ts`.

Modul- und Kartenteil in `applyPush(db, userId, push)` ersetzen:
```ts
    for (const m of push.modules) {
      const cur = current(db, 'module', m.id);
      if (!cur) continue;
      const mine = !!getMyModule(db, userId, m.id);
      if (m.deleted) {
        // Löschen auf dem Gerät = aus meinen Modulen entfernen; gemeinsam gelöscht nur ohne weitere Mitglieder.
        if (mine) leaveModule(db, userId, m.id);
        if (!cur.deleted && memberIds(db, m.id).length === 0) deleteModule(db, m.id, Math.max(m.updatedAt, cur.updated_at + 1));
        continue;
      }
      if (!mine) continue;
      if (cur.deleted || m.updatedAt <= cur.updated_at) bump(db, 'module', m.id);
      else {
        db.prepare('UPDATE module SET name = ?, language = ?, updated_at = ?, seq = ? WHERE id = ?')
          .run(m.name, m.language, m.updatedAt, nextSeq(db), m.id);
      }
      const ms = db.prepare('SELECT updated_at FROM membership WHERE user_id = ? AND module_id = ?').get(userId, m.id) as { updated_at: number };
      if (m.updatedAt > ms.updated_at) updateMembership(db, userId, m.id, { examDate: m.examDate, newPerDay: m.newPerDay }, m.updatedAt);
    }
```
```ts
    for (const c of push.cards) {
      const cur = current(db, 'card', c.id);
      if (cur) {
        if (c.updatedAt <= cur.updated_at) bump(db, 'card', c.id);
        else {
          db.prepare('UPDATE card SET deleted = ?, updated_at = ?, seq = ? WHERE id = ?').run(c.deleted ? 1 : 0, c.updatedAt, nextSeq(db), c.id);
        }
        touchedNotes.add(c.noteId);
      } else if (db.prepare('SELECT 1 FROM note WHERE id = ?').get(c.noteId)) {
        db.prepare('INSERT INTO card (id, note_id, ordinal, deleted, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?)')
          .run(c.id, c.noteId, c.ordinal, c.deleted ? 1 : 0, c.updatedAt, nextSeq(db));
        touchedNotes.add(c.noteId);
      } else continue;
      // „Zurückgestellt“ ist persönlich (Last-Writer-Wins über card_flag.updated_at).
      const f = db.prepare('SELECT suspended, updated_at FROM card_flag WHERE user_id = ? AND card_id = ?').get(userId, c.id) as { suspended: number; updated_at: number } | undefined;
      if ((f ? c.updatedAt > f.updated_at : c.suspended) && (!f || !!f.suspended !== c.suspended)) setCardFlag(db, userId, c.id, c.suspended, c.updatedAt);
    }
```

`pullSince` ersetzen:
```ts
type Item = { seq: number; key: keyof SyncPull; row: unknown };

/** Zeilen mit seq > cursor aus Sicht der Person, global nach seq sortiert, höchstens `limit` pro Antwort. */
export function pullSince(db: Db, userId: string, cursor: number, limit = SYNC_PAGE_SIZE): SyncResponse {
  const n = limit + 1;
  const items: Item[] = [];
  const add = (key: keyof SyncPull, rows: Row[], map: (r: Row) => unknown) => {
    for (const r of rows) items.push({ seq: r.seq, key, row: map(r) });
  };
  const MINE = 'IN (SELECT module_id FROM membership WHERE user_id = ?)';
  add('modules', db.prepare(
    `SELECT m.*, ms.exam_date AS ms_exam_date, ms.new_per_day AS ms_new_per_day, ms.updated_at AS ms_updated_at
     FROM module m LEFT JOIN membership ms ON ms.module_id = m.id AND ms.user_id = ?
     WHERE m.seq > ? ORDER BY m.seq LIMIT ?`,
  ).all(userId, cursor, n) as Row[], (r) => (r.ms_updated_at == null
    ? { ...toModule(r), deleted: true }
    : { ...toModule(r), examDate: r.ms_exam_date ?? null, newPerDay: r.ms_new_per_day, updatedAt: Math.max(r.updated_at, r.ms_updated_at) }));
  add('decks', db.prepare(`SELECT * FROM deck WHERE module_id ${MINE} AND seq > ? ORDER BY seq LIMIT ?`).all(userId, cursor, n) as Row[], toDeck);
  add('slides', db.prepare(
    `SELECT s.* FROM slide s JOIN deck d ON d.id = s.deck_id WHERE d.module_id ${MINE} AND s.seq > ? ORDER BY s.seq LIMIT ?`,
  ).all(userId, cursor, n) as Row[], toSlideRow);
  add('notes', db.prepare(
    `SELECT n.* FROM note n JOIN deck d ON d.id = n.deck_id WHERE d.module_id ${MINE} AND n.seq > ? ORDER BY n.seq LIMIT ?`,
  ).all(userId, cursor, n) as Row[], toNote);
  add('cards', db.prepare(
    `SELECT c.*, f.suspended AS f_suspended, f.updated_at AS f_updated_at FROM card c
     JOIN note n ON n.id = c.note_id JOIN deck d ON d.id = n.deck_id
     LEFT JOIN card_flag f ON f.card_id = c.id AND f.user_id = ?
     WHERE d.module_id ${MINE} AND c.seq > ? ORDER BY c.seq LIMIT ?`,
  ).all(userId, userId, cursor, n) as Row[], (r) => ({
    ...toCard(r), suspended: !!r.f_suspended, updatedAt: Math.max(r.updated_at, r.f_updated_at ?? 0),
  }));
  add('revlog', db.prepare('SELECT * FROM revlog WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(userId, cursor, n) as Row[], toRevlog);
  items.sort((a, b) => a.seq - b.seq);
  const page = items.slice(0, limit);
  const pull: SyncPull = { modules: [], decks: [], slides: [], notes: [], cards: [], revlog: [] };
  for (const i of page) (pull[i.key] as unknown[]).push(i.row);
  return { cursor: page.length ? page[page.length - 1]!.seq : cursor, hasMore: items.length > limit, pull };
}
```
Die alte `TABLES`-Konstante löschen.

`app.ts` Sync-Route: `return pullSince(db, me(req).id, body.cursor);`

- [ ] **Step 4: Tests und Typprüfung**

Run: `cd apps/server && nix develop -c npm test && cd ../.. && nix develop -c npm run typecheck`
Expected: alles PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/sync.ts apps/server/src/app.ts apps/server/test/sync.test.ts apps/server/test/sync-e2e.test.ts
git commit -m "feat(server): sync delivers each person's view and splits personal from shared on push"
```

---

### Task 7: Web-Oberfläche

**Files:**
- Modify: `apps/client/src/api.ts`, `apps/client/src/router.ts`, `apps/client/src/main.tsx`, `apps/client/src/pages/Home.tsx`, `apps/client/src/pages/ModulePage.tsx`, `apps/client/src/pages/LoginPage.tsx`, `apps/client/src/styles.css`
- Create: `apps/client/src/me.tsx`, `apps/client/src/pages/AllModulesPage.tsx`, `apps/client/src/pages/InvitePage.tsx`, `apps/client/src/pages/AccountPage.tsx`, `apps/client/src/pages/PeoplePage.tsx`
- Delete: `apps/client/src/pages/PairPage.tsx`
- Test: `apps/client/test/api.test.ts`, `apps/client/test/router.test.ts`

**Interfaces:**
- Consumes: HTTP-Endpunkte aus Task 4–6
- Produces:
  - `api.ts`: `interface Me { id: string; name: string; isAdmin: boolean }`, `interface ModuleListItem { id; name; language; memberCount; mine }`, `interface DeviceInfo { id; name; createdAt; lastSeenAt }`, `interface Person extends Me { createdAt; lastSeenAt; moduleCount; deviceCount }`; `api.login(name, password)`, `api.me()`, `api.changePassword(old, next)`, `api.devices()`, `api.removeDevice(id)`, `api.allModules()`, `api.joinModule(id)`, `api.leaveModule(id)`, `api.invite()`, `api.inviteInfo(token)`, `api.acceptInvite(token, { name?, password })`, `api.people()`, `api.resetLink(id)`, `api.deletePerson(id)`; `api.module(id)` liefert zusätzlich `mine`, `memberCount`. `api.pair`/`api.rotateToken` entfallen. 401 von `/api/invites/…` löst keine Login-Seite aus.
  - `router.ts`: Routen `all` (`#/alle`), `invite` (`#/einladung/<token>`, `params.token`), `account` (`#/konto`), `people` (`#/personen`); `pair` entfällt.
  - `me.tsx`: `MeContext`, `useMe(): Me | null`, Komponente `TopNav`.

- [ ] **Step 1: Failing tests schreiben**

`apps/client/test/router.test.ts`: in der `it.each`-Tabelle die Zeile `['#/pair', …]` ersetzen durch
```ts
    ['#/alle', { name: 'all', params: {} }],
    ['#/konto', { name: 'account', params: {} }],
    ['#/personen', { name: 'people', params: {} }],
    ['#/einladung/abc_DEF-123', { name: 'invite', params: { token: 'abc_DEF-123' } }],
```
und im `href`-Test ergänzen:
```ts
    expect(href('all')).toBe('#/alle');
    expect(href('invite', { token: 't1' })).toBe('#/einladung/t1');
```

`apps/client/test/api.test.ts` anfügen:
```ts
describe('Konten-API', () => {
  it('Login schickt Name und Passwort; Einladungs-401 löst keine Login-Seite aus', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/invites') ? { error: 'x' } : { id: '1', name: 'Luna', isAdmin: true }), { status: url.startsWith('/api/invites') ? 401 : 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const seen = vi.fn();
    const off = onUnauthorized(seen);
    await api.login('Luna', 'pw');
    expect(fetchMock).toHaveBeenCalledWith('/api/login', expect.objectContaining({ body: JSON.stringify({ name: 'Luna', password: 'pw' }) }));
    await expect(api.inviteInfo('tok')).rejects.toThrow();
    expect(seen).not.toHaveBeenCalled();
    off();
  });
  it('Modulauswahl und Personen', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    await api.joinModule('m1');
    await api.leaveModule('m1');
    await api.resetLink('u2');
    await api.deletePerson('u2');
    expect(fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${u}`)).toEqual([
      'POST /api/modules/m1/join', 'POST /api/modules/m1/leave', 'POST /api/users/u2/reset', 'DELETE /api/users/u2',
    ]);
  });
});
```
Den bestehenden Test „falsches Passwort beim Login …“ auf `api.login('Luna', 'x')` umstellen und die erwartete Body auf `JSON.stringify({ name: 'Luna', password: 'x' })`.

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `cd apps/client && nix develop -c npx vitest run test/api.test.ts test/router.test.ts`
Expected: FAIL – `api.joinModule is not a function`, Route `all` unbekannt.

- [ ] **Step 3: `api.ts` und `router.ts`**

`api.ts`:
- In `request` die Bedingung `url !== '/api/login'` ersetzen durch `url !== '/api/login' && !url.startsWith('/api/invites/')`.
- Typen ergänzen:
```ts
export interface Me { id: string; name: string; isAdmin: boolean }
export interface ModuleListItem { id: string; name: string; language: Language; memberCount: number; mine: boolean }
export interface DeviceInfo { id: string; name: string; createdAt: number; lastSeenAt: number | null }
export interface Person extends Me { createdAt: number; lastSeenAt: number | null; moduleCount: number; deviceCount: number }
```
- Im `api`-Objekt `pair` und `rotateToken` löschen, `login` ersetzen, `module` erweitern und ergänzen:
```ts
  login: (name: string, password: string) => request<Me>('/api/login', json('POST', { name, password })),
  me: () => request<Me>('/api/me'),
  changePassword: (old: string, next: string) => request<{ ok: true }>('/api/me/password', json('POST', { old, new: next })),
  devices: () => request<DeviceInfo[]>('/api/me/devices'),
  removeDevice: (id: string) => request<{ ok: true }>(`/api/me/devices/${id}`, { method: 'DELETE' }),
  allModules: () => request<ModuleListItem[]>('/api/modules/all'),
  joinModule: (id: string) => request<{ ok: true }>(`/api/modules/${id}/join`, { method: 'POST' }),
  leaveModule: (id: string) => request<{ ok: true }>(`/api/modules/${id}/leave`, { method: 'POST' }),
  invite: () => request<{ url: string }>('/api/invites', { method: 'POST' }),
  inviteInfo: (token: string) => request<{ kind: 'invite' | 'reset'; name: string | null }>(`/api/invites/${token}`),
  acceptInvite: (token: string, body: { name?: string; password: string }) =>
    request<Me>(`/api/invites/${token}/accept`, json('POST', body)),
  people: () => request<Person[]>('/api/users'),
  resetLink: (id: string) => request<{ url: string }>(`/api/users/${id}/reset`, { method: 'POST' }),
  deletePerson: (id: string) => request<{ ok: true }>(`/api/users/${id}`, { method: 'DELETE' }),
```
  und `module: (id: string) => request<{ module: Module; decks: DeckWithCount[]; mine: boolean; memberCount: number }>(\`/api/modules/${id}\`),`

`router.ts` komplett:
```ts
import { useEffect, useState } from 'react';

export type RouteName = 'home' | 'module' | 'deck' | 'browse' | 'study' | 'settings' | 'all' | 'invite' | 'account' | 'people';
export interface Route {
  name: RouteName;
  params: Record<string, string>;
}

const FIXED: Record<string, RouteName> = { settings: 'settings', alle: 'all', konto: 'account', personen: 'people' };
const PATH: Partial<Record<RouteName, string>> = { settings: 'settings', all: 'alle', account: 'konto', people: 'personen' };

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, query = ''] = raw.split('?');
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(query));
  const seg = pathPart!.split('/').filter(Boolean);
  if (seg.length === 0) return { name: 'home', params: {} };
  if ((seg[0] === 'module' || seg[0] === 'deck') && seg[1]) return { name: seg[0], params: { id: seg[1] } };
  if (seg[0] === 'einladung' && seg[1]) return { name: 'invite', params: { token: seg[1] } };
  if (FIXED[seg[0]!]) return { name: FIXED[seg[0]!]!, params: {} };
  if (seg[0] === 'browse' || seg[0] === 'study') return { name: seg[0], params };
  return { name: 'home', params: {} };
}

export function href(name: RouteName, params: Record<string, string | undefined> = {}): string {
  if (name === 'home') return '#/';
  if (name === 'module' || name === 'deck') return `#/${name}/${params.id}`;
  if (name === 'invite') return `#/einladung/${params.token}`;
  if (PATH[name]) return `#/${PATH[name]}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, v);
  const s = q.toString();
  return `#/${name}${s ? `?${s}` : ''}`;
}
```
(`navigate` und `useRoute` unverändert darunter.)

- [ ] **Step 4: `me.tsx`, Seiten, `main.tsx`**

`apps/client/src/me.tsx`:
```tsx
import { createContext, useContext } from 'react';
import { api, type Me } from './api.ts';
import { href } from './router.ts';

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

export function TopNav() {
  const me = useMe();
  return (
    <nav className="topnav">
      <a href={href('home')}>Übersicht</a>
      <a href={href('all')}>Alle Module</a>
      {me?.isAdmin && <a href={href('people')}>Personen</a>}
      <span className="spacer" />
      <a href={href('account')}>{me?.name ?? 'Konto'}</a>
      <button className="link" onClick={async () => { await api.logout(); location.hash = '#/'; location.reload(); }}>Abmelden</button>
    </nav>
  );
}
```

`apps/client/src/pages/LoginPage.tsx`: Formular um ein Namensfeld erweitern:
```tsx
  const [name, setName] = useState('');
```
Label vor dem Passwortfeld:
```tsx
        <label>
          Name
          <input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
```
`autoFocus` beim Passwortfeld entfernen; `await api.login(password)` → `await api.login(name, password)`; Button `disabled={busy || !name || !password}`.

`apps/client/src/pages/InvitePage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api } from '../api.ts';

export function InvitePage({ token }: { token: string }) {
  const [info, setInfo] = useState<{ kind: 'invite' | 'reset'; name: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.inviteInfo(token).then(setInfo, () => setError('Dieser Link ist ungültig, abgelaufen oder wurde schon benutzt.'));
  }, [token]);
  if (error && !info) return <main className="page login"><h1>NAKLearn</h1><p className="error">{error}</p></main>;
  if (!info) return <main className="page login">Lade …</main>;
  const invite = info.kind === 'invite';
  return (
    <main className="page login">
      <h1>NAKLearn</h1>
      <p>{invite ? 'Du wurdest eingeladen. Wähle deinen Namen und ein Passwort.' : `Neues Passwort für ${info.name}.`}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) return setError('Die Passwörter stimmen nicht überein.');
          setBusy(true);
          setError(null);
          try {
            await api.acceptInvite(token, invite ? { name, password: pw } : { password: pw });
            location.hash = invite ? '#/alle' : '#/';
            location.reload();
          } catch (err) {
            setError(String((err as Error).message));
            setBusy(false);
          }
        }}
      >
        {invite && <label>Name <input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>}
        <label>Passwort (mind. 8 Zeichen) <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Passwort wiederholen <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <button className="primary" disabled={busy || (invite && !name) || pw.length < 8}>{invite ? 'Konto anlegen' : 'Passwort speichern'}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
```

`apps/client/src/pages/AllModulesPage.tsx`:
```tsx
import type { Language } from '@naklearn/core';
import { useCallback, useEffect, useState } from 'react';
import { api, type ModuleListItem } from '../api.ts';
import { TopNav } from '../me.tsx';
import { href, navigate } from '../router.ts';

export function AllModulesPage() {
  const [mods, setMods] = useState<ModuleListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const load = useCallback(() => {
    api.allModules().then(setMods, (e) => setError(String(e.message)));
  }, []);
  useEffect(load, [load]);
  const toggle = async (m: ModuleListItem) => {
    try {
      await (m.mine ? api.leaveModule(m.id) : api.joinModule(m.id));
      load();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  return (
    <main className="page">
      <TopNav />
      <header className="topbar"><h1>Alle Module</h1></header>
      <p className="muted">Wähle die Module, die du lernst. Nur sie erscheinen in deiner Übersicht und auf deinem Handy.</p>
      {error && <p className="error">{error}</p>}
      <table className="table">
        <tbody>
          {mods?.map((m) => (
            <tr key={m.id}>
              <td><a href={href('module', { id: m.id })}>{m.name}</a> <span className="badge">{m.language.toUpperCase()}</span></td>
              <td className="muted small">{m.memberCount === 1 ? '1 lernt das' : `${m.memberCount} lernen das`}</td>
              <td><button className={m.mine ? '' : 'primary'} onClick={() => void toggle(m)}>{m.mine ? 'Entfernen' : 'Hinzufügen'}</button></td>
            </tr>
          ))}
          {mods?.length === 0 && <tr><td className="muted">Noch keine Module – leg das erste an.</td></tr>}
        </tbody>
      </table>
      <section className="card-form">
        <h2>Neues Modul</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const m = await api.createModule({ name, language });
              navigate('module', { id: m.id });
            } catch (err) {
              setError(String((err as Error).message));
            }
          }}
        >
          <input placeholder="Name, z. B. UI/UX Design" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="en">Karten auf Englisch</option>
            <option value="de">Karten auf Deutsch</option>
          </select>
          <button className="primary" type="submit">Anlegen</button>
        </form>
      </section>
    </main>
  );
}
```

`apps/client/src/pages/AccountPage.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { api, type DeviceInfo } from '../api.ts';
import { TopNav, useMe } from '../me.tsx';

const when = (t: number | null) => (t ? new Date(t).toLocaleString('de-DE') : 'noch nie');

export function AccountPage() {
  const me = useMe();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  const load = useCallback(() => {
    api.devices().then(setDevices, (e) => setMsg(String(e.message)));
  }, []);
  useEffect(load, [load]);
  return (
    <main className="page">
      <TopNav />
      <header className="topbar"><h1>Konto {me ? `· ${me.name}` : ''}</h1></header>
      {msg && <p className="info">{msg}</p>}
      <section className="card-form">
        <h2>Passwort ändern</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.changePassword(old, pw);
              setOld('');
              setPw('');
              setMsg('Passwort geändert. Andere Browser sind jetzt abgemeldet.');
            } catch (err) {
              setMsg(String((err as Error).message));
            }
          }}
        >
          <label>Altes Passwort <input type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} /></label>
          <label>Neues Passwort (mind. 8 Zeichen) <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <button className="primary" disabled={!old || pw.length < 8}>Speichern</button>
        </form>
      </section>
      <section>
        <h2>Meine Handys</h2>
        <table className="table">
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td className="muted small">zuletzt synchronisiert: {when(d.lastSeenAt)}</td>
                <td>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (!confirm(`„${d.name}“ entfernen? Die App dort muss sich neu anmelden.`)) return;
                      await api.removeDevice(d.id);
                      load();
                    }}
                  >
                    Entfernen
                  </button>
                </td>
              </tr>
            ))}
            {devices.length === 0 && <tr><td className="muted">Noch kein Handy angemeldet.</td></tr>}
          </tbody>
        </table>
        <p className="muted small">
          Android: App „NAKLearn“ aus den GitHub-Releases (z. B. über Obtainium) installieren und dort mit Name und Passwort anmelden –
          dann geht Lernen auch offline. iPhone: einfach diese Website im Browser nutzen.
        </p>
      </section>
    </main>
  );
}
```

`apps/client/src/pages/PeoplePage.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { api, type Person } from '../api.ts';
import { TopNav, useMe } from '../me.tsx';

export function PeoplePage() {
  const me = useMe();
  const [people, setPeople] = useState<Person[]>([]);
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    api.people().then(setPeople, (e) => setMsg(String(e.message)));
  }, []);
  useEffect(load, [load]);
  const show = (label: string, url: string) => {
    setLink({ label, url });
    void navigator.clipboard?.writeText(url).then(() => setMsg('Link kopiert.'), () => {});
  };
  return (
    <main className="page">
      <TopNav />
      <header className="topbar">
        <h1>Personen</h1>
        <button className="primary" onClick={async () => show('Einladungslink (7 Tage, einmal benutzbar)', (await api.invite()).url)}>Person einladen</button>
      </header>
      {msg && <p className="info">{msg}</p>}
      {link && <p className="card-form">{link.label}:<br /><code className="token">{link.url}</code></p>}
      <table className="table">
        <thead><tr><th>Name</th><th>Module</th><th>Handys</th><th>Zuletzt aktiv</th><th /></tr></thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <td>{p.name}{p.isAdmin ? ' (Admin)' : ''}</td>
              <td>{p.moduleCount}</td>
              <td>{p.deviceCount}</td>
              <td className="muted small">{p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString('de-DE') : 'noch nie'}</td>
              <td>
                <button onClick={async () => show(`Link zum Zurücksetzen für ${p.name}`, (await api.resetLink(p.id)).url)}>Link zum Zurücksetzen</button>{' '}
                {p.id !== me?.id && (
                  <button
                    className="danger"
                    onClick={async () => {
                      if (!confirm(`Konto „${p.name}“ löschen? Lernstand und Handys dieser Person gehen verloren.`)) return;
                      await api.deletePerson(p.id);
                      load();
                    }}
                  >
                    Konto löschen
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

`apps/client/src/main.tsx`:
- `PairPage`-Import und `case 'pair'` entfernen; Imports ergänzen:
```tsx
import { api, onUnauthorized, type Me } from './api.ts';
import { MeContext } from './me.tsx';
import { AccountPage } from './pages/AccountPage.tsx';
import { AllModulesPage } from './pages/AllModulesPage.tsx';
import { InvitePage } from './pages/InvitePage.tsx';
import { PeoplePage } from './pages/PeoplePage.tsx';
```
- In `App()`-Switch ergänzen:
```tsx
    case 'all': return <AllModulesPage />;
    case 'account': return <AccountPage />;
    case 'people': return <PeoplePage />;
```
- `Studio` ersetzen:
```tsx
/** Studio im Browser: Einladungslinks ohne Login, sonst bei 401 die Login-Seite. */
function Studio() {
  const route = useRoute();
  const [needLogin, setNeedLogin] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const invite = route.name === 'invite';
  useEffect(() => onUnauthorized(() => setNeedLogin(true)), []);
  useEffect(() => {
    if (!invite) api.me().then(setMe, () => {});
  }, [invite]);
  if (invite) return <InvitePage token={route.params.token!} />;
  if (needLogin) return <LoginPage />;
  return <MeContext.Provider value={me}><App /></MeContext.Provider>;
}
```

`apps/client/src/pages/Home.tsx`:
- Import `TopNav` aus `../me.tsx`; als erstes Kind von `<main className="page">` `<TopNav />` einfügen.
- Im `hero`-Abschnitt die Zeilen „Handy koppeln“ und „Abmelden“ löschen.
- Nach dem Laden: Wer noch keine Module hat, landet bei „Alle Module“:
```tsx
  const load = useCallback(() => {
    api.overview().then((o) => {
      if (o.modules.length === 0) navigate('all');
      else setOv(o);
    }, (e) => setError(String(e.message)));
  }, []);
```
- Den Abschnitt „Neues Modul“ (Formular) aus `Home.tsx` entfernen (steht jetzt auf „Alle Module“) samt der dann unbenutzten States `name`, `language`.

`apps/client/src/pages/ModulePage.tsx`:
- State `const [mine, setMine] = useState(true); const [members, setMembers] = useState(1);` und in `load`: `setMine(r.mine); setMembers(r.memberCount);`
- `<TopNav />` als erstes Kind von `<main className="page">` (Import aus `../me.tsx`); Link „← Übersicht“ bleibt.
- Über dem Einstellungs-Formular, wenn `!mine`:
```tsx
      {!mine && (
        <p className="warn">
          Dieses Modul ist nicht in deinen Modulen.{' '}
          <button className="primary" onClick={async () => { await api.joinModule(id); await load(); }}>Hinzufügen</button>
        </p>
      )}
```
- Im Formular die Felder Prüfungsdatum und „Neue Karten pro Tag“ nur rendern, wenn `mine`; beim Speichern: `api.updateModule(id, mine ? { name, language, examDate, newPerDay } : { name, language })`.
- Den Hinweistext ergänzen: „Prüfungsdatum und neue Karten pro Tag gelten nur für dich; Name und Sprache für alle.“
- Den Lösch-Button ersetzen:
```tsx
        {mine && (
          <button
            onClick={async () => {
              await api.leaveModule(id);
              navigate('home');
            }}
          >
            Aus meinen Modulen entfernen
          </button>
        )}{' '}
        {mine && members <= 1 && (
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Modul „${mod.name}“ für alle löschen?`)) return;
              await api.deleteModule(id);
              navigate('home');
            }}
          >
            Für alle löschen
          </button>
        )}
        {members > 1 && <p className="muted small">{members} Personen lernen dieses Modul – löschen geht erst, wenn nur noch du es hast.</p>}
```

`apps/client/src/styles.css` anfügen:
```css
.topnav { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; padding: 8px 0 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.topnav .spacer { flex: 1; }
```

`git rm apps/client/src/pages/PairPage.tsx`

- [ ] **Step 5: Tests, Typprüfung, Build**

Run: `nix develop -c npm test && nix develop -c npm run typecheck && nix develop -c npm run build`
Expected: alles grün.

- [ ] **Step 6: Im Browser prüfen (zwei Konten)**

Run: `NAKLEARN_PORT=8743 NAKLEARN_PASSWORD=dev-pass-1 nix develop -c npm run dev:server` (Hintergrund) und `nix develop -c npm run dev:client` (Proxy in `vite.config.ts` zeigt auf 8742 – für diesen Test `NAKLEARN_PORT` weglassen, wenn kein anderer Dienst auf 8742 läuft). In `http://localhost:5173`:
1. Login `luna` / `dev-pass-1` → Übersicht bzw. „Alle Module“.
2. „Personen“ → „Person einladen“ → Link in einem privaten Fenster öffnen → Name `Mia`, Passwort → landet bei „Alle Module“.
3. Mia fügt ein Modul hinzu, lernt eine Karte; Luna sieht ihre eigenen Zahlen unverändert.
4. Konto-Seite: Passwort ändern; Handy-Liste leer.
Expected: alles wie beschrieben. Abweichungen mit Test im betroffenen Paket beheben.

- [ ] **Step 7: Commit**

```bash
git add -A apps/client/src apps/client/test
git commit -m "feat(client): login with name, invites, account, people and module selection in the studio"
```

---

### Task 8: Android-App – Anmelden statt Koppeln

**Files:**
- Modify: `packages/store/src/store.ts`
- Modify: `apps/client/src/native/transport.ts`, `controller.ts`, `images.ts`, `NativeSettings.tsx`, `NativeHome.tsx`
- Modify: `apps/client/package.json`, `apps/server/package.json`, `package-lock.json`, `flake.nix`
- Test: `packages/store/test/store.test.ts`, `apps/client/test/controller.test.ts`, `apps/client/test/transport.test.ts`

**Interfaces:**
- Consumes: `POST /api/device/login`, 401 von `/api/sync` (Task 4)
- Produces:
  - `LocalStore.wipe(): Promise<void>` (alle Inhalte und Lernstände, `meta` außer `device_id` und `seq`), `LocalStore.unsyncedCount(): Promise<number>`
  - `transport.ts`: `class TokenRejected extends Error`, `httpTransport` wirft sie bei 401; `deviceLogin(url, name, password, deviceName, fetchImpl?): Promise<{ token: string; user: { id: string; name: string } }>`; `DEFAULT_SERVER = 'https://naklearn.torte-tech.de'`; `parsePairing` entfällt
  - `ImageStore.clear(): Promise<void>`
  - `SyncController`: `account(): Promise<{ url: string; token: string; name: string | null } | null>`, `login(url: string, name: string, password: string): Promise<void>` (wirft bei Fehler), `logout(force?: boolean): Promise<{ unsynced: number }>`; Konstruktor `(store, images, makeTransport = httpTransport, login = deviceLogin)`; Status `unpaired` mit Meldung „Abgemeldet – bitte in den Einstellungen neu anmelden“ nach 401. `pair`/`pairing` entfallen.

- [ ] **Step 1: Failing tests schreiben**

Store-Test in `packages/store/test/store.test.ts` anfügen (Helfer `nodeAdapter` aus `./nodeAdapter.ts` wie in der Datei bereits importiert):
```ts
describe('wipe', () => {
  it('löscht Inhalte und Lernstand, behält Geräte-ID', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const id = store.deviceId;
    await store.db.run("INSERT INTO module (id, name, language, updated_at) VALUES ('m', 'M', 'en', 1)");
    await store.db.run("INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, dirty) VALUES ('r', 'c', 3, 1, 1, 'd', 1)");
    await store.setMeta('token', 't');
    expect(await store.unsyncedCount()).toBe(1);
    await store.wipe();
    expect(await store.db.all('SELECT * FROM module')).toEqual([]);
    expect(await store.unsyncedCount()).toBe(0);
    expect(await store.getMeta('token')).toBeNull();
    expect(await store.getMeta('device_id')).toBe(id);
  });
});
```

`apps/client/test/transport.test.ts`: den `describe('parsePairing', …)`-Block löschen, Import anpassen und anfügen:
```ts
import { DEFAULT_SERVER, TokenRejected, deviceLogin, httpTransport } from '../src/native/transport.ts';

describe('deviceLogin', () => {
  it('schickt Name, Passwort und Gerätename und liefert das Token', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ token: 'tok', user: { id: 'u', name: 'Mia' } })));
    const r = await deviceLogin('https://h/', 'Mia', 'pw', 'Android-Handy', f as unknown as typeof fetch);
    expect(r).toEqual({ token: 'tok', user: { id: 'u', name: 'Mia' } });
    expect(f).toHaveBeenCalledWith('https://h/api/device/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Mia', password: 'pw', deviceName: 'Android-Handy' }) }));
  });
  it('meldet die Server-Fehlermeldung', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'Name oder Passwort falsch' }), { status: 401 }));
    await expect(deviceLogin(DEFAULT_SERVER, 'Mia', 'x', 'A', f as unknown as typeof fetch)).rejects.toThrow('Name oder Passwort falsch');
  });
});

describe('httpTransport 401', () => {
  it('wirft TokenRejected', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(httpTransport('https://h', 't', f as unknown as typeof fetch)({ deviceId: 'd', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } }))
      .rejects.toBeInstanceOf(TokenRejected);
  });
});
```
(`vi` ist in der Datei schon importiert; die Import-Zeile `import { httpTransport, parsePairing } …` durch die obige ersetzen.)

`apps/client/test/controller.test.ts`:
- `fakeImages()` um `async clear() { stored.clear(); }` erweitern.
- Helfer:
```ts
const okLogin = (name = 'Mia') => async () => ({ token: `tok-${name}`, user: { id: name, name } });
```
- Alle `await c.pair('http://h:1', 't')` → `await c.login('http://h:1', 'Mia', 'pw')` mit Konstruktor `new SyncController(store, images, () => transport, okLogin())`.
- Test „ist ohne Kopplung im Zustand unpaired“ bleibt (Text egal).
- „merkt sich die Kopplung“ ersetzen durch:
```ts
  it('merkt sich die Anmeldung, nie das Passwort', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const c = new SyncController(store, fakeImages(), () => async () => pullWithSlides(0), okLogin());
    await c.login('http://h:1/', 'Mia', 'geheim123');
    expect(await c.account()).toEqual({ url: 'http://h:1', token: 'tok-Mia', name: 'Mia' });
    expect(JSON.stringify(await store.db.all('SELECT * FROM meta'))).not.toContain('geheim123');
  });

  it('anderer Name löscht vorher die lokalen Daten', async () => {
    const store = await LocalStore.open(nodeAdapter());
    let who = 'Mia';
    const c = new SyncController(store, fakeImages(), () => async () => pullWithSlides(0), async () => ({ token: `tok-${who}`, user: { id: who, name: who } }));
    await c.login('http://h:1', 'Mia', 'pw');
    await store.db.run("INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, dirty) VALUES ('r', 'c', 3, 1, 1, 'd', 0)");
    who = 'Ben';
    await c.login('http://h:1', 'Ben', 'pw');
    expect(await store.db.all('SELECT * FROM revlog')).toEqual([]);
  });

  it('401 beim Sync → abgemeldet statt Fehlerschleife', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const c = new SyncController(store, fakeImages(), () => async () => { throw new TokenRejected(); }, okLogin());
    await c.login('http://h:1', 'Mia', 'pw').catch(() => {});
    expect(c.state).toMatchObject({ phase: 'unpaired', message: 'Abgemeldet – bitte in den Einstellungen neu anmelden' });
    expect((await c.account())).toBeNull();
  });

  it('Abmelden: erst Sync, bei ungesyncten Bewertungen Rückfrage, dann alles löschen', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const images = fakeImages();
    let fail = false;
    const c = new SyncController(store, images, () => async (r) => { if (fail) throw new Error('offline'); void r; return pullWithSlides(1); }, okLogin());
    await c.login('http://h:1', 'Mia', 'pw');
    expect(images.stored.size).toBe(1);
    await store.db.run("INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, dirty) VALUES ('r', 'c', 3, 1, 1, 'd', 1)");
    fail = true;
    expect(await c.logout()).toEqual({ unsynced: 1 });
    expect(await c.account()).not.toBeNull();
    expect(await c.logout(true)).toEqual({ unsynced: 0 });
    expect(await c.account()).toBeNull();
    expect(images.stored.size).toBe(0);
    expect(await store.db.all('SELECT * FROM revlog')).toEqual([]);
    expect(c.state.phase).toBe('unpaired');
  });
```
(Import `TokenRejected` aus `../src/native/transport.ts`.)

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `nix develop -c npm test 2>&1 | tail -30`
Expected: FAIL – `store.wipe is not a function`, `deviceLogin` fehlt, `c.login is not a function`.

- [ ] **Step 3: Implementierung Store**

In `LocalStore` ergänzen:
```ts
  /** Alles Lokale löschen (Abmelden/Kontowechsel); die Geräte-ID bleibt. */
  async wipe(): Promise<void> {
    await this.db.transaction(async () => {
      for (const t of ['revlog', 'card_state', 'card', 'note', 'slide', 'deck', 'module']) await this.db.run(`DELETE FROM ${t}`);
      await this.db.run("DELETE FROM meta WHERE key NOT IN ('device_id', 'seq')");
    });
  }

  /** Lokale Änderungen, die der Server noch nicht hat. */
  async unsyncedCount(): Promise<number> {
    let n = 0;
    for (const t of ['revlog', 'note', 'card', 'module']) {
      n += (await this.db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE dirty = 1`))[0]!.n;
    }
    return n;
  }
```

- [ ] **Step 4: Implementierung App**

`apps/client/src/native/transport.ts` komplett:
```ts
import type { Transport } from '@naklearn/store';

export const DEFAULT_SERVER = 'https://naklearn.torte-tech.de';

/** Der Server kennt das Gerätetoken nicht (mehr) – neu anmelden. */
export class TokenRejected extends Error {
  constructor() {
    super('Abgemeldet – bitte in den Einstellungen neu anmelden');
  }
}

export async function deviceLogin(
  url: string, name: string, password: string, deviceName: string, fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; user: { id: string; name: string } }> {
  const res = await fetchImpl(`${url.replace(/\/+$/, '')}/api/device/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password, deviceName }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Anmeldung fehlgeschlagen (HTTP ${res.status})`);
  return body;
}

export function httpTransport(url: string, token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 60_000): Transport {
  return async (req) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Zeitüberschreitung – Server nicht erreichbar')), timeoutMs);
    });
    try {
      const res = await Promise.race([
        fetchImpl(`${url}/api/sync`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(req),
        }),
        timeout,
      ]);
      if (res.status === 401) throw new TokenRejected();
      if (!res.ok) throw new Error(`Sync fehlgeschlagen (HTTP ${res.status})`);
      return await Promise.race([res.json(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
```

`apps/client/src/native/images.ts`: im zurückgegebenen Objekt ergänzen:
```ts
    async clear() {
      await Filesystem.rmdir({ path: 'slides', directory: Directory.Data, recursive: true }).catch(() => {});
    },
```

`apps/client/src/native/controller.ts`:
- `ImageStore` um `clear(): Promise<void>;` erweitern.
- Imports: `import { TokenRejected, deviceLogin, httpTransport } from './transport.ts';`
- Konstruktor:
```ts
  private loginImpl: typeof deviceLogin;

  constructor(
    store: LocalStore, images: ImageStore,
    makeTransport: (url: string, token: string) => Transport = httpTransport, loginImpl: typeof deviceLogin = deviceLogin,
  ) {
    this.store = store;
    this.images = images;
    this.makeTransport = makeTransport;
    this.loginImpl = loginImpl;
  }
```
- `pairing()` und `pair()` ersetzen durch:
```ts
  async account(): Promise<{ url: string; token: string; name: string | null } | null> {
    const url = await this.store.getMeta('server_url');
    const token = await this.store.getMeta('token');
    return url && token ? { url, token, name: await this.store.getMeta('user_name') } : null;
  }

  /** Meldet das Handy an; bei anderer Person werden vorher die lokalen Daten gelöscht. Wirft bei Fehler. */
  async login(url: string, name: string, password: string): Promise<void> {
    const base = url.replace(/\/+$/, '');
    const r = await this.loginImpl(base, name, password, 'Android-Handy');
    const before = await this.store.getMeta('user_id');
    if (before && before !== r.user.id) {
      await this.store.wipe();
      await this.images.clear();
    }
    await this.store.setMeta('server_url', base);
    await this.store.setMeta('token', r.token);
    await this.store.setMeta('user_id', r.user.id);
    await this.store.setMeta('user_name', r.user.name);
    await this.sync();
  }

  /** Erst synchronisieren; gibt es danach noch Ungesynctes und `force` fehlt, nichts löschen. */
  async logout(force = false): Promise<{ unsynced: number }> {
    if (await this.account()) await this.sync();
    const unsynced = await this.store.unsyncedCount();
    if (unsynced > 0 && !force) return { unsynced };
    await this.store.wipe();
    await this.images.clear();
    this.set({ phase: 'unpaired', message: null, lastSync: null, imagesMissing: 0 });
    return { unsynced: 0 };
  }
```
- In `doSync`: `const p = await this.pairing();` → `const p = await this.account();`; Meldung bei fehlender Anmeldung `'Nicht angemeldet'`; im `catch`:
```ts
    } catch (e) {
      if (e instanceof TokenRejected) {
        await this.store.setMeta('token', '');
        return this.set({ phase: 'unpaired', message: e.message });
      }
      this.set({ phase: 'error', message: String((e as Error).message ?? e) });
    }
```
  und in `account()` ein leeres Token wie fehlend behandeln (`url && token` erfüllt das bereits, weil `''` falsy ist).

`apps/client/src/native/NativeHome.tsx`: in `syncLabel` `'Nicht gekoppelt – Einstellungen öffnen'` → `s.message ?? 'Nicht angemeldet – Einstellungen öffnen'`.

`apps/client/src/native/NativeSettings.tsx` komplett:
```tsx
import type { LocalStore } from '@naklearn/store';
import { useEffect, useState } from 'react';
import { href } from '../router.ts';
import { syncLabel } from './NativeHome.tsx';
import type { SyncController, SyncState } from './controller.ts';
import { DEFAULT_SERVER } from './transport.ts';

export function NativeSettings({ store, sync, state }: { store: LocalStore; sync: SyncController; state: SyncState }) {
  const [account, setAccount] = useState<{ name: string | null } | null>(null);
  const [url, setUrl] = useState(DEFAULT_SERVER);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => void sync.account().then((a) => {
    setAccount(a);
    if (a) setUrl(a.url);
  });
  useEffect(refresh, [sync, state.phase]);

  return (
    <main className="page native">
      <header className="topbar">
        <a href={href('home')}>←</a>
        <h1>Einstellungen</h1>
      </header>
      <p className={`sync-status ${state.phase}`}>{syncLabel(state)}</p>
      {account ? (
        <section className="card-form">
          <h2>Angemeldet als {account.name ?? '–'}</h2>
          <button className="full" onClick={() => void sync.sync()} disabled={state.phase === 'syncing'}>Jetzt synchronisieren</button>
          <button
            className="full danger"
            onClick={async () => {
              setBusy(true);
              let r = await sync.logout();
              if (r.unsynced > 0 && confirm(`${r.unsynced} Änderungen sind noch nicht synchronisiert und gehen verloren. Trotzdem abmelden?`)) {
                r = await sync.logout(true);
              }
              setBusy(false);
              setMsg(r.unsynced > 0 ? 'Nicht abgemeldet.' : 'Abgemeldet, lokale Daten gelöscht.');
              refresh();
            }}
            disabled={busy}
          >
            Abmelden
          </button>
        </section>
      ) : (
        <section className="card-form">
          <h2>Anmelden</h2>
          <p className="muted small">Mit deinem NAKLearn-Namen und Passwort (Einladung von Luna).</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMsg(null);
              try {
                await sync.login(url, name, password);
                setPassword('');
                refresh();
              } catch (err) {
                setMsg(String((err as Error).message ?? err));
              }
              setBusy(false);
            }}
          >
            <label>Name <input autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Passwort <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {advanced
              ? <label>Server-Adresse <input value={url} onChange={(e) => setUrl(e.target.value)} /></label>
              : <button type="button" className="link" onClick={() => setAdvanced(true)}>Erweitert</button>}
            <button className="primary full" disabled={busy || !name || !password || !/^https?:\/\//.test(url)}>Anmelden</button>
          </form>
        </section>
      )}
      {msg && <p className="info small">{msg}</p>}
      <p className="muted small">Geräte-ID: {store.deviceId}</p>
    </main>
  );
}
```

Abhängigkeiten entfernen (QR-Scanner im Client, QR-Code im Server):
```bash
nix develop -c npm uninstall -w @naklearn/client @capacitor-mlkit/barcode-scanning
nix develop -c npm uninstall -w @naklearn/server qrcode @types/qrcode
nix develop -c prefetch-npm-deps package-lock.json   # neuen Hash in flake.nix bei npmDepsHash eintragen
grep -rn "barcode\|mlkit\|qrcode" apps/client/src apps/server/src apps/client/android/app/src/main/AndroidManifest.xml
```
Expected (grep): keine Treffer (das Manifest enthält keine eigene Kamera-Berechtigung; das Plugin brachte seine mit).

- [ ] **Step 5: Tests, Typprüfung, Android-Build, Nix-Build**

Run:
```bash
nix develop -c npm test && nix develop -c npm run typecheck
nix develop -c npm run android:build
nix build .#default --no-link
```
Expected: alles grün; Debug-APK gebaut; Nix-Build mit neuem `npmDepsHash` erfolgreich.

- [ ] **Step 6: Commit**

```bash
git add -A packages/store apps/client apps/server/package.json package-lock.json flake.nix
git commit -m "feat(android): sign in with name and password, sign out wipes local data, 401 ends the session"
```

---

### Task 9: Einführung nach der Prüfung (mit Luna, ab 2026-10-21)

Dieser Task ändert die Live-Instanz – **jeden Schritt vorher mit Luna bestätigen.**

- [ ] **Step 1: Abschlussprüfung des Branches**

Run: `nix develop -c npm test && nix develop -c npm run typecheck && docker build -t naklearn:mu . && scripts/smoke-image.sh naklearn:mu`
Expected: alles grün, Rauchtest bestanden (das Image startet mit `NAKLEARN_PASSWORD=smoke` und legt dabei das Admin-Konto an).

`scripts/smoke-image.sh` anpassen: Login-Prüfungen auf das neue Format umstellen:
```bash
check "login falsch" "$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"name":"luna","password":"x"}' "$BASE/api/login")" 401
check "login richtig" "$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"name":"luna","password":"smoke-pass"}' "$BASE/api/login")" 200
```
und den Container mit `-e NAKLEARN_PASSWORD=smoke-pass` starten (mindestens 8 Zeichen). Commit: `git commit -am "build: smoke test logs in with name and password"`.

- [ ] **Step 2: Merge und Deploy**

```bash
git switch main && git merge --ff-only multiuser && git push origin main
nix develop -c gh run watch -R Luna1506/naklearn --exit-status
```
Expected: CI grün. Auf torte: `ssh torte 'docker logs naklearn | grep -E "Konto|Sicherung"'` zeigt „Konto „luna“ angelegt (Sicherung: /data/backups/pre-multiuser-….db)“.

- [ ] **Step 3: Abnahme mit Luna**

1. `https://naklearn.torte-tech.de` → Login `luna` + bisheriges Passwort → Übersicht mit denselben Zahlen wie vorher.
2. Lunas Handy (v0.2.0) synchronisiert ohne Neu-Koppeln (Status „Zuletzt synchronisiert: gerade eben“).
3. `nix develop -c npm run release minor` → v0.3.0; Obtainium-Update; in der App erscheint „Angemeldet als –“ bzw. nach Neu-Anmelden „Angemeldet als luna“.
4. „Personen“ → „Person einladen“ → Testkonto im privaten Browserfenster anlegen → Modul wählen → eine Karte lernen → Lunas Zahlen unverändert.
5. Testkonto in der App anmelden (auf einem zweiten Gerät oder nach Abmelden), Gerät in „Konto“ entfernen → App zeigt „Abgemeldet“.
6. Testkonto in „Personen“ löschen.

- [ ] **Step 4: `NAKLEARN_PASSWORD` aus der `.env` auf torte entfernen** (wird nicht mehr gebraucht), Memory-Notiz `naklearn-project.md` um Mehrbenutzer-Betrieb ergänzen.
