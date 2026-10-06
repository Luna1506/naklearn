# NAKLearn Teil 2 (Android + Sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android-App (offline-first), die per Tailscale mit dem Laptop-Server synchronisiert: Karten, Folienbilder und Modul-Einstellungen kommen aufs Handy, Bewertungen und Bearbeitungen gehen zurück; Koppeln per QR-Code.

**Architecture:** Neues Paket `packages/store` (LocalStore) implementiert Lernen und Sync-Client über ein asynchrones `SqlAdapter`-Interface – in Tests über `node:sqlite`, in der App über `@capacitor-community/sqlite`. Der Server bekommt `POST /api/sync` (Push idempotent/LWW, Pull nach `seq`-Cursor mit Seiten) und `GET /api/pair` (QR-Payload mit Tailscale-Adresse + Token). Der bestehende Vite-Client erkennt zur Laufzeit, ob er in Capacitor läuft, und rendert dann die Handy-Oberfläche (gleiche `StudyView`).

**Tech Stack:** wie Teil 1, zusätzlich Capacitor 8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`, `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/file-transfer`, `@capacitor-community/sqlite`, `@capacitor-mlkit/barcode-scanning`), `qrcode`, JDK 21, Android SDK (`~/Android/Sdk`, Plattform 36, Build-Tools 36.1.0), Tailscale.

**Spec:** `docs/superpowers/specs/2026-10-06-kartei-design.md` (Abschnitte 6 „Android-App“, 7 „Sync“, 8 „Android“, 10 „Teil 2“)

## Global Constraints

- Alle Befehle in `~/projects/naklearn` innerhalb von `nix develop -c …`; Branch `feat/teil2-android` (abgezweigt von `main`).
- Neue Workspace-Pakete erst mit `npm install` (ohne Argumente) registrieren, **dann** Abhängigkeiten mit `npm install -w <pkg> …` hinzufügen und in `package.json` prüfen (Lehre aus Teil 1).
- TypeScript-Regeln wie Teil 1 (Type Stripping: `.ts`-Endungen, keine Enums/Parameter-Properties).
- App-ID `de.luna.naklearn`, App-Name `NAKLearn`; Server-Port 8742; Pull-Seitengröße 2000.
- Sync: Revlog per ID idempotent; Module/Notes/Karten Last-Writer-Wins nach `updatedAt`; Server vergibt `seq`; Handy markiert lokale Änderungen mit `dirty = 1`.
- Cleartext-HTTP nur für `ts.net` (MagicDNS) und `10.0.2.2` (Emulator); Verschlüsselung übernimmt Tailscale.
- Upload vom Handy ist **nicht** Teil dieses Plans.
- UI-Texte Deutsch.

## Review Focus

1. **Sync bricht mitten in einer Seite ab (Netz weg):** Cursor wird nur nach erfolgreicher Anwendung einer Seite gespeichert, die nächste Sync holt den Rest; Dirty-Flags werden nur für unverändert gebliebene Zeilen gelöscht → Test in Task 4.
2. **Gleiche Karte auf Handy und Laptop offline gelernt:** nach Sync identischer Zustand auf beiden Seiten (Replay aller Bewertungen) → Test in Task 4.
3. **Notiz auf dem Handy bearbeitet, während der Laptop sie neu erzeugt/löscht:** Löschung bzw. neuere Änderung gewinnt nach `updatedAt`, keine verwaisten Karten → Test in Task 2.
4. **Handy noch nie gekoppelt / Token falsch / Server nicht erreichbar:** App bleibt voll benutzbar, zeigt verständlichen Status statt Absturz → Test in Task 5.
5. **Folienbilder fehlen (Download unterbrochen):** nächste Sync lädt nur fehlende nach; fehlendes Bild bricht die Lernansicht nicht → Test in Task 5.

---

## File Structure

```
packages/core/src/rows.ts          Zeilen-Mapper (snake_case → Domäne), gemeinsam für Server und Handy
packages/core/src/sync.ts          Sync-Protokoll: zod-Schemas, Typen, SYNC_PAGE_SIZE
apps/server/src/sync.ts            applyPush, pullSince
apps/server/src/pair.ts            detectPublicUrl, Pairing-Payload + QR
apps/server/src/app.ts             + POST /api/sync, GET /api/pair
apps/server/test/sync*.test.ts     Server-Sync, End-to-End mit LocalStore
packages/store/                    LocalStore (Lernen + Sync-Client) über SqlAdapter
  src/adapter.ts, migrate.ts, store.ts, sync.ts, index.ts
  test/nodeAdapter.ts, seed.ts, store.test.ts
apps/client/src/pages/PairPage.tsx Studio: QR-Code zum Koppeln
apps/client/src/native/            Handy-Oberfläche
  capSqlAdapter.ts, transport.ts, images.ts, controller.ts, NativeApp.tsx,
  NativeHome.tsx, NativeModule.tsx, NativeSettings.tsx, native.css
apps/client/capacitor.config.ts
apps/client/android/               von `cap add android` erzeugt (+ network_security_config.xml)
flake.nix                          devShell: + jdk21, ANDROID_HOME
~/nixos/dotfiles/modules/networking.nix  Tailscale + Firewall
```

---

### Task 1: Zeilen-Mapper nach core verschieben, Sync-Protokoll

**Files:**
- Create: `packages/core/src/rows.ts`, `packages/core/src/sync.ts`
- Modify: `packages/core/src/index.ts`, `apps/server/src/repo.ts` (lokale Mapper durch Import ersetzen)
- Test: `packages/core/test/sync.test.ts`, `packages/core/test/rows.test.ts`

**Interfaces:**
- Produces: `toModule(r)`, `toDeck(r)`, `toNote(r)`, `toCard(r)`, `toRevlog(r)`, `toSlideRow(r)` (alle `(r: Record<string, any>) => …`); `SlideRow = { deckId: string; page: number; image: string }`; `SyncRequestSchema`, `SyncRequest`, `SyncPush`, `SyncPull`, `SyncResponse`, `SYNC_PAGE_SIZE = 2000`, `emptyPush(): SyncPush`.

- [ ] **Step 1: Failing Tests**

`packages/core/test/rows.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { toCard, toModule, toNote, toRevlog, toSlideRow } from '../src/rows.ts';

describe('Zeilen-Mapper', () => {
  it('wandelt snake_case-Zeilen in Domänenobjekte', () => {
    expect(toModule({ id: 'm', name: 'M', language: 'en', exam_date: null, new_per_day: 20, deleted: 0, updated_at: 5 }))
      .toEqual({ id: 'm', name: 'M', language: 'en', examDate: null, newPerDay: 20, deleted: false, updatedAt: 5 });
    expect(toNote({ id: 'n', deck_id: 'd', kind: 'qa', front: 'F', back: 'B', slide_refs: '[1,2]', front_image_page: null, tags: '["t"]', source: 'chunk', position: 3, deleted: 1, updated_at: 9 }))
      .toMatchObject({ slideRefs: [1, 2], tags: ['t'], deleted: true, frontImagePage: null });
    expect(toCard({ id: 'c', note_id: 'n', ordinal: 2, suspended: 1, deleted: 0, updated_at: 1 })).toEqual({ id: 'c', noteId: 'n', ordinal: 2, suspended: true, deleted: false, updatedAt: 1 });
    expect(toRevlog({ id: 'r', card_id: 'c', rating: 3, reviewed_at: 7, duration_ms: 100, device_id: 'x', revokes: null }).revokes).toBeNull();
    expect(toSlideRow({ deck_id: 'd', page: 4, image: '4.jpg', text: 'lang' })).toEqual({ deckId: 'd', page: 4, image: '4.jpg' });
  });
});
```

`packages/core/test/sync.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SyncRequestSchema, emptyPush } from '../src/sync.ts';

const req = {
  deviceId: 'phone',
  cursor: 0,
  push: {
    ...emptyPush(),
    revlog: [{ id: 'r1', cardId: 'c1', rating: 3, reviewedAt: 1, durationMs: 5, deviceId: 'phone', revokes: null }],
    modules: [{ id: 'm', name: 'M', language: 'en', examDate: '2026-10-30', newPerDay: 20, deleted: false, updatedAt: 2 }],
  },
};

describe('SyncRequestSchema', () => {
  it('akzeptiert eine gültige Anfrage', () => {
    expect(SyncRequestSchema.parse(req)).toEqual(req);
  });
  it('lehnt ungültige Bewertungen ab', () => {
    const bad = structuredClone(req);
    (bad.push.revlog[0] as { rating: number }).rating = 7;
    expect(SyncRequestSchema.safeParse(bad).success).toBe(false);
  });
  it('verlangt eine Geräte-ID und einen nicht-negativen Cursor', () => {
    expect(SyncRequestSchema.safeParse({ ...req, deviceId: '' }).success).toBe(false);
    expect(SyncRequestSchema.safeParse({ ...req, cursor: -1 }).success).toBe(false);
  });
});
```

Run: `nix develop -c npm test -w @naklearn/core`
Expected: FAIL – `rows.ts`/`sync.ts` fehlen.

- [ ] **Step 2: Implementierung**

`packages/core/src/rows.ts`:
```ts
import type { Card, Deck, Module, Note, RevlogEntry } from './types.ts';

// SQLite-Zeilen sind untypisiert; die Mapper sind die einzige Stelle, die snake_case kennt.
type Row = Record<string, any>;

export interface SlideRow {
  deckId: string;
  page: number;
  image: string;
}

export const toModule = (r: Row): Module => ({
  id: r.id, name: r.name, language: r.language, examDate: r.exam_date ?? null,
  newPerDay: r.new_per_day, deleted: !!r.deleted, updatedAt: r.updated_at,
});

export const toDeck = (r: Row): Deck => ({
  id: r.id, moduleId: r.module_id, title: r.title, pdfSha256: r.pdf_sha256, pageCount: r.page_count,
  status: r.status, error: r.error ?? null, summary: r.summary ?? null, position: r.position,
  deleted: !!r.deleted, updatedAt: r.updated_at,
});

export const toNote = (r: Row): Note => ({
  id: r.id, deckId: r.deck_id, kind: r.kind, front: r.front, back: r.back,
  slideRefs: JSON.parse(r.slide_refs), frontImagePage: r.front_image_page ?? null, tags: JSON.parse(r.tags),
  source: r.source, position: r.position, deleted: !!r.deleted, updatedAt: r.updated_at,
});

export const toCard = (r: Row): Card => ({
  id: r.id, noteId: r.note_id, ordinal: r.ordinal, suspended: !!r.suspended, deleted: !!r.deleted, updatedAt: r.updated_at,
});

export const toRevlog = (r: Row): RevlogEntry => ({
  id: r.id, cardId: r.card_id, rating: r.rating, reviewedAt: r.reviewed_at, durationMs: r.duration_ms,
  deviceId: r.device_id, revokes: r.revokes ?? null,
});

export const toSlideRow = (r: Row): SlideRow => ({ deckId: r.deck_id, page: r.page, image: r.image });
```

`packages/core/src/sync.ts`:
```ts
import { z } from 'zod';
import type { SlideRow } from './rows.ts';
import type { Card, Deck, Module, Note, RevlogEntry } from './types.ts';

export const SYNC_PAGE_SIZE = 2000;

const ModuleRowSchema = z.object({
  id: z.string(), name: z.string(), language: z.enum(['en', 'de']), examDate: z.string().nullable(),
  newPerDay: z.number().int(), deleted: z.boolean(), updatedAt: z.number(),
});
const NoteRowSchema = z.object({
  id: z.string(), deckId: z.string(), kind: z.enum(['qa', 'cloze', 'diagram']), front: z.string(), back: z.string(),
  slideRefs: z.array(z.number().int()), frontImagePage: z.number().int().nullable(), tags: z.array(z.string()),
  source: z.enum(['chunk', 'synthesis', 'manual']), position: z.number(), deleted: z.boolean(), updatedAt: z.number(),
});
const CardRowSchema = z.object({
  id: z.string(), noteId: z.string(), ordinal: z.number().int(), suspended: z.boolean(), deleted: z.boolean(), updatedAt: z.number(),
});
const RevlogRowSchema = z.object({
  id: z.string(), cardId: z.string(), rating: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reviewedAt: z.number(), durationMs: z.number().min(0), deviceId: z.string(), revokes: z.string().nullable(),
});

export const SyncRequestSchema = z.object({
  deviceId: z.string().min(1),
  cursor: z.number().int().min(0),
  push: z.object({
    modules: z.array(ModuleRowSchema),
    notes: z.array(NoteRowSchema),
    cards: z.array(CardRowSchema),
    revlog: z.array(RevlogRowSchema),
  }),
});

export interface SyncPush {
  modules: Module[];
  notes: Note[];
  cards: Card[];
  revlog: RevlogEntry[];
}

