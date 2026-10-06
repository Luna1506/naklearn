import {
  SYNC_PAGE_SIZE, clozeOrdinals, newId, toCard, toDeck, toModule, toNote, toRevlog, toSlideRow,
  type SyncPull, type SyncPush, type SyncResponse,
} from '@naklearn/core';
import { tx, type Db } from './db.ts';
import { insertRevlog, nextSeq } from './repo.ts';
import { recomputeCard } from './study.ts';

type Row = Record<string, any>;

function current(db: Db, table: 'module' | 'note' | 'card', id: string): { updated_at: number; deleted: number } | undefined {
  return db.prepare(`SELECT updated_at, deleted FROM ${table} WHERE id = ?`).get(id) as { updated_at: number; deleted: number } | undefined;
}

/** Neue seq für die Server-Version, damit das Gerät sie beim nächsten Pull bekommt. */
function bump(db: Db, table: 'module' | 'note' | 'card', id: string): void {
  db.prepare(`UPDATE ${table} SET seq = ? WHERE id = ?`).run(nextSeq(db), id);
}

/**
 * Bringt die Karten einer Notiz in Einklang mit ihrem (gewinnenden) Inhalt: genau eine lebende Karte
 * pro gültiger Lücke (ältere Karte bevorzugt), alles andere gelöscht; fehlende Lücken bekommen eine Karte.
 */
function reconcileCards(db: Db, noteId: string): void {
  const note = db.prepare('SELECT kind, front, deleted FROM note WHERE id = ?').get(noteId) as Row | undefined;
  if (!note) return;
  const ords = note.deleted ? [] : note.kind === 'cloze' ? clozeOrdinals(note.front) : [0];
  const cards = db.prepare('SELECT id, ordinal, deleted, updated_at FROM card WHERE note_id = ? ORDER BY rowid').all(noteId) as Row[];
  const keep = new Set<string>();
  for (const o of ords) {
    const same = cards.filter((c) => c.ordinal === o);
    const chosen = same.find((c) => !c.deleted) ?? same[0];
    if (chosen) keep.add(chosen.id);
    else db.prepare('INSERT INTO card (id, note_id, ordinal, updated_at, seq) VALUES (?, ?, ?, ?, ?)').run(newId(), noteId, o, Date.now(), nextSeq(db));
  }
  for (const c of cards) {
    const live = keep.has(c.id);
    if (live === !c.deleted) continue;
    db.prepare('UPDATE card SET deleted = ?, updated_at = ?, seq = ? WHERE id = ?')
      .run(live ? 0 : 1, Math.max(Date.now(), c.updated_at + 1), nextSeq(db), c.id);
  }
}

/**
 * Übernimmt Änderungen eines Geräts: Bewertungen idempotent, sonst Last-Writer-Wins pro Zeile.
 * Löschungen auf dem Server bleiben bestehen; abgelehnte Zeilen werden neu nummeriert, damit das Gerät
 * die gewinnende Version zieht; Lücken-Karten werden danach an die gewinnende Notiz angeglichen.
 */
export function applyPush(db: Db, push: SyncPush): void {
  tx(db, () => {
    const touchedNotes = new Set<string>();
    for (const m of push.modules) {
      const cur = current(db, 'module', m.id);
      if (!cur) continue;
      if ((cur.deleted && !m.deleted) || m.updatedAt <= cur.updated_at) {
        bump(db, 'module', m.id);
        continue;
      }
      db.prepare('UPDATE module SET name = ?, language = ?, exam_date = ?, new_per_day = ?, deleted = ?, updated_at = ?, seq = ? WHERE id = ?')
        .run(m.name, m.language, m.examDate, m.newPerDay, m.deleted ? 1 : 0, m.updatedAt, nextSeq(db), m.id);
    }
    for (const n of push.notes) {
      const cur = current(db, 'note', n.id);
      if (!cur) continue;
      touchedNotes.add(n.id);
      if ((cur.deleted && !n.deleted) || n.updatedAt <= cur.updated_at) {
        bump(db, 'note', n.id);
        continue;
      }
      db.prepare('UPDATE note SET front = ?, back = ?, tags = ?, deleted = ?, updated_at = ?, seq = ? WHERE id = ?')
        .run(n.front, n.back, JSON.stringify(n.tags), n.deleted ? 1 : 0, n.updatedAt, nextSeq(db), n.id);
    }
    for (const c of push.cards) {
      const cur = current(db, 'card', c.id);
      if (cur) {
        if (c.updatedAt <= cur.updated_at) bump(db, 'card', c.id);
        else {
          db.prepare('UPDATE card SET suspended = ?, deleted = ?, updated_at = ?, seq = ? WHERE id = ?')
            .run(c.suspended ? 1 : 0, c.deleted ? 1 : 0, c.updatedAt, nextSeq(db), c.id);
        }
        touchedNotes.add(c.noteId);
      } else if (db.prepare('SELECT 1 FROM note WHERE id = ?').get(c.noteId)) {
        db.prepare('INSERT INTO card (id, note_id, ordinal, suspended, deleted, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(c.id, c.noteId, c.ordinal, c.suspended ? 1 : 0, c.deleted ? 1 : 0, c.updatedAt, nextSeq(db));
        touchedNotes.add(c.noteId);
      }
    }
    for (const id of touchedNotes) reconcileCards(db, id);
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
