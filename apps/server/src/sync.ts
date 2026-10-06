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