export interface SyncRequest {
  deviceId: string;
  cursor: number;
  push: SyncPush;
}

export interface SyncPull {
  modules: Module[];
  decks: Deck[];
  slides: SlideRow[];
  notes: Note[];
  cards: Card[];
  revlog: RevlogEntry[];
}

export interface SyncResponse {
  cursor: number;
  hasMore: boolean;
  pull: SyncPull;
}

export function emptyPush(): SyncPush {
  return { modules: [], notes: [], cards: [], revlog: [] };
}
```

`packages/core/src/index.ts` ergänzen:
```ts
export * from './rows.ts';
export * from './sync.ts';
```

In `apps/server/src/repo.ts`: die lokalen Konstanten `toModule`, `toDeck`, `toNote`, `toCard`, `toRevlog` löschen und stattdessen aus `@naklearn/core` importieren (Import-Liste oben ergänzen). Verhalten bleibt gleich.

- [ ] **Step 3: Tests laufen lassen**

Run: `nix develop -c npm test -w @naklearn/core && nix develop -c npm test -w @naklearn/server`
Expected: PASS (core neu + alle bisherigen Server-Tests unverändert grün).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(core): shared row mappers and sync protocol"
```

---

### Task 2: Server-Sync (Push/Pull) und `POST /api/sync`

**Files:**
- Create: `apps/server/src/sync.ts`
- Modify: `apps/server/src/app.ts` (Route)
- Test: `apps/server/test/sync.test.ts`

**Interfaces:**
- Consumes: `nextSeq`, `insertRevlog` (repo), `recomputeCard` (study), core-Mapper, `SyncPush`, `SyncResponse`, `SYNC_PAGE_SIZE`, `SyncRequestSchema`.
- Produces: `applyPush(db: Db, push: SyncPush): void`, `pullSince(db: Db, cursor: number, limit?: number): SyncResponse`; Route `POST /api/sync` (Body `SyncRequest` → `SyncResponse`).

- [ ] **Step 1: Failing Tests**

`apps/server/test/sync.test.ts`:
```ts
import { emptyPush } from '@naklearn/core';
import { describe, expect, it } from 'vitest';
import * as repo from '../src/repo.ts';
import { getNext } from '../src/study.ts';
import { applyPush, pullSince } from '../src/sync.ts';
import { memDb } from './helpers.ts';

function seeded() {
  const db = memDb();
  const mod = repo.createModule(db, { name: 'M', language: 'en' }, 1000);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' }, 1000);
  repo.replaceSlides(db, deck.id, [{ deckId: deck.id, page: 1, text: 'langer Text', image: '1.jpg' }]);
  const qa = repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 }, 1000);
  const cz = repo.insertNote(db, { deckId: deck.id, kind: 'cloze', front: '{{c1::X}}', back: '', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 1 }, 1000);
  return { db, mod, deck, qa, cz };
}

describe('pullSince', () => {
  it('liefert beim ersten Pull alles, danach nichts mehr', () => {
    const { db } = seeded();
    const first = pullSince(db, 0);
    expect(first.hasMore).toBe(false);
    expect(first.pull.modules).toHaveLength(1);
    expect(first.pull.decks).toHaveLength(1);
    expect(first.pull.slides).toEqual([{ deckId: first.pull.decks[0]!.id, page: 1, image: '1.jpg' }]);
    expect(first.pull.notes).toHaveLength(2);
    expect(first.pull.cards).toHaveLength(2);
    const again = pullSince(db, first.cursor);
    expect(again.cursor).toBe(first.cursor);
    expect(Object.values(again.pull).every((a) => a.length === 0)).toBe(true);
  });

  it('teilt große Änderungsmengen in Seiten ohne Lücken oder Doppelte', () => {
    const { db } = seeded();
    const seen = new Set<string>();
    let cursor = 0;
    let pages = 0;
    for (;;) {
      const r = pullSince(db, cursor, 3);
      pages++;
      for (const [k, arr] of Object.entries(r.pull)) for (const x of arr as { id?: string; deckId?: string; page?: number }[]) {
        const key = `${k}:${x.id ?? `${x.deckId}/${x.page}`}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      cursor = r.cursor;
      if (!r.hasMore) break;
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen.size).toBe(1 + 1 + 1 + 2 + 2);
  });
});

