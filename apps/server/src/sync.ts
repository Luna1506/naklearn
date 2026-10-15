import {
  SYNC_PAGE_SIZE, clozeOrdinals, newId, toCard, toDeck, toModule, toNote, toRevlog, toSlideRow,
  type SyncPull, type SyncPush, type SyncResponse,
} from '@naklearn/core';
import { tx, type Db } from './db.ts';
import {
  deleteModule, getMyModule, insertRevlog, leaveModule, memberIds, nextSeq, revlogOwner, setCardFlag, updateMembership,
} from './repo.ts';
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
export function applyPush(db: Db, userId: string, push: SyncPush): void {
  tx(db, () => {
    const touchedNotes = new Set<string>();
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
      if (!mine) { bump(db, 'module', m.id); continue; }
      // Gemeinsame Felder (Name, Sprache) schreibt nie ein Gerät; nur die persönliche Mitgliedschaft (LWW).
      const ms = db.prepare('SELECT updated_at FROM membership WHERE user_id = ? AND module_id = ?').get(userId, m.id) as { updated_at: number };
      // Abgelehnt: neue seq, damit das Gerät die maßgebliche Version zieht.
      if (m.updatedAt > ms.updated_at) updateMembership(db, userId, m.id, { examDate: m.examDate, newPerDay: m.newPerDay }, m.updatedAt);
      else bump(db, 'module', m.id);
    }
    for (const n of push.notes) {
      const cur = current(db, 'note', n.id);
      if (!cur) continue;
      touchedNotes.add(n.id);
      if ((cur.deleted && !n.deleted) || n.updatedAt <= cur.updated_at) {
        bump(db, 'note', n.id);
        continue;
      }
      // Übersetzungen schreibt nur der Server; geänderter Text macht sie ungültig.
      db.prepare(`UPDATE note SET front_de = CASE WHEN front = ? AND back = ? THEN front_de END,
        back_de = CASE WHEN front = ? AND back = ? THEN back_de END,
        front = ?, back = ?, tags = ?, deleted = ?, updated_at = ?, seq = ? WHERE id = ?`)
        .run(n.front, n.back, n.front, n.back, n.front, n.back, JSON.stringify(n.tags), n.deleted ? 1 : 0, n.updatedAt, nextSeq(db), n.id);
    }
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
    for (const id of touchedNotes) reconcileCards(db, id);
    const touched = new Set<string>();
    for (const r of push.revlog) {
      // Nur eigene Bewertungen lassen sich zurücknehmen.
      if (r.revokes !== null && revlogOwner(db, r.revokes) !== userId) continue;
      insertRevlog(db, r, userId);
      touched.add(r.cardId);
    }
    for (const id of touched) recomputeCard(db, userId, id);
  });
}

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