describe('applyPush', () => {
  it('übernimmt Bewertungen idempotent und berechnet den Kartenzustand', () => {
    const { db, qa } = seeded();
    const r = { id: 'r1', cardId: qa.cards[0]!.id, rating: 4 as const, reviewedAt: Date.now(), durationMs: 10, deviceId: 'phone', revokes: null };
    applyPush(db, { ...emptyPush(), revlog: [r] });
    applyPush(db, { ...emptyPush(), revlog: [r] });
    expect(repo.listRevlogForCard(db, qa.cards[0]!.id)).toHaveLength(1);
    expect(repo.studyRows(db).find((x) => x.cardId === qa.cards[0]!.id)!.state.state).toBe(2);
  });

  it('Last-Writer-Wins für Notes: ältere Änderung wird ignoriert, neuere übernommen und neu nummeriert', () => {
    const { db, qa } = seeded();
    const cursor = pullSince(db, 0).cursor;
    applyPush(db, { ...emptyPush(), notes: [{ ...qa.note, front: 'alt', updatedAt: 500 }] });
    expect(repo.getNote(db, qa.note.id)!.front).toBe('Q');
    applyPush(db, { ...emptyPush(), notes: [{ ...qa.note, front: 'neu', updatedAt: 5000 }] });
    expect(repo.getNote(db, qa.note.id)!.front).toBe('neu');
    expect(pullSince(db, cursor).pull.notes.map((n) => n.front)).toEqual(['neu']);
  });

  it('eine neuere Löschung auf dem Laptop gewinnt gegen eine ältere Bearbeitung vom Handy', () => {
    const { db, qa } = seeded();
    repo.deleteNote(db, qa.note.id, 9000);
    applyPush(db, { ...emptyPush(), notes: [{ ...qa.note, front: 'Handy', updatedAt: 8000 }] });
    expect(repo.getNote(db, qa.note.id)).toMatchObject({ deleted: true, front: 'Q' });
  });

  it('legt neue Lücken-Karten vom Handy an und übernimmt Pausieren', () => {
    const { db, cz } = seeded();
    applyPush(db, {
      ...emptyPush(),
      notes: [{ ...cz.note, front: '{{c1::X}} {{c2::Y}}', updatedAt: 5000 }],
      cards: [
        { id: 'phone-card', noteId: cz.note.id, ordinal: 2, suspended: false, deleted: false, updatedAt: 5000 },
        { ...cz.cards[0]!, suspended: true, updatedAt: 5000 },
      ],
    });
    const cards = repo.listCardsOfNote(db, cz.note.id);
    expect(cards.map((c) => [c.ordinal, c.suspended])).toEqual([[1, true], [2, false]]);
  });

  it('ignoriert Karten zu unbekannten Notes', () => {
    const { db } = seeded();
    applyPush(db, { ...emptyPush(), cards: [{ id: 'x', noteId: 'gibt-es-nicht', ordinal: 0, suspended: false, deleted: false, updatedAt: 1 }] });
    expect(repo.getCard(db, 'x')).toBeUndefined();
  });

  it('übernimmt Prüfungsdatum vom Handy', () => {
    const { db, mod } = seeded();
    applyPush(db, { ...emptyPush(), modules: [{ ...mod, examDate: '2026-10-30', updatedAt: 5000 }] });
    expect(repo.getModule(db, mod.id)!.examDate).toBe('2026-10-30');
    expect(getNext(db, {}, Date.now()).counts.new).toBeGreaterThan(0);
  });
});
```

Zusätzlich in `apps/server/test/app.test.ts` am Ende von `describe('HTTP-API', …)`:
```ts
  it('POST /api/sync validiert und liefert Pull-Daten', async () => {
    const { app, db } = await setup();
    repo.createModule(db, { name: 'M', language: 'en' });
    const bad = await app.inject({ method: 'POST', url: '/api/sync', payload: { deviceId: '', cursor: 0, push: {} } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST', url: '/api/sync',
      payload: { deviceId: 'phone', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pull.modules[0].name).toBe('M');
  });
```

Run: `nix develop -c npm test -w @naklearn/server -- sync app`
Expected: FAIL – `../src/sync.ts` fehlt bzw. Route 404.

- [ ] **Step 2: Implementierung**

`apps/server/src/sync.ts`:
```ts
import {
  SYNC_PAGE_SIZE, toCard, toDeck, toModule, toNote, toRevlog, toSlideRow,
  type SyncPull, type SyncPush, type SyncResponse,
} from '@naklearn/core';
import { tx, type Db } from './db.ts';
import { insertRevlog, nextSeq } from './repo.ts';
import { recomputeCard } from './study.ts';

type Row = Record<string, any>;

function currentUpdatedAt(db: Db, table: 'module' | 'note' | 'card', id: string): number | null {
  const r = db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
  return r ? r.updated_at : null;
}

/** Übernimmt Änderungen eines Geräts: Bewertungen idempotent, alles andere Last-Writer-Wins. */
export function applyPush(db: Db, push: SyncPush): void {
  tx(db, () => {
    for (const m of push.modules) {
      const cur = currentUpdatedAt(db, 'module', m.id);
      if (cur === null || m.updatedAt <= cur) continue;
      db.prepare('UPDATE module SET name = ?, language = ?, exam_date = ?, new_per_day = ?, deleted = ?, updated_at = ?, seq = ? WHERE id = ?')
        .run(m.name, m.language, m.examDate, m.newPerDay, m.deleted ? 1 : 0, m.updatedAt, nextSeq(db), m.id);
    }
    for (const n of push.notes) {
      const cur = currentUpdatedAt(db, 'note', n.id);
      if (cur === null || n.updatedAt <= cur) continue;
      db.prepare('UPDATE note SET front = ?, back = ?, tags = ?, deleted = ?, updated_at = ?, seq = ? WHERE id = ?')
        .run(n.front, n.back, JSON.stringify(n.tags), n.deleted ? 1 : 0, n.updatedAt, nextSeq(db), n.id);
    }
    for (const c of push.cards) {
      const cur = currentUpdatedAt(db, 'card', c.id);
      if (cur !== null) {
        if (c.updatedAt <= cur) continue;
        db.prepare('UPDATE card SET suspended = ?, deleted = ?, updated_at = ?, seq = ? WHERE id = ?')
          .run(c.suspended ? 1 : 0, c.deleted ? 1 : 0, c.updatedAt, nextSeq(db), c.id);
      } else if (db.prepare('SELECT 1 FROM note WHERE id = ?').get(c.noteId)) {
        db.prepare('INSERT INTO card (id, note_id, ordinal, suspended, deleted, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(c.id, c.noteId, c.ordinal, c.suspended ? 1 : 0, c.deleted ? 1 : 0, c.updatedAt, nextSeq(db));
      }
    }
    const touched = new Set<string>();
    for (const r of push.revlog) {
      insertRevlog(db, r);
      touched.add(r.cardId);
    }
    for (const id of touched) recomputeCard(db, id);
  });
}

const TABLES = [
  ['module', 'modules', toModule],
  ['deck', 'decks', toDeck],
  ['slide', 'slides', toSlideRow],
  ['note', 'notes', toNote],
  ['card', 'cards', toCard],
  ['revlog', 'revlog', toRevlog],
] as const;

/** Alle Zeilen mit seq > cursor, global nach seq sortiert, höchstens `limit` pro Antwort. */
export function pullSince(db: Db, cursor: number, limit = SYNC_PAGE_SIZE): SyncResponse {
  const items: { seq: number; key: keyof SyncPull; row: unknown }[] = [];
  for (const [table, key, map] of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE seq > ? ORDER BY seq LIMIT ?`).all(cursor, limit + 1) as Row[];
    for (const r of rows) items.push({ seq: r.seq, key, row: map(r) });
  }
  items.sort((a, b) => a.seq - b.seq);
  const page = items.slice(0, limit);
  const pull: SyncPull = { modules: [], decks: [], slides: [], notes: [], cards: [], revlog: [] };
  for (const i of page) (pull[i.key] as unknown[]).push(i.row);
  return { cursor: page.length ? page[page.length - 1]!.seq : cursor, hasMore: items.length > limit, pull };
}
```

In `apps/server/src/app.ts`:
- Import ergänzen: `import { SyncRequestSchema } from '@naklearn/core';` und `import { applyPush, pullSince } from './sync.ts';`
- Route vor `// ---- Folienbilder ----` einfügen:
```ts
  // ---- Sync ----
  app.post('/api/sync', async (req) => {
    const body = SyncRequestSchema.parse(req.body);
    applyPush(db, body.push);
    return pullSince(db, body.cursor);
  });
```
- `bodyLimit` von `1 << 20` auf `16 << 20` erhöhen (Push nach langer Offline-Zeit).

- [ ] **Step 3: Tests laufen lassen**

Run: `nix develop -c npm test -w @naklearn/server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(server): sync endpoint with idempotent push and paged pull"
```

---

### Task 3: Koppeln – Tailscale-Adresse, QR-Code im Studio

**Files:**
- Create: `apps/server/src/pair.ts`, `apps/client/src/pages/PairPage.tsx`
- Modify: `apps/server/src/app.ts` (Route `GET /api/pair`), `apps/client/src/main.tsx`, `apps/client/src/router.ts` (Route `pair`), `apps/client/src/pages/Home.tsx` (Link), `apps/client/src/api.ts` (`api.pair()`)
- Test: `apps/server/test/pair.test.ts`, `apps/client/test/router.test.ts` (Fall ergänzen)

**Interfaces:**
- Produces: `detectPublicUrl(port: number, env: NodeJS.ProcessEnv, exec?: (cmd: string, args: string[]) => Promise<{ stdout: string }>): Promise<string | null>`; `pairingPayload(url: string, token: string): string` (JSON `{"v":1,"url":…,"token":…}`); Route `GET /api/pair` → `{ url: string | null, token: string, payload: string | null, qrSvg: string | null }`, nur von Loopback (sonst 403); Studio-Route `#/pair`.

- [ ] **Step 1: Abhängigkeit**

Run: `nix develop -c npm install -w @naklearn/server qrcode@^1.5.4 && nix develop -c npm install -w @naklearn/server -D @types/qrcode@^1.5.6` – danach `apps/server/package.json` prüfen.

- [ ] **Step 2: Failing Tests**

`apps/server/test/pair.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { detectPublicUrl, pairingPayload } from '../src/pair.ts';

const tsJson = JSON.stringify({ Self: { DNSName: 'nixos.tail1234.ts.net.', TailscaleIPs: ['100.101.102.103', 'fd7a::1'] } });

describe('detectPublicUrl', () => {
  it('bevorzugt NAKLEARN_PUBLIC_URL', async () => {
    expect(await detectPublicUrl(8742, { NAKLEARN_PUBLIC_URL: 'http://x:1/' }, async () => ({ stdout: tsJson }))).toBe('http://x:1');
  });
  it('nutzt den MagicDNS-Namen aus tailscale status', async () => {
    expect(await detectPublicUrl(8742, {}, async () => ({ stdout: tsJson }))).toBe('http://nixos.tail1234.ts.net:8742');
  });
  it('liefert null ohne Tailscale', async () => {
    expect(await detectPublicUrl(8742, {}, async () => { throw new Error('ENOENT'); })).toBeNull();
  });
});

describe('pairingPayload', () => {
  it('enthält Version, URL und Token', () => {
    expect(JSON.parse(pairingPayload('http://h:1', 't'))).toEqual({ v: 1, url: 'http://h:1', token: 't' });
  });
});
```

In `apps/server/test/app.test.ts` ergänzen:
```ts
  it('GET /api/pair nur vom Laptop selbst', async () => {
    const { app } = await setup();
    const local = await app.inject({ method: 'GET', url: '/api/pair' });
    expect(local.statusCode).toBe(200);
    expect(local.json().token).toBe('secret');
    const remote = await app.inject({ method: 'GET', url: '/api/pair', headers: { authorization: 'Bearer secret' }, remoteAddress: '100.64.1.2' });
    expect(remote.statusCode).toBe(403);
  });
```

`apps/client/test/router.test.ts`: in der `it.each`-Tabelle `['#/pair', { name: 'pair', params: {} }],` ergänzen.

Run: `nix develop -c npm test -w @naklearn/server -- pair app && nix develop -c npm test -w @naklearn/client`
Expected: FAIL.

- [ ] **Step 3: Implementierung Server**

`apps/server/src/pair.ts`:
```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

/** Adresse, unter der das Handy den Server erreicht (Tailscale MagicDNS bevorzugt). */
export async function detectPublicUrl(port: number, env: NodeJS.ProcessEnv, exec: Exec = execFileAsync): Promise<string | null> {
  if (env.NAKLEARN_PUBLIC_URL) return env.NAKLEARN_PUBLIC_URL.replace(/\/+$/, '');
  try {
    const { stdout } = await exec('tailscale', ['status', '--json']);
    const self = JSON.parse(stdout)?.Self;
    const dns = typeof self?.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : '';
    if (dns) return `http://${dns}:${port}`;
    const ip = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs.find((x: string) => x.includes('.')) : undefined;
    return ip ? `http://${ip}:${port}` : null;
  } catch {
    return null;
  }
}

export function pairingPayload(url: string, token: string): string {
  return JSON.stringify({ v: 1, url, token });
}
```

In `apps/server/src/app.ts`:
- Imports: `import QRCode from 'qrcode';` und `import { detectPublicUrl, pairingPayload } from './pair.ts';`
- `buildApp`-Deps um optionales `publicUrl?: () => Promise<string | null>` erweitern; Standard: `() => detectPublicUrl(cfg.port, process.env)`.
- Route:
```ts
  // ---- Koppeln ----
  app.get('/api/pair', async (req, reply) => {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return reply.code(403).send({ error: 'Koppeln nur am Laptop' });
    const url = await (deps.publicUrl ?? (() => detectPublicUrl(cfg.port, process.env)))();
    const payload = url ? pairingPayload(url, cfg.token) : null;
    const qrSvg = payload ? await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
    return { url, token: cfg.token, payload, qrSvg };
  });
```
Im App-Test-`setup()` `publicUrl: async () => 'http://test.ts.net:8742'` an `buildApp` übergeben.

- [ ] **Step 4: Implementierung Studio**

`apps/client/src/router.ts`: `RouteName` um `'pair'` erweitern; in `parseRoute` vor dem `browse`-Fall: `if (seg[0] === 'pair') return { name: 'pair', params: {} };`; in `href`: `if (name === 'pair') return '#/pair';`.

`apps/client/src/api.ts` in `api` ergänzen:
```ts
  pair: () => request<{ url: string | null; token: string; payload: string | null; qrSvg: string | null }>('/api/pair'),
```

`apps/client/src/pages/PairPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { href } from '../router.ts';

export function PairPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.pair>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  useEffect(() => {
    api.pair().then(setData, (e) => setError(String(e.message)));
  }, []);
  return (
    <main className="page">
      <header className="topbar">
        <a href={href('home')}>← Übersicht</a>
        <h1>Handy koppeln</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {data && !data.url && (
        <p className="warn">
          Tailscale-Adresse nicht gefunden. Läuft Tailscale (<code>tailscale status</code>)? Alternativ
          <code> NAKLEARN_PUBLIC_URL</code> setzen.
        </p>
      )}
      {data?.qrSvg && <div className="qr" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />}
      {data && (
        <ol className="steps">
          <li>Tailscale-App auf dem Handy installieren und mit demselben Account anmelden.</li>
          <li>NAKLearn-App öffnen → Einstellungen → „QR-Code scannen“.</li>
          <li>
            Oder manuell eintragen: Adresse <code>{data.url ?? '–'}</code>, Token{' '}
            {showToken ? <code className="token">{data.token}</code> : <button onClick={() => setShowToken(true)}>anzeigen</button>}
          </li>
        </ol>
      )}
    </main>
  );
}
```

`apps/client/src/main.tsx`: `import { PairPage } from './pages/PairPage.tsx';` und im Switch `case 'pair': return <PairPage />;`.

`apps/client/src/pages/Home.tsx`: im `hero`-Abschnitt nach dem Browser-Link `<a href={href('pair')}>Handy koppeln</a>` ergänzen.

`apps/client/src/styles.css` ergänzen:
```css
.qr { width: min(320px, 80vw); background: #fff; padding: 12px; border-radius: 12px; margin: 16px 0; }
.qr svg { width: 100%; height: auto; display: block; }
.steps li { margin: 6px 0; }
.token { word-break: break-all; }
```

- [ ] **Step 5: Tests laufen lassen**

Run: `nix develop -c npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: pairing endpoint and studio page with QR code"
```

---

### Task 4: `packages/store` – LocalStore (Lernen + Sync-Client)

**Files:**
- Create: `packages/store/package.json`, `packages/store/src/{adapter.ts,migrate.ts,store.ts,sync.ts,index.ts}`
- Create: `packages/store/test/{nodeAdapter.ts,seed.ts,store.test.ts}`
- Create: `apps/server/test/sync-e2e.test.ts`
- Modify: `apps/server/package.json` (devDependency `@naklearn/store`)

**Interfaces:**
- Consumes: core (Mapper, Queue, Scheduler, Exam, Stats, Sync-Typen, `CORE_MIGRATIONS`, `toStudyCard`), Server `buildApp` (nur im E2E-Test).
- Produces:
  - `interface SqlAdapter { execute(sql: string): Promise<void>; run(sql: string, params?: unknown[]): Promise<void>; all<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>; transaction<T>(fn: () => Promise<T>): Promise<T> }`
  - `migrate(db: SqlAdapter): Promise<void>`
  - `class LocalStore` mit `static open(db: SqlAdapter, opts?: { now?: () => number }): Promise<LocalStore>`, `readonly db`, `deviceId: string`, `nowMs(): number`, `getMeta(key): Promise<string | null>`, `setMeta(key, value): Promise<void>`, `next(scope)`, `answer(cardId, rating, durationMs)`, `undo(revlogId)`, `setSuspended(cardId, suspended)`, `updateNote(noteId, { front, back })`, `deleteNote(noteId)`, `updateModule(id, patch: { examDate?: string | null; newPerDay?: number })`, `overview(): Promise<StoreOverview>`, `moduleDetail(id): Promise<{ module: Module; decks: (Deck & { noteCount: number })[] } | null>`, `listSlides(): Promise<SlideRow[]>`, `recompute(cardId): Promise<void>`
  - `type StoreOverview = { studiedToday: number; streak: number; modules: (ModuleStats & { name: string; language: Language; examDate: string | null; newPerDay: number })[] }`
  - `type Transport = (req: SyncRequest) => Promise<SyncResponse>`, `syncStore(store: LocalStore, transport: Transport): Promise<{ pushed: number; pulled: number; cursor: number }>`
  - Test-Helper `nodeAdapter(db?: DatabaseSync): SqlAdapter`

- [ ] **Step 1: Paket anlegen**

`packages/store/package.json`:
```json
{
  "name": "@naklearn/store",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "TZ=Asia/Seoul vitest run" },
  "dependencies": { "@naklearn/core": "*" }
}
```
Run: `nix develop -c npm install` (registriert den Workspace). In `apps/server/package.json` unter `devDependencies` `"@naklearn/store": "*"` eintragen, erneut `nix develop -c npm install`.

`packages/store/src/adapter.ts`:
```ts
export type Row = Record<string, any>;

/** Minimale asynchrone SQL-Schnittstelle (node:sqlite in Tests, Capacitor SQLite auf dem Handy). */
export interface SqlAdapter {
  execute(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

`packages/store/test/nodeAdapter.ts`:
```ts
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlAdapter } from '../src/adapter.ts';

export function nodeAdapter(db: DatabaseSync = new DatabaseSync(':memory:')): SqlAdapter {
  let depth = 0;
  return {
    async execute(sql) { db.exec(sql); },
    async run(sql, params = []) { db.prepare(sql).run(...(params as SQLInputValue[])); },
    async all(sql, params = []) { return db.prepare(sql).all(...(params as SQLInputValue[])) as never; },
    async transaction(fn) {
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN');
      try {
        const r = await fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
```

`packages/store/test/seed.ts` (legt Daten so an, wie sie nach einem Pull aussähen):
```ts
import type { SqlAdapter } from '../src/adapter.ts';

export async function seed(db: SqlAdapter, opts: { examDate?: string | null } = {}) {
  await db.run("INSERT INTO module (id, name, language, exam_date, new_per_day, updated_at) VALUES ('m1', 'UIUX', 'en', ?, 20, 1)", [opts.examDate ?? null]);
  await db.run("INSERT INTO deck (id, module_id, title, pdf_sha256, page_count, status, position, updated_at) VALUES ('d1', 'm1', 'Ch1', 's', 2, 'ready', 1, 1)");
  await db.run("INSERT INTO slide (deck_id, page, text, image) VALUES ('d1', 1, '', '1.jpg'), ('d1', 2, '', '2.jpg')");
  await db.run(`INSERT INTO note (id, deck_id, kind, front, back, slide_refs, front_image_page, tags, source, position, updated_at)
    VALUES ('n1', 'd1', 'qa', 'Q1', 'A1', '[1]', NULL, '[]', 'chunk', 1, 1),
           ('n2', 'd1', 'cloze', '{{c1::X}} und {{c2::Y}}', '', '[2]', NULL, '[]', 'chunk', 2, 1)`);
  await db.run("INSERT INTO card (id, note_id, ordinal, updated_at) VALUES ('c1', 'n1', 0, 1), ('c2a', 'n2', 1, 1), ('c2b', 'n2', 2, 1)");
}
```

- [ ] **Step 2: Failing Tests für den LocalStore**

`packages/store/test/store.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { LocalStore } from '../src/store.ts';
import { nodeAdapter } from './nodeAdapter.ts';
import { seed } from './seed.ts';

const NOW = new Date('2026-10-06T10:00:00+09:00').getTime();

async function open(examDate: string | null = null) {
  const db = nodeAdapter();
  let now = NOW;
  const store = await LocalStore.open(db, { now: () => now });
  await seed(db, { examDate });
  return { db, store, advance: (ms: number) => (now += ms) };
}

describe('LocalStore', () => {
  it('migriert, vergibt eine stabile Geräte-ID', async () => {
    const db = nodeAdapter();
    const a = await LocalStore.open(db);
    const b = await LocalStore.open(db);
    expect(a.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.deviceId).toBe(a.deviceId);
  });

  it('lernt offline: nächste Karte, bewerten, rückgängig – alles als dirty markiert', async () => {
    const { db, store, advance } = await open();
    const first = await store.next({});
    expect(first.card).toMatchObject({ front: 'Q1', intervals: { 3: '10m' } });
    expect(first.counts).toEqual({ learning: 0, review: 0, new: 3 });
    const { revlogId } = await store.answer(first.card!.cardId, 3, 2000);
    advance(60_000);
    expect((await store.next({})).counts).toEqual({ learning: 1, review: 0, new: 2 });
    await store.undo(revlogId);
    expect((await store.next({})).counts).toEqual({ learning: 0, review: 0, new: 3 });
    const dirty = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM revlog WHERE dirty = 1');
    expect(dirty[0]!.n).toBe(2);
  });

  it('bearbeitet Lückentext und legt neue Karten als dirty an', async () => {
    const { db, store } = await open();
    await store.updateNote('n2', { front: '{{c1::X}} {{c2::Y}} {{c3::Z}}', back: 'mehr' });
    const cards = await db.all<{ ordinal: number; dirty: number; deleted: number }>("SELECT ordinal, dirty, deleted FROM card WHERE note_id = 'n2' ORDER BY ordinal");
    expect(cards).toEqual([{ ordinal: 1, dirty: 0, deleted: 0 }, { ordinal: 2, dirty: 0, deleted: 0 }, { ordinal: 3, dirty: 1, deleted: 0 }]);
    const note = await db.all<{ dirty: number; back: string }>("SELECT dirty, back FROM note WHERE id = 'n2'");
    expect(note[0]).toEqual({ dirty: 1, back: 'mehr' });
  });

  it('löscht eine Notiz samt Karten als dirty', async () => {
    const { db, store } = await open();
    await store.deleteNote('n2');
    expect((await store.next({})).counts.new).toBe(1);
    const rows = await db.all<{ deleted: number; dirty: number }>("SELECT deleted, dirty FROM card WHERE note_id = 'n2'");
    expect(rows).toEqual([{ deleted: 1, dirty: 1 }, { deleted: 1, dirty: 1 }]);
  });

  it('pausiert Karten und ändert Moduleinstellungen', async () => {
    const { db, store } = await open();
    await store.setSuspended('c1', true);
    await store.updateModule('m1', { examDate: '2026-10-30', newPerDay: 30 });
    expect((await store.next({})).counts.new).toBe(2);
    const m = await db.all<{ exam_date: string; new_per_day: number; dirty: number }>("SELECT exam_date, new_per_day, dirty FROM module WHERE id = 'm1'");
    expect(m[0]).toEqual({ exam_date: '2026-10-30', new_per_day: 30, dirty: 1 });
  });

  it('liefert Übersicht, Moduldetails und Folienliste', async () => {
    const { store } = await open('2026-10-30');
    const o = await store.overview();
    expect(o.modules[0]).toMatchObject({ name: 'UIUX', total: 3, new: 3, daysToExam: 24 });
    const d = await store.moduleDetail('m1');
    expect(d!.decks[0]).toMatchObject({ title: 'Ch1', noteCount: 2 });
    expect(await store.moduleDetail('nope')).toBeNull();
    expect(await store.listSlides()).toEqual([{ deckId: 'd1', page: 1, image: '1.jpg' }, { deckId: 'd1', page: 2, image: '2.jpg' }]);
  });
});
```

Run: `nix develop -c npm test -w @naklearn/store`
Expected: FAIL – `../src/store.ts` fehlt.

- [ ] **Step 3: Implementierung LocalStore**

`packages/store/src/migrate.ts`:
```ts
import { CORE_MIGRATIONS } from '@naklearn/core';
import type { SqlAdapter } from './adapter.ts';

export async function migrate(db: SqlAdapter): Promise<void> {
  const rows = await db.all<{ user_version: number }>('PRAGMA user_version');
  for (let v = rows[0]?.user_version ?? 0; v < CORE_MIGRATIONS.length; v++) {
    await db.transaction(async () => {
      await db.execute(CORE_MIGRATIONS[v]!);
      await db.execute(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
```

`packages/store/src/store.ts`:
```ts
import {
  clozeOrdinals, effectiveDueMs, effectiveLogs, emptyState, formatInterval, moduleStats, newId, nextCard,
  previewIntervals, replay, streak, studyDay, toCard, toDeck, toModule, toNote, toRevlog, toSlideRow, toStudyCard,
  type CardState, type Deck, type Grade, type Language, type Module, type ModuleStats, type QueueCard,
  type QueueCounts, type Scope, type SlideRow, type StudyCard,
} from '@naklearn/core';
import type { Row, SqlAdapter } from './adapter.ts';
import { migrate } from './migrate.ts';

export interface StoreOverview {
  studiedToday: number;
  streak: number;
  modules: (ModuleStats & { name: string; language: Language; examDate: string | null; newPerDay: number })[];
}

export class LocalStore {
  readonly db: SqlAdapter;
  deviceId = '';
  private clock: () => number;

  private constructor(db: SqlAdapter, clock: () => number) {
    this.db = db;
    this.clock = clock;
  }

  static async open(db: SqlAdapter, opts: { now?: () => number } = {}): Promise<LocalStore> {
    await migrate(db);
    const store = new LocalStore(db, opts.now ?? Date.now);
    let id = await store.getMeta('device_id');
    if (!id) {
      id = newId();
      await store.setMeta('device_id', id);
    }
    store.deviceId = id;
    return store;
  }

  nowMs(): number {
    return this.clock();
  }

  async getMeta(key: string): Promise<string | null> {
    const r = await this.db.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return r[0]?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  async listModules(): Promise<Module[]> {
    return (await this.db.all('SELECT * FROM module WHERE deleted = 0 ORDER BY name')).map(toModule);
  }

  private async studyRows(): Promise<QueueCard[]> {
    const rows = await this.db.all(
      `SELECT c.id AS card_id, c.ordinal, c.suspended, n.id AS note_id, n.position AS note_pos,
              d.id AS deck_id, d.position AS deck_pos, d.module_id, s.json, s.first_reviewed_at
       FROM card c
       JOIN note n ON n.id = c.note_id
       JOIN deck d ON d.id = n.deck_id
       JOIN module m ON m.id = d.module_id
       LEFT JOIN card_state s ON s.card_id = c.id
       WHERE c.deleted = 0 AND n.deleted = 0 AND d.deleted = 0 AND m.deleted = 0`,
    );
    return rows.map((r: Row) => ({
      cardId: r.card_id, noteId: r.note_id, deckId: r.deck_id, moduleId: r.module_id,
      sortKey: [r.deck_pos, r.note_pos, r.ordinal] as [number, number, number],
      state: r.json ? (JSON.parse(r.json) as CardState) : emptyState(),
      firstReviewedAt: r.first_reviewed_at ?? null,
      suspended: !!r.suspended,
    }));
  }

  async next(scope: Scope): Promise<{ card: StudyCard | null; counts: QueueCounts }> {
    const now = this.clock();
    const mods = await this.listModules();
    const { next, counts } = nextCard(
      await this.studyRows(),
      mods.map((m) => ({ id: m.id, examDate: m.examDate, newPerDay: m.newPerDay })),
      scope,
      now,
    );
    if (!next) return { card: null, counts };
    const [noteRow] = await this.db.all('SELECT * FROM note WHERE id = ?', [next.noteId]);
    const [cardRow] = await this.db.all('SELECT * FROM card WHERE id = ?', [next.cardId]);
    const [deckRow] = await this.db.all('SELECT * FROM deck WHERE id = ?', [next.deckId]);
    const mod = mods.find((m) => m.id === next.moduleId)!;
    const raw = previewIntervals(next.state, now, (s) => effectiveDueMs(s, next.cardId, mod.examDate, now));
    const intervals = { 1: formatInterval(raw[1]), 2: formatInterval(raw[2]), 3: formatInterval(raw[3]), 4: formatInterval(raw[4]) };
    return {
      card: toStudyCard({ note: toNote(noteRow!), card: toCard(cardRow!), moduleName: mod.name, deckTitle: toDeck(deckRow!).title, intervals }),
      counts,
    };
  }

  async recompute(cardId: string): Promise<void> {
    const logs = (await this.db.all('SELECT * FROM revlog WHERE card_id = ?', [cardId])).map(toRevlog);
    const first = effectiveLogs(logs)[0]?.reviewedAt ?? null;
    await this.db.run(
      `INSERT INTO card_state (card_id, json, first_reviewed_at) VALUES (?, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET json = excluded.json, first_reviewed_at = excluded.first_reviewed_at`,
      [cardId, JSON.stringify(replay(logs)), first],
    );
  }

  async answer(cardId: string, rating: Grade, durationMs: number): Promise<{ revlogId: string }> {
    const id = newId();
    await this.db.transaction(async () => {
      await this.db.run(
        'INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, revokes, dirty) VALUES (?, ?, ?, ?, ?, ?, NULL, 1)',
        [id, cardId, rating, this.clock(), Math.max(0, Math.round(durationMs)), this.deviceId],
      );
      await this.recompute(cardId);
    });
    return { revlogId: id };
  }

  async undo(revlogId: string): Promise<void> {
    const [target] = await this.db.all('SELECT * FROM revlog WHERE id = ? AND revokes IS NULL', [revlogId]);
    if (!target) throw new Error('Bewertung nicht gefunden');
    const already = await this.db.all('SELECT 1 FROM revlog WHERE revokes = ?', [revlogId]);
    if (already.length) throw new Error('Bewertung wurde bereits zurückgenommen');
    await this.db.transaction(async () => {
      await this.db.run(
        'INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, revokes, dirty) VALUES (?, ?, 0, ?, 0, ?, ?, 1)',
        [newId(), target.card_id, this.clock(), this.deviceId, revlogId],
      );
      await this.recompute(target.card_id);
    });
  }

  async deleteNote(noteId: string): Promise<void> {
    const now = this.clock();
    await this.db.transaction(async () => {
      await this.db.run('UPDATE note SET deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?', [now, noteId]);
      await this.db.run('UPDATE card SET deleted = 1, updated_at = ?, dirty = 1 WHERE note_id = ?', [now, noteId]);
    });
  }

  async setSuspended(cardId: string, suspended: boolean): Promise<void> {
    await this.db.run('UPDATE card SET suspended = ?, updated_at = ?, dirty = 1 WHERE id = ?', [suspended ? 1 : 0, this.clock(), cardId]);
  }

  async updateNote(noteId: string, patch: { front: string; back: string }): Promise<void> {
    const [row] = await this.db.all('SELECT * FROM note WHERE id = ?', [noteId]);
    if (!row) throw new Error('Karte nicht gefunden');
    const note = toNote(row);
    const ords = note.kind === 'cloze' ? clozeOrdinals(patch.front) : [0];
    if (ords.length === 0) throw new Error('Lückentext ohne Lücke ({{c1::…}})');
    const now = this.clock();
    await this.db.transaction(async () => {
      await this.db.run('UPDATE note SET front = ?, back = ?, updated_at = ?, dirty = 1 WHERE id = ?', [patch.front, patch.back, now, noteId]);
      const cards = (await this.db.all('SELECT * FROM card WHERE note_id = ?', [noteId])).map(toCard);
      for (const c of cards) {
        const live = ords.includes(c.ordinal);
        if (live === c.deleted) {
          await this.db.run('UPDATE card SET deleted = ?, updated_at = ?, dirty = 1 WHERE id = ?', [live ? 0 : 1, now, c.id]);
        }
      }
      for (const o of ords) {
        if (!cards.some((c) => c.ordinal === o)) {
          await this.db.run('INSERT INTO card (id, note_id, ordinal, updated_at, dirty) VALUES (?, ?, ?, ?, 1)', [newId(), noteId, o, now]);
        }
      }
    });
  }

  async updateModule(id: string, patch: { examDate?: string | null; newPerDay?: number }): Promise<void> {
    const [row] = await this.db.all('SELECT * FROM module WHERE id = ?', [id]);
    if (!row) throw new Error('Modul nicht gefunden');
    const m = { ...toModule(row), ...patch };
    await this.db.run('UPDATE module SET exam_date = ?, new_per_day = ?, updated_at = ?, dirty = 1 WHERE id = ?', [m.examDate, m.newPerDay, this.clock(), id]);
  }

  async overview(): Promise<StoreOverview> {
    const now = this.clock();
    const times = (await this.db.all<{ reviewed_at: number }>(
      'SELECT reviewed_at FROM revlog r WHERE rating >= 1 AND NOT EXISTS (SELECT 1 FROM revlog u WHERE u.revokes = r.id)',
    )).map((r) => r.reviewed_at);
    const today = studyDay(now);
    const rows = await this.studyRows();
    return {
      studiedToday: times.filter((t) => studyDay(t) === today).length,
      streak: streak(times, now),
      modules: (await this.listModules()).map((m) => ({
        ...moduleStats(rows, { id: m.id, examDate: m.examDate, newPerDay: m.newPerDay }, now),
        name: m.name, language: m.language, examDate: m.examDate, newPerDay: m.newPerDay,
      })),
    };
  }

  async moduleDetail(id: string): Promise<{ module: Module; decks: (Deck & { noteCount: number })[] } | null> {
    const [row] = await this.db.all('SELECT * FROM module WHERE id = ? AND deleted = 0', [id]);
    if (!row) return null;
    const decks = await this.db.all(
      `SELECT d.*, (SELECT COUNT(*) FROM note n WHERE n.deck_id = d.id AND n.deleted = 0) AS note_count
       FROM deck d WHERE d.module_id = ? AND d.deleted = 0 ORDER BY d.position`,
      [id],
    );
    return { module: toModule(row), decks: decks.map((d: Row) => ({ ...toDeck(d), noteCount: d.note_count })) };
  }

  async listSlides(): Promise<SlideRow[]> {
    return (await this.db.all(
      'SELECT s.* FROM slide s JOIN deck d ON d.id = s.deck_id WHERE d.deleted = 0 ORDER BY d.position, s.page',
    )).map(toSlideRow);
  }
}
```

`packages/store/src/index.ts`:
```ts
export * from './adapter.ts';
export * from './migrate.ts';
export * from './store.ts';
export * from './sync.ts';
```
(`sync.ts` folgt in Step 5; bis dahin die Zeile weglassen.)

Run: `nix develop -c npm test -w @naklearn/store`
Expected: PASS.

- [ ] **Step 4: Failing Tests für den Sync-Client (gegen den echten Server)**

`apps/server/test/sync-e2e.test.ts`:
```ts
import type { SyncRequest, SyncResponse } from '@naklearn/core';
import { LocalStore, syncStore, type SqlAdapter } from '@naklearn/store';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import * as repo from '../src/repo.ts';
import { answer, getNext } from '../src/study.ts';
import { memDb } from './helpers.ts';

function nodeAdapter(): SqlAdapter {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    async execute(sql) { db.exec(sql); },
    async run(sql, p = []) { db.prepare(sql).run(...(p as SQLInputValue[])); },
    async all(sql, p = []) { return db.prepare(sql).all(...(p as SQLInputValue[])) as never; },
    async transaction(fn) {
      if (depth) return fn();
      depth++; db.exec('BEGIN');
      try { const r = await fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth--; }
    },
  };
}

const NOW = new Date('2026-10-06T10:00:00+09:00').getTime();

async function setup() {
  const db = memDb();
  const cfg = { dataDir: '/tmp', port: 0, host: '127.0.0.1', token: 't', deviceId: 'laptop', claudePath: '', summaryModel: null, cardsModel: null, webDir: null };
  const worker = { wake() {}, resume() {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
  const app = buildApp({ db, cfg, worker, now: () => NOW, publicUrl: async () => null });
  const mod = repo.createModule(db, { name: 'UIUX', language: 'en' });
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'Ch1', pdfSha256: 's' });
  repo.replaceSlides(db, deck.id, [{ deckId: deck.id, page: 1, text: 't', image: '1.jpg' }]);
  for (let i = 0; i < 3; i++) {
    repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: `Q${i}`, back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: i });
  }
  let calls = 0;
  let failNext = false;
  const transport = async (req: SyncRequest): Promise<SyncResponse> => {
    calls++;
    if (failNext) { failNext = false; throw new Error('Netz weg'); }
    const r = await app.inject({ method: 'POST', url: '/api/sync', payload: req });
    if (r.statusCode !== 200) throw new Error(r.body);
    return r.json();
  };
  let phoneNow = NOW;
  const phone = await LocalStore.open(nodeAdapter(), { now: () => phoneNow });
  return { db, mod, deck, phone, transport, calls: () => calls, failOnce: () => (failNext = true), tick: (ms: number) => (phoneNow += ms) };
}

describe('Sync Handy ↔ Laptop', () => {
  it('erster Sync holt Module, Karten und Folienliste', async () => {
    const { phone, transport } = await setup();
    const r = await syncStore(phone, transport);
    expect(r.pulled).toBeGreaterThan(0);
    expect((await phone.overview()).modules[0]).toMatchObject({ name: 'UIUX', total: 3 });
    expect(await phone.listSlides()).toHaveLength(1);
    expect((await syncStore(phone, transport)).pulled).toBe(0);
  });

  it('offline gelernte Karten landen auf dem Laptop, Laptop-Lernen landet auf dem Handy', async () => {
    const { db, phone, transport } = await setup();
    await syncStore(phone, transport);
    const c = (await phone.next({})).card!;
    await phone.answer(c.cardId, 4, 1000);
    const pushed = await syncStore(phone, transport);
    expect(pushed.pushed).toBe(1);
    expect(repo.studyRows(db).find((x) => x.cardId === c.cardId)!.state.state).toBe(2);

    const laptopCard = getNext(db, {}, NOW).card!;
    expect(laptopCard.cardId).not.toBe(c.cardId);
    answer(db, { cardId: laptopCard.cardId, rating: 3, durationMs: 1, deviceId: 'laptop', now: NOW });
    await syncStore(phone, transport);
    expect((await phone.next({})).counts.learning).toBe(1);
  });

  it('dieselbe Karte auf beiden Geräten gelernt → gleicher Zustand überall', async () => {
    const { db, phone, transport, tick } = await setup();
    await syncStore(phone, transport);
    const cardId = (await phone.next({})).card!.cardId;
    answer(db, { cardId, rating: 3, durationMs: 1, deviceId: 'laptop', now: NOW });
    tick(15 * 60_000);
    await phone.answer(cardId, 3, 1000);
    await syncStore(phone, transport);
    const server = repo.studyRows(db).find((x) => x.cardId === cardId)!.state;
    const [local] = await phone.db.all<{ json: string }>('SELECT json FROM card_state WHERE card_id = ?', [cardId]);
    expect(JSON.parse(local!.json)).toEqual(server);
    expect(server.reps).toBe(2);
  });

  it('bricht der Sync ab, geht nichts verloren und nichts doppelt', async () => {
    const { db, phone, transport, failOnce } = await setup();
    await syncStore(phone, transport);
    const c = (await phone.next({})).card!;
    await phone.answer(c.cardId, 3, 1000);
    failOnce();
    await expect(syncStore(phone, transport)).rejects.toThrow('Netz weg');
    const dirty = await phone.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM revlog WHERE dirty = 1');
    expect(dirty[0]!.n).toBe(1);
    await syncStore(phone, transport);
    await syncStore(phone, transport);
    expect(repo.listRevlogForCard(db, c.cardId)).toHaveLength(1);
  });

  it('Bearbeitung, Pausieren und Prüfungsdatum vom Handy erreichen den Laptop', async () => {
    const { db, mod, phone, transport, tick } = await setup();
    await syncStore(phone, transport);
    tick(60_000);
    const c = (await phone.next({})).card!;
    await phone.updateNote(c.noteId, { front: 'Neu vom Handy', back: 'B' });
    await phone.setSuspended(c.cardId, true);
    await phone.updateModule(mod.id, { examDate: '2026-10-30' });
    await syncStore(phone, transport);
    expect(repo.getNote(db, c.noteId)!.front).toBe('Neu vom Handy');
    expect(repo.getCard(db, c.cardId)!.suspended).toBe(true);
    expect(repo.getModule(db, mod.id)!.examDate).toBe('2026-10-30');
    const [dirtyNotes] = await phone.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM note WHERE dirty = 1');
    expect(dirtyNotes!.n).toBe(0);
  });

  it('Rückgängig auf dem Handy nach bereits erfolgtem Sync', async () => {
    const { db, phone, transport } = await setup();
    await syncStore(phone, transport);
    const c = (await phone.next({})).card!;
    const { revlogId } = await phone.answer(c.cardId, 4, 1000);
    await syncStore(phone, transport);
    await phone.undo(revlogId);
    await syncStore(phone, transport);
    expect(repo.studyRows(db).find((x) => x.cardId === c.cardId)!.state.state).toBe(0);
  });

  it('Löschen auf dem Handy erreicht den Laptop', async () => {
    const { db, phone, transport, tick } = await setup();
    await syncStore(phone, transport);
    tick(60_000);
    const c = (await phone.next({})).card!;
    await phone.deleteNote(c.noteId);
    await syncStore(phone, transport);
    expect(repo.getNote(db, c.noteId)!.deleted).toBe(true);
    expect(repo.getCard(db, c.cardId)!.deleted).toBe(true);
  });

  it('Löschungen auf dem Laptop verschwinden vom Handy', async () => {
    const { db, deck, phone, transport } = await setup();
    await syncStore(phone, transport);
    repo.deleteDeck(db, deck.id);
    await syncStore(phone, transport);
    expect((await phone.overview()).modules[0]!.total).toBe(0);
    expect(await phone.listSlides()).toHaveLength(0);
  });
});
```

Run: `nix develop -c npm test -w @naklearn/server -- sync-e2e`
Expected: FAIL – `syncStore` existiert nicht.

- [ ] **Step 5: Implementierung Sync-Client**

`packages/store/src/sync.ts`:
```ts
import { emptyPush, toCard, toModule, toNote, toRevlog, type SyncPull, type SyncPush, type SyncRequest, type SyncResponse } from '@naklearn/core';
import type { SqlAdapter } from './adapter.ts';
import type { LocalStore } from './store.ts';

export type Transport = (req: SyncRequest) => Promise<SyncResponse>;

async function collectPush(db: SqlAdapter): Promise<SyncPush> {
  return {
    modules: (await db.all('SELECT * FROM module WHERE dirty = 1')).map(toModule),
    notes: (await db.all('SELECT * FROM note WHERE dirty = 1')).map(toNote),
    cards: (await db.all('SELECT * FROM card WHERE dirty = 1')).map(toCard),
    revlog: (await db.all('SELECT * FROM revlog WHERE dirty = 1')).map(toRevlog),
  };
}

/** Dirty-Flags nur löschen, wenn die Zeile seit dem Push nicht erneut geändert wurde. */
async function clearDirty(db: SqlAdapter, push: SyncPush): Promise<void> {
  for (const m of push.modules) await db.run('UPDATE module SET dirty = 0 WHERE id = ? AND updated_at = ?', [m.id, m.updatedAt]);
  for (const n of push.notes) await db.run('UPDATE note SET dirty = 0 WHERE id = ? AND updated_at = ?', [n.id, n.updatedAt]);
  for (const c of push.cards) await db.run('UPDATE card SET dirty = 0 WHERE id = ? AND updated_at = ?', [c.id, c.updatedAt]);
  for (const r of push.revlog) await db.run('UPDATE revlog SET dirty = 0 WHERE id = ?', [r.id]);
}

async function keepLocal(db: SqlAdapter, table: 'module' | 'note' | 'card', id: string, remoteUpdatedAt: number): Promise<boolean> {
  const [r] = await db.all<{ dirty: number; updated_at: number }>(`SELECT dirty, updated_at FROM ${table} WHERE id = ?`, [id]);
  return !!r && r.dirty === 1 && r.updated_at > remoteUpdatedAt;
}

async function applyPull(store: LocalStore, pull: SyncPull): Promise<void> {
  const db = store.db;
  for (const m of pull.modules) {
    if (await keepLocal(db, 'module', m.id, m.updatedAt)) continue;
    await db.run(
      `INSERT INTO module (id, name, language, exam_date, new_per_day, deleted, updated_at, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, language = excluded.language, exam_date = excluded.exam_date,
         new_per_day = excluded.new_per_day, deleted = excluded.deleted, updated_at = excluded.updated_at, dirty = 0`,
      [m.id, m.name, m.language, m.examDate, m.newPerDay, m.deleted ? 1 : 0, m.updatedAt],
    );
  }
  for (const d of pull.decks) {
    await db.run(
      `INSERT INTO deck (id, module_id, title, pdf_sha256, page_count, status, error, summary, position, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, title = excluded.title, page_count = excluded.page_count,
         status = excluded.status, error = excluded.error, summary = excluded.summary, position = excluded.position,
         deleted = excluded.deleted, updated_at = excluded.updated_at`,
      [d.id, d.moduleId, d.title, d.pdfSha256, d.pageCount, d.status, d.error, d.summary, d.position, d.deleted ? 1 : 0, d.updatedAt],
    );
  }
  for (const s of pull.slides) {
    await db.run(
      "INSERT INTO slide (deck_id, page, text, image) VALUES (?, ?, '', ?) ON CONFLICT(deck_id, page) DO UPDATE SET image = excluded.image",
      [s.deckId, s.page, s.image],
    );
  }
  for (const n of pull.notes) {
    if (await keepLocal(db, 'note', n.id, n.updatedAt)) continue;
    await db.run(
      `INSERT INTO note (id, deck_id, kind, front, back, slide_refs, front_image_page, tags, source, position, deleted, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET deck_id = excluded.deck_id, kind = excluded.kind, front = excluded.front, back = excluded.back,
         slide_refs = excluded.slide_refs, front_image_page = excluded.front_image_page, tags = excluded.tags,
         source = excluded.source, position = excluded.position, deleted = excluded.deleted, updated_at = excluded.updated_at, dirty = 0`,
      [n.id, n.deckId, n.kind, n.front, n.back, JSON.stringify(n.slideRefs), n.frontImagePage, JSON.stringify(n.tags), n.source, n.position, n.deleted ? 1 : 0, n.updatedAt],
    );
  }
  for (const c of pull.cards) {
    if (await keepLocal(db, 'card', c.id, c.updatedAt)) continue;
    await db.run(
      `INSERT INTO card (id, note_id, ordinal, suspended, deleted, updated_at, dirty) VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET suspended = excluded.suspended, deleted = excluded.deleted, updated_at = excluded.updated_at, dirty = 0`,
      [c.id, c.noteId, c.ordinal, c.suspended ? 1 : 0, c.deleted ? 1 : 0, c.updatedAt],
    );
  }
  const touched = new Set<string>();
  for (const r of pull.revlog) {
    await db.run(
      'INSERT OR IGNORE INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, revokes, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [r.id, r.cardId, r.rating, r.reviewedAt, r.durationMs, r.deviceId, r.revokes],
    );
    touched.add(r.cardId);
  }
  for (const id of touched) await store.recompute(id);
}

const count = (p: SyncPull) => p.modules.length + p.decks.length + p.slides.length + p.notes.length + p.cards.length + p.revlog.length;

export async function syncStore(store: LocalStore, transport: Transport): Promise<{ pushed: number; pulled: number; cursor: number }> {
  const db = store.db;
  const firstPush = await collectPush(db);
  const pushed = firstPush.modules.length + firstPush.notes.length + firstPush.cards.length + firstPush.revlog.length;
  let push = firstPush;
  let cursor = Number((await store.getMeta('sync_cursor')) ?? '0');
  let pulled = 0;
  for (;;) {
    const res = await transport({ deviceId: store.deviceId, cursor, push });
    await db.transaction(async () => {
      if (push === firstPush) await clearDirty(db, firstPush);
      await applyPull(store, res.pull);
      await store.setMeta('sync_cursor', String(res.cursor));
    });
    pulled += count(res.pull);
    cursor = res.cursor;
    push = emptyPush();
    if (!res.hasMore) break;
  }
  await store.setMeta('last_sync', String(store.nowMs()));
  return { pushed, pulled, cursor };
}
```

`packages/store/src/index.ts` um `export * from './sync.ts';` ergänzen.

- [ ] **Step 6: Tests laufen lassen**

Run: `nix develop -c npm test`
Expected: PASS (alle Pakete).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(store): offline local store with sync client"
```

---

### Task 5: Handy-Oberfläche (Capacitor-Adapter, Seiten, Sync-Steuerung)

**Files:**
- Create: `apps/client/src/native/{capSqlAdapter.ts,transport.ts,images.ts,controller.ts,NativeApp.tsx,NativeHome.tsx,NativeModule.tsx,NativeSettings.tsx,native.css}`
- Modify: `apps/client/src/main.tsx` (Plattform-Weiche), `apps/client/package.json` (Deps)
- Test: `apps/client/test/controller.test.ts`, `apps/client/test/transport.test.ts`

**Interfaces:**
- Consumes: `LocalStore`, `syncStore`, `Transport`, `SqlAdapter` (Task 4), `StudyView`, `StudyDataSource` (Teil 1), Router (Teil 1).
- Produces:
  - `parsePairing(text: string): { url: string; token: string } | null`
  - `httpTransport(url: string, token: string, fetchImpl?: typeof fetch): Transport`
  - `interface ImageStore { has(deckId: string, page: number): Promise<boolean>; download(url: string, token: string, deckId: string, page: number, image: string): Promise<void>; src(deckId: string, page: number): string }`
  - `interface SyncState { phase: 'idle' | 'syncing' | 'error' | 'unpaired'; message: string | null; lastSync: number | null; imagesMissing: number }`
  - `class SyncController` mit `constructor(store: LocalStore, images: ImageStore, makeTransport?: (url: string, token: string) => Transport)`, `state: SyncState`, `subscribe(fn): () => void`, `pair(url, token): Promise<void>`, `sync(): Promise<void>` (wirft nie), `pairing(): Promise<{ url: string; token: string } | null>`
  - `LocalDataSource` (implements `StudyDataSource`) in `controller.ts`
  - `NativeApp` (Routen `home`, `module`, `study`, `settings`)

- [ ] **Step 1: Abhängigkeiten**

Run:
```bash
nix develop -c npm install -w @naklearn/client @naklearn/store@* @capacitor/core@^8.5.2 @capacitor/android@^8.5.2 @capacitor/app@^8.1.2 @capacitor/filesystem@^8.1.4 @capacitor/file-transfer@^2.0.6 @capacitor-community/sqlite@^8.1.1 @capacitor-mlkit/barcode-scanning@^8.2.1
nix develop -c npm install -w @naklearn/client -D @capacitor/cli@^8.5.2
```
`apps/client/package.json` prüfen (alle Einträge vorhanden; `@naklearn/store` als `"*"`).

- [ ] **Step 2: Failing Tests**

`apps/client/test/transport.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { httpTransport, parsePairing } from '../src/native/transport.ts';

describe('parsePairing', () => {
  it('liest den QR-Inhalt', () => {
    expect(parsePairing('{"v":1,"url":"http://nixos.tail1.ts.net:8742/","token":"abc"}')).toEqual({ url: 'http://nixos.tail1.ts.net:8742', token: 'abc' });
  });
  it.each(['kein json', '{"v":1,"url":"ftp://x","token":"a"}', '{"v":1,"url":"http://x"}'])('lehnt %s ab', (t) => {
    expect(parsePairing(t)).toBeNull();
  });
});

describe('httpTransport', () => {
  it('sendet das Token und meldet 401 verständlich', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}', { status: 401 }));
    const t = httpTransport('http://h:1', 'tok', f as unknown as typeof fetch);
    await expect(t({ deviceId: 'd', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } })).rejects.toThrow('Token ungültig');
    expect(f.mock.calls[0]![0]).toBe('http://h:1/api/sync');
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});
```

`apps/client/test/controller.test.ts`:
```ts
import type { SyncRequest, SyncResponse } from '@naklearn/core';
import { LocalStore, type SqlAdapter } from '@naklearn/store';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SyncController, type ImageStore } from '../src/native/controller.ts';

function nodeAdapter(): SqlAdapter {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    async execute(sql) { db.exec(sql); },
    async run(sql, p = []) { db.prepare(sql).run(...(p as SQLInputValue[])); },
    async all(sql, p = []) { return db.prepare(sql).all(...(p as SQLInputValue[])) as never; },
    async transaction(fn) {
      if (depth) return fn();
      depth++; db.exec('BEGIN');
      try { const r = await fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth--; }
    },
  };
}

function pullWithSlides(n: number): SyncResponse {
  return {
    cursor: 5, hasMore: false,
    pull: {
      modules: [{ id: 'm', name: 'M', language: 'en', examDate: null, newPerDay: 20, deleted: false, updatedAt: 1 }],
      decks: [{ id: 'd', moduleId: 'm', title: 'D', pdfSha256: 's', pageCount: n, status: 'ready', error: null, summary: null, position: 1, deleted: false, updatedAt: 1 }],
      slides: Array.from({ length: n }, (_, i) => ({ deckId: 'd', page: i + 1, image: `${i + 1}.jpg` })),
      notes: [], cards: [], revlog: [],
    },
  };
}

function fakeImages(failPages: number[] = []): ImageStore & { stored: Set<string> } {
  const stored = new Set<string>();
  return {
    stored,
    async has(d, p) { return stored.has(`${d}/${p}`); },
    async download(_u, _t, d, p) {
      if (failPages.includes(p)) throw new Error('abgebrochen');
      stored.add(`${d}/${p}`);
    },
    src: (d, p) => `file://${d}/${p}.jpg`,
  };
}

describe('SyncController', () => {
  it('ist ohne Kopplung im Zustand unpaired und wirft nicht', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const c = new SyncController(store, fakeImages());
    await c.sync();
    expect(c.state.phase).toBe('unpaired');
  });

  it('meldet Netzfehler als Status statt Absturz', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const c = new SyncController(store, fakeImages(), () => async () => { throw new Error('Server nicht erreichbar'); });
    await c.pair('http://h:1', 't');
    expect(c.state).toMatchObject({ phase: 'error', message: 'Server nicht erreichbar' });
  });

  it('lädt nach dem Sync nur fehlende Bilder und holt abgebrochene beim nächsten Mal nach', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const images = fakeImages([2]);
    let call = 0;
    const transport = async (_r: SyncRequest): Promise<SyncResponse> => (call++ === 0 ? pullWithSlides(3) : { ...pullWithSlides(0), pull: { ...pullWithSlides(0).pull, modules: [], decks: [] } });
    const c = new SyncController(store, images, () => transport);
    await c.pair('http://h:1', 't');
    expect(images.stored.size).toBe(2);
    expect(c.state).toMatchObject({ phase: 'idle', imagesMissing: 1 });
    expect(c.state.lastSync).not.toBeNull();
    const retry = new SyncController(store, fakeImages(), () => transport);
    (retry as unknown as { images: ImageStore }).images = { ...images, download: async (_u, _t, d, p) => void images.stored.add(`${d}/${p}`) };
    await retry.sync();
    expect(images.stored.size).toBe(3);
    expect(retry.state.imagesMissing).toBe(0);
  });

  it('merkt sich die Kopplung', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const c = new SyncController(store, fakeImages(), () => async () => pullWithSlides(0));
    await c.pair('http://h:1/', 'tok');
    expect(await c.pairing()).toEqual({ url: 'http://h:1', token: 'tok' });
  });
});
```

Run: `nix develop -c npm test -w @naklearn/client`
Expected: FAIL – Module fehlen.

- [ ] **Step 3: transport.ts und controller.ts**

`apps/client/src/native/transport.ts`:
```ts
import type { Transport } from '@naklearn/store';

export function parsePairing(text: string): { url: string; token: string } | null {
  try {
    const j = JSON.parse(text);
    if (typeof j?.url !== 'string' || typeof j?.token !== 'string' || !/^https?:\/\//.test(j.url) || !j.token) return null;
    return { url: j.url.replace(/\/+$/, ''), token: j.token };
  } catch {
    return null;
  }
}

export function httpTransport(url: string, token: string, fetchImpl: typeof fetch = fetch): Transport {
  return async (req) => {
    const res = await fetchImpl(`${url}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
    });
    if (res.status === 401) throw new Error('Token ungültig – bitte neu koppeln');
    if (!res.ok) throw new Error(`Sync fehlgeschlagen (HTTP ${res.status})`);
    return res.json();
  };
}
```

`apps/client/src/native/controller.ts`:
```ts
import type { Grade, Scope } from '@naklearn/core';
import { syncStore, type LocalStore, type Transport } from '@naklearn/store';
import type { StudyDataSource } from '@naklearn/ui';
import { httpTransport } from './transport.ts';

export interface ImageStore {
  has(deckId: string, page: number): Promise<boolean>;
  download(url: string, token: string, deckId: string, page: number, image: string): Promise<void>;
  src(deckId: string, page: number): string;
}

export interface SyncState {
  phase: 'idle' | 'syncing' | 'error' | 'unpaired';
  message: string | null;
  lastSync: number | null;
  imagesMissing: number;
}

export class SyncController {
  state: SyncState = { phase: 'idle', message: null, lastSync: null, imagesMissing: 0 };
  private store: LocalStore;
  private images: ImageStore;
  private makeTransport: (url: string, token: string) => Transport;
  private listeners = new Set<(s: SyncState) => void>();
  private running: Promise<void> | null = null;

  constructor(store: LocalStore, images: ImageStore, makeTransport: (url: string, token: string) => Transport = httpTransport) {
    this.store = store;
    this.images = images;
    this.makeTransport = makeTransport;
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  async pairing(): Promise<{ url: string; token: string } | null> {
    const url = await this.store.getMeta('server_url');
    const token = await this.store.getMeta('token');
    return url && token ? { url, token } : null;
  }

  async pair(url: string, token: string): Promise<void> {
    await this.store.setMeta('server_url', url.replace(/\/+$/, ''));
    await this.store.setMeta('token', token);
    await this.sync();
  }

  /** Synchronisiert und lädt fehlende Folienbilder; wirft nie, Fehler landen im Status. */
  sync(): Promise<void> {
    if (!this.running) this.running = this.doSync().finally(() => (this.running = null));
    return this.running;
  }

  private async doSync(): Promise<void> {
    const p = await this.pairing();
    const last = await this.store.getMeta('last_sync');
    if (!p) return this.set({ phase: 'unpaired', message: 'Noch nicht mit dem Laptop gekoppelt', lastSync: last ? Number(last) : null });
    this.set({ phase: 'syncing', message: null });
    try {
      await syncStore(this.store, this.makeTransport(p.url, p.token));
      let missing = 0;
      for (const s of await this.store.listSlides()) {
        if (await this.images.has(s.deckId, s.page)) continue;
        try {
          await this.images.download(p.url, p.token, s.deckId, s.page, s.image);
        } catch {
          missing++;
        }
      }
      const at = await this.store.getMeta('last_sync');
      this.set({ phase: 'idle', message: null, lastSync: at ? Number(at) : null, imagesMissing: missing });
    } catch (e) {
      this.set({ phase: 'error', message: String((e as Error).message ?? e) });
    }
  }
}

export class LocalDataSource implements StudyDataSource {
  private store: LocalStore;
  private images: ImageStore;
  constructor(store: LocalStore, images: ImageStore) {
    this.store = store;
    this.images = images;
  }
  next(scope: Scope) { return this.store.next(scope); }
  answer(cardId: string, rating: Grade, durationMs: number) { return this.store.answer(cardId, rating, durationMs); }
  undo(revlogId: string) { return this.store.undo(revlogId); }
  setSuspended(cardId: string, suspended: boolean) { return this.store.setSuspended(cardId, suspended); }
  updateNote(noteId: string, patch: { front: string; back: string }) { return this.store.updateNote(noteId, patch); }
  deleteNote(noteId: string) { return this.store.deleteNote(noteId); }
  slideUrl(deckId: string, page: number) { return this.images.src(deckId, page); }
}
```

Run: `nix develop -c npm test -w @naklearn/client`
Expected: PASS.

- [ ] **Step 4: Capacitor-Adapter (nicht unit-getestet, laufen nur auf dem Gerät)**

`apps/client/src/native/capSqlAdapter.ts`:
```ts
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { SqlAdapter } from '@naklearn/store';

export async function openCapAdapter(name = 'naklearn'): Promise<SqlAdapter> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const exists = (await sqlite.isConnection(name, false)).result;
  const conn = exists
    ? await sqlite.retrieveConnection(name, false)
    : await sqlite.createConnection(name, false, 'no-encryption', 1, false);
  await conn.open();
  let depth = 0;
  return {
    async execute(sql) { await conn.execute(sql, false); },
    async run(sql, params = []) { await conn.run(sql, params as unknown[], false); },
    async all(sql, params = []) { return ((await conn.query(sql, params as unknown[])).values ?? []) as never; },
    async transaction(fn) {
      if (depth > 0) return fn();
      depth++;
      await conn.beginTransaction();
      try {
        const r = await fn();
        await conn.commitTransaction();
        return r;
      } catch (e) {
        await conn.rollbackTransaction();
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
```

`apps/client/src/native/images.ts`:
```ts
import { Capacitor } from '@capacitor/core';
import { FileTransfer } from '@capacitor/file-transfer';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { ImageStore } from './controller.ts';

const rel = (deckId: string, page: number) => `slides/${deckId}/${page}.jpg`;

export async function createImageStore(): Promise<ImageStore> {
  const base = (await Filesystem.getUri({ path: '', directory: Directory.Data })).uri.replace(/\/+$/, '');
  return {
    async has(deckId, page) {
      try {
        await Filesystem.stat({ path: rel(deckId, page), directory: Directory.Data });
        return true;
      } catch {
        return false;
      }
    },
    async download(url, token, deckId, page, image) {
      await Filesystem.mkdir({ path: `slides/${deckId}`, directory: Directory.Data, recursive: true }).catch(() => {});
      await FileTransfer.downloadFile({
        url: `${url}/api/slides/${deckId}/${image}`,
        path: `${base}/${rel(deckId, page)}`,
        headers: { authorization: `Bearer ${token}` },
      });
    },
    src: (deckId, page) => Capacitor.convertFileSrc(`${base}/${rel(deckId, page)}`),
  };
}
```

- [ ] **Step 5: Seiten**

`apps/client/src/native/NativeApp.tsx`:
```tsx
import { App as CapApp } from '@capacitor/app';
import type { LocalStore } from '@naklearn/store';
import { StudyView } from '@naklearn/ui';
import { useEffect, useMemo, useState } from 'react';
import { navigate, useRoute } from '../router.ts';
import { LocalDataSource, type ImageStore, type SyncController, type SyncState } from './controller.ts';
import { NativeHome } from './NativeHome.tsx';
import { NativeModule } from './NativeModule.tsx';
import { NativeSettings } from './NativeSettings.tsx';

export function NativeApp({ store, images, sync }: { store: LocalStore; images: ImageStore; sync: SyncController }) {
  const route = useRoute();
  const [state, setState] = useState<SyncState>(sync.state);
  const [version, setVersion] = useState(0);
  const source = useMemo(() => new LocalDataSource(store, images), [store, images]);

  useEffect(() => sync.subscribe((s) => {
    setState(s);
    if (s.phase === 'idle') setVersion((v) => v + 1);
  }), [sync]);

  useEffect(() => {
    void sync.sync();
    const timer = setInterval(() => void sync.sync(), 5 * 60_000);
    const resume = CapApp.addListener('resume', () => void sync.sync());
    const back = CapApp.addListener('backButton', () => {
      if (window.location.hash && window.location.hash !== '#/') window.history.back();
      else void CapApp.exitApp();
    });
    return () => {
      clearInterval(timer);
      void resume.then((h) => h.remove());
      void back.then((h) => h.remove());
    };
  }, [sync]);

  switch (route.name) {
    case 'module':
      return <NativeModule key={version} store={store} id={route.params.id!} />;
    case 'settings':
      return <NativeSettings store={store} sync={sync} state={state} />;
    case 'study':
      return (
        <StudyView
          source={source}
          scope={{ moduleId: route.params.moduleId, deckId: route.params.deckId }}
          title={route.params.title ?? 'Lernen'}
          onExit={() => {
            void sync.sync();
            if (route.params.moduleId) navigate('module', { id: route.params.moduleId });
            else navigate('home');
          }}
        />
      );
    default:
      return <NativeHome key={version} store={store} sync={sync} state={state} />;
  }
}
```

`apps/client/src/native/NativeHome.tsx`:
```tsx
import type { LocalStore, StoreOverview } from '@naklearn/store';
import { useEffect, useState } from 'react';
import { href, navigate } from '../router.ts';
import type { SyncController, SyncState } from './controller.ts';

export function syncLabel(s: SyncState, now = Date.now()): string {
  if (s.phase === 'syncing') return 'Synchronisiere …';
  if (s.phase === 'unpaired') return 'Nicht gekoppelt – Einstellungen öffnen';
  const ago = s.lastSync ? Math.round((now - s.lastSync) / 60_000) : null;
  const when = ago === null ? 'noch nie' : ago < 1 ? 'gerade eben' : ago < 60 ? `vor ${ago} min` : `vor ${Math.round(ago / 60)} h`;
  const base = `Zuletzt synchronisiert: ${when}`;
  if (s.phase === 'error') return `${base} · ${s.message}`;
  return s.imagesMissing ? `${base} · ${s.imagesMissing} Folienbilder fehlen noch` : base;
}

export function NativeHome({ store, sync, state }: { store: LocalStore; sync: SyncController; state: SyncState }) {
  const [ov, setOv] = useState<StoreOverview | null>(null);
  useEffect(() => {
    void store.overview().then(setOv);
  }, [store]);
  const due = ov?.modules.reduce((s, m) => s + m.dueToday, 0) ?? 0;
  return (
    <main className="page native">
      <header className="topbar">
        <h1>NAKLearn</h1>
        <a href={href('settings')} aria-label="Einstellungen">⚙</a>
      </header>
      <button className={`sync-status ${state.phase}`} onClick={() => (state.phase === 'unpaired' ? navigate('settings') : void sync.sync())}>
        {syncLabel(state)}
      </button>
      {ov && <p className="muted">Heute gelernt: {ov.studiedToday} · Serie: {ov.streak} {ov.streak === 1 ? 'Tag' : 'Tage'}</p>}
      <button className="primary big full" disabled={due === 0} onClick={() => navigate('study', { title: 'Heute' })}>
        Heute lernen · {due} Karten
      </button>
      <section className="grid">
        {ov?.modules.map((m) => (
          <a key={m.moduleId} className="tile" href={href('module', { id: m.moduleId })}>
            <div className="tile-head"><strong>{m.name}</strong><span className="muted small">{m.dueToday} fällig</span></div>
            <div className="counts">
              <span className="count-new">{m.new} neu</span>
              <span className="count-learning">{m.learning} lernend</span>
              <span className="count-review">{m.review} wdh.</span>
            </div>
            <div className="progress"><div style={{ width: `${m.seenPct}%` }} /></div>
            <div className="muted small">
              {m.seenPct}% gesehen{m.daysToExam !== null && <> · Prüfung in {m.daysToExam} {m.daysToExam === 1 ? 'Tag' : 'Tagen'}</>}
            </div>
            {m.warn && <div className="warn small">⚠ {m.newTarget} neue Karten/Tag nötig</div>}
          </a>
        ))}
      </section>
      {ov && ov.modules.length === 0 && <p className="muted">Noch keine Karten. Koppeln und synchronisieren, um loszulegen.</p>}
    </main>
  );
}
```

`apps/client/src/native/NativeModule.tsx`:
```tsx
import type { Deck, Module } from '@naklearn/core';
import type { LocalStore } from '@naklearn/store';
import { useEffect, useState } from 'react';
import { href, navigate } from '../router.ts';

export function NativeModule({ store, id }: { store: LocalStore; id: string }) {
  const [data, setData] = useState<{ module: Module; decks: (Deck & { noteCount: number })[] } | null>(null);
  const [examDate, setExamDate] = useState('');
  const [newPerDay, setNewPerDay] = useState(20);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void store.moduleDetail(id).then((d) => {
      setData(d);
      if (d) {
        setExamDate(d.module.examDate ?? '');
        setNewPerDay(d.module.newPerDay);
      }
    });
  }, [store, id]);
  if (!data) return <main className="page native"><a href={href('home')}>← Übersicht</a></main>;
  return (
    <main className="page native">
      <header className="topbar">
        <a href={href('home')}>←</a>
        <h1>{data.module.name}</h1>
      </header>
      <button className="primary big full" onClick={() => navigate('study', { moduleId: id, title: data.module.name })}>Modul lernen</button>
      <section>
        <h2>Foliensätze</h2>
        {data.decks.map((d) => (
          <button key={d.id} className="deck-row" disabled={d.noteCount === 0} onClick={() => navigate('study', { moduleId: id, deckId: d.id, title: d.title })}>
            <span>{d.title}</span>
            <span className="muted small">{d.noteCount} Karten</span>
          </button>
        ))}
      </section>
      <section className="card-form">
        <h2>Einstellungen</h2>
        <label>Prüfungsdatum <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} /></label>
        <label>Neue Karten pro Tag <input type="number" min={0} max={500} value={newPerDay} onChange={(e) => setNewPerDay(Number(e.target.value))} /></label>
        <button
          className="primary"
          onClick={async () => {
            await store.updateModule(id, { examDate: examDate || null, newPerDay });
            setMsg('Gespeichert – wird beim nächsten Sync übertragen.');
          }}
        >
          Speichern
        </button>
        {msg && <p className="info small">{msg}</p>}
      </section>
    </main>
  );
}
```

`apps/client/src/native/NativeSettings.tsx`:
```tsx
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import type { LocalStore } from '@naklearn/store';
import { useEffect, useState } from 'react';
import { href } from '../router.ts';
import { syncLabel } from './NativeHome.tsx';
import type { SyncController, SyncState } from './controller.ts';
import { parsePairing } from './transport.ts';

export function NativeSettings({ store, sync, state }: { store: LocalStore; sync: SyncController; state: SyncState }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void sync.pairing().then((p) => {
      if (p) {
        setUrl(p.url);
        setToken(p.token);
      }
    });
  }, [sync]);

  async function scan() {
    setMsg(null);
    try {
      const avail = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!avail.available) {
        setMsg('QR-Scanner wird installiert … bitte gleich nochmal tippen.');
        await BarcodeScanner.installGoogleBarcodeScannerModule();
        return;
      }
      const { barcodes } = await BarcodeScanner.scan();
      const p = barcodes[0] ? parsePairing(barcodes[0].rawValue) : null;
      if (!p) return setMsg('Kein gültiger NAKLearn-QR-Code.');
      setUrl(p.url);
      setToken(p.token);
      await sync.pair(p.url, p.token);
      setMsg('Gekoppelt.');
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  }

  return (
    <main className="page native">
      <header className="topbar">
        <a href={href('home')}>←</a>
        <h1>Einstellungen</h1>
      </header>
      <p className={`sync-status ${state.phase}`}>{syncLabel(state)}</p>
      <section className="card-form">
        <h2>Mit dem Laptop koppeln</h2>
        <p className="muted small">Am Laptop: Studio → „Handy koppeln“. Tailscale muss auf beiden Geräten laufen.</p>
        <button className="primary full" onClick={scan}>QR-Code scannen</button>
        <label>Server-Adresse <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://laptop.tailXXXX.ts.net:8742" /></label>
        <label>Token <input value={token} onChange={(e) => setToken(e.target.value)} /></label>
        <button
          onClick={async () => {
            if (!/^https?:\/\//.test(url) || !token) return setMsg('Adresse und Token angeben.');
            await sync.pair(url, token);
            setMsg(sync.state.phase === 'error' ? sync.state.message : 'Gekoppelt.');
          }}
        >
          Manuell koppeln
        </button>
        {msg && <p className="info small">{msg}</p>}
      </section>
      <section className="card-form">
        <button className="full" onClick={() => void sync.sync()} disabled={state.phase === 'syncing'}>Jetzt synchronisieren</button>
        <p className="muted small">Geräte-ID: {store.deviceId}</p>
      </section>
    </main>
  );
}
```

`apps/client/src/native/native.css`:
```css
.native { padding-top: calc(12px + env(safe-area-inset-top)); }
.full { width: 100%; }
.sync-status { display: block; width: 100%; text-align: left; font-size: 0.85rem; color: var(--muted); background: none; border: none; padding: 4px 0 10px; }
.sync-status.error { color: var(--again); }
.sync-status.unpaired { color: var(--hard); }
.native .grid { margin-top: 16px; }
.deck-row { display: flex; justify-content: space-between; width: 100%; padding: 12px; margin-bottom: 8px; text-align: left; }
.native .card-form label { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; color: var(--muted); font-size: 0.85rem; }
```

`apps/client/src/router.ts`: `RouteName` um `'settings'` erweitern; `parseRoute`: `if (seg[0] === 'settings') return { name: 'settings', params: {} };`; `href`: `if (name === 'settings') return '#/settings';`. Router-Test um `['#/settings', { name: 'settings', params: {} }]` ergänzen.

`apps/client/src/main.tsx` – Plattform-Weiche (Studio bleibt unverändert, Handy-Code wird nur nativ geladen):
```tsx
import '@naklearn/ui/study.css';
import './styles.css';
import { Capacitor } from '@capacitor/core';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
// … bestehende Page-Imports und App() bleiben …

async function boot(): Promise<ReactNode> {
  if (!Capacitor.isNativePlatform()) return <App />;
  await import('./native/native.css');
  const [{ openCapAdapter }, { createImageStore }, { LocalStore }, { SyncController }, { NativeApp }] = await Promise.all([
    import('./native/capSqlAdapter.ts'),
    import('./native/images.ts'),
    import('@naklearn/store'),
    import('./native/controller.ts'),
    import('./native/NativeApp.tsx'),
  ]);
  const store = await LocalStore.open(await openCapAdapter());
  const images = await createImageStore();
  const sync = new SyncController(store, images);
  return <NativeApp store={store} images={images} sync={sync} />;
}

const root = createRoot(document.getElementById('root')!);
boot().then(
  (ui) => root.render(<StrictMode>{ui}</StrictMode>),
  (e) => root.render(<pre className="error">Start fehlgeschlagen: {String(e?.message ?? e)}</pre>),
);
```
(Die bisherige direkte `createRoot(...).render(<StrictMode><App /></StrictMode>)`-Zeile entfällt.)

- [ ] **Step 6: Tests, Typecheck, Build**

Run:
```bash
nix develop -c npm test
nix develop -c npm run typecheck
nix develop -c npm run build
```
Expected: alles grün; Web-Build enthält die Handy-Teile nur als separate Chunks.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(client): offline phone UI with local store, sync controller and pairing"
```

---

### Task 6: Capacitor-Android-Projekt und APK-Build

**Files:**
- Create: `apps/client/capacitor.config.ts`, `apps/client/android/**` (generiert), `apps/client/android/app/src/main/res/xml/network_security_config.xml`
- Modify: `apps/client/android/app/src/main/AndroidManifest.xml`, `apps/client/package.json` (Skripte), `package.json` (Root-Skript), `flake.nix` (devShell)

- [ ] **Step 1: devShell erweitern**

In `flake.nix` die devShell ersetzen:
```nix
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nodejs_24 pkgs.poppler-utils pkgs.prefetch-npm-deps pkgs.jdk21 ];
        shellHook = ''
          export JAVA_HOME=${pkgs.jdk21.home}
          export ANDROID_HOME=$HOME/Android/Sdk
          export ANDROID_SDK_ROOT=$ANDROID_HOME
          export PATH=$ANDROID_HOME/platform-tools:$PATH
        '';
      };
```
Run: `git add -A && nix develop -c bash -c 'java -version 2>&1 | head -1; echo $ANDROID_HOME; adb version | head -1'`
Expected: OpenJDK 21, `/home/luna/Android/Sdk`, adb-Version.

- [ ] **Step 2: Capacitor konfigurieren und Plattform anlegen**

`apps/client/capacitor.config.ts`:
```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.luna.naklearn',
  appName: 'NAKLearn',
  webDir: 'dist',
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};

export default config;
```

`apps/client/package.json` Skripte ergänzen:
```json
    "android:sync": "vite build && cap sync android",
    "android:build": "npm run android:sync && cd android && ./gradlew assembleDebug --no-daemon",
    "android:install": "adb install -r android/app/build/outputs/apk/debug/app-debug.apk"
```
Root-`package.json` Skripte ergänzen:
```json
    "android:build": "npm run android:build -w @naklearn/client",
    "android:install": "npm run android:install -w @naklearn/client"
```

Run: `cd apps/client && nix develop ../.. -c npx cap add android`
Expected: `[success] android platform added!`, Ordner `apps/client/android`.

- [ ] **Step 3: Cleartext nur für Tailscale/Emulator**

`apps/client/android/app/src/main/res/xml/network_security_config.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">ts.net</domain>
        <domain includeSubdomains="false">10.0.2.2</domain>
    </domain-config>
</network-security-config>
```
In `apps/client/android/app/src/main/AndroidManifest.xml` im `<application …>`-Tag das Attribut `android:networkSecurityConfig="@xml/network_security_config"` ergänzen.

- [ ] **Step 4: APK bauen**

Run: `nix develop -c npm run android:build 2>&1 | tail -5 && ls -la apps/client/android/app/build/outputs/apk/debug/`
Expected: `BUILD SUCCESSFUL`, `app-debug.apk` vorhanden.

- [ ] **Step 5: Emulator-Rauchtest**

Run (Emulator headless starten, App installieren und starten, Logcat auf Startfehler prüfen):
```bash
nix develop -c bash -c '
  $ANDROID_HOME/emulator/emulator -list-avds
'
```
Falls ein AVD existiert (sonst mit `avdmanager` aus Android Studio anlegen oder diesen Schritt mit Ruling überspringen und direkt auf dem Handy testen):
```bash
nix develop -c bash -c '
  ($ANDROID_HOME/emulator/emulator -avd <AVD> -no-window -no-audio -no-snapshot &) ; adb wait-for-device
  until adb shell getprop sys.boot_completed | grep -q 1; do sleep 2; done
  npm run android:install && adb shell monkey -p de.luna.naklearn 1 && sleep 8
  adb logcat -d | grep -iE "Capacitor|chromium|naklearn" | grep -iE "error|exception|Start fehlgeschlagen" | head -20
'
```
Expected: keine Fehlerzeilen; `adb exec-out screencap -p > /tmp/naklearn.png` zeigt „NAKLearn“ mit „Nicht gekoppelt – Einstellungen öffnen“.
Kopplung im Emulator testen: Server mit `NAKLEARN_PUBLIC_URL=http://10.0.2.2:8742` lokal starten oder in der App manuell `http://10.0.2.2:8742` + Token aus `~/.local/share/naklearn/config.json` eintragen → Sync → Module erscheinen.

- [ ] **Step 6: Commit**

`apps/client/android` wird mitcommittet (Capacitor legt eigene `.gitignore` für Build-Ordner an).
```bash
git add -A
git commit -m "build: capacitor android project and apk build"
```

---

### Task 7: Tailscale und Firewall (Dotfiles), Abnahme auf dem Handy

**Files:**
- Modify: `~/nixos/dotfiles/modules/networking.nix`

- [ ] **Step 1: NixOS-Konfiguration**

In `~/nixos/dotfiles/modules/networking.nix` nach `networking.networkmanager.enable = true;` ergänzen:
```nix
  services.tailscale.enable = true;
  # NAKLearn-Server nur über Tailscale erreichbar
  networking.firewall.interfaces.tailscale0.allowedTCPPorts = [ 8742 ];
```
Außerdem in den Dotfiles `nix flake update naklearn` (neuer Stand mit Sync-Endpoint).
Run: `cd ~/nixos/dotfiles && git add -A && nixos-rebuild build --flake .#nixos`
Expected: Build erfolgreich.

- [ ] **Step 2: Übergabe an Luna (braucht sudo und Handy)**

Luna führt aus:
1. `rebuild "NAKLearn sync + tailscale"`
2. `sudo tailscale up` → Login-Link öffnen, anmelden.
3. Tailscale-App auf dem Handy installieren, mit demselben Account anmelden.
4. Auf dem Handy „USB-Debugging“ aktivieren, per USB verbinden, dann `cd ~/projects/naklearn && nix develop -c npm run android:install`.

Prüfen (Claude): `tailscale status` zeigt Laptop + Handy; `curl -s http://$(tailscale status --json | node -pe 'JSON.parse(require("fs").readFileSync(0)).Self.DNSName.replace(/\.$/,"")'):8742/api/overview` → 401 (Token nötig = Firewall offen, Auth aktiv).

- [ ] **Step 3: Abnahme**

1. Studio → „Handy koppeln“ zeigt QR-Code mit `…ts.net:8742`.
2. App → Einstellungen → „QR-Code scannen“ → „Gekoppelt“, Status „Zuletzt synchronisiert: gerade eben“; Übersicht zeigt beide Module mit Karten; Folienbilder erscheinen beim Lernen.
3. Flugmodus an → 5 Karten lernen (inkl. Rückgängig, Bearbeiten einer Karte) → App funktioniert vollständig.
4. Flugmodus aus → App in den Vordergrund → Sync; im Studio zeigt „Heute gelernt“ dieselbe Zahl, die bearbeitete Karte ist geändert.
5. Am Laptop eine Karte lernen → am Handy synchronisieren → Zähler stimmen überein.

Gefundene Fehler: mit Test im betroffenen Paket beheben, neue APK bauen und installieren.
