import {
  clozeOrdinals, emptyState, newId,
  type Card, type CardState, type Deck, type DeckStatus, type Language, type Module, type Note,
  type NoteKind, type NoteSource, type QueueCard, type RevlogEntry, type Slide,
} from '@kartei/core';
import { tx, type Db } from './db.ts';

// node:sqlite liefert Zeilen als untypisierte Objekte.
type Row = Record<string, any>;

export function nextSeq(db: Db): number {
  const r = db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'seq' RETURNING value").get() as Row;
  return Number(r.value);
}

// ---------- Module ----------

const toModule = (r: Row): Module => ({
  id: r.id, name: r.name, language: r.language, examDate: r.exam_date ?? null,
  newPerDay: r.new_per_day, deleted: !!r.deleted, updatedAt: r.updated_at,
});

export function getModule(db: Db, id: string): Module | undefined {
  const r = db.prepare('SELECT * FROM module WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
  return r && toModule(r);
}

export function listModules(db: Db): Module[] {
  return (db.prepare('SELECT * FROM module WHERE deleted = 0 ORDER BY name').all() as Row[]).map(toModule);
}

export function createModule(
  db: Db,
  input: { name: string; language: Language; examDate?: string | null; newPerDay?: number },
  now = Date.now(),
): Module {
  const id = newId();
  db.prepare(
    'INSERT INTO module (id, name, language, exam_date, new_per_day, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, input.name, input.language, input.examDate ?? null, input.newPerDay ?? 20, now, nextSeq(db));
  return getModule(db, id)!;
}

export function updateModule(
  db: Db,
  id: string,
  patch: Partial<Pick<Module, 'name' | 'language' | 'examDate' | 'newPerDay'>>,
  now = Date.now(),
): Module {
  const cur = getModule(db, id);
  if (!cur) throw new Error(`Modul ${id} nicht gefunden`);
  const next = { ...cur, ...patch };
  db.prepare(
    'UPDATE module SET name = ?, language = ?, exam_date = ?, new_per_day = ?, updated_at = ?, seq = ? WHERE id = ?',
  ).run(next.name, next.language, next.examDate, next.newPerDay, now, nextSeq(db), id);
  return getModule(db, id)!;
}

export function deleteModule(db: Db, id: string, now = Date.now()): void {
  db.prepare('UPDATE module SET deleted = 1, updated_at = ?, seq = ? WHERE id = ?').run(now, nextSeq(db), id);
}

// ---------- Decks ----------

const toDeck = (r: Row): Deck => ({
  id: r.id, moduleId: r.module_id, title: r.title, pdfSha256: r.pdf_sha256, pageCount: r.page_count,
  status: r.status, error: r.error ?? null, position: r.position, deleted: !!r.deleted, updatedAt: r.updated_at,
});

export function getDeck(db: Db, id: string): Deck | undefined {
  const r = db.prepare('SELECT * FROM deck WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
  return r && toDeck(r);
}

export function listDecks(db: Db, moduleId: string): Deck[] {
  return (db.prepare('SELECT * FROM deck WHERE module_id = ? AND deleted = 0 ORDER BY position').all(moduleId) as Row[]).map(toDeck);
}

export function findDeckBySha(db: Db, moduleId: string, sha: string): Deck | undefined {
  const r = db.prepare('SELECT * FROM deck WHERE module_id = ? AND pdf_sha256 = ? AND deleted = 0').get(moduleId, sha) as Row | undefined;
  return r && toDeck(r);
}

export function createDeck(db: Db, input: { moduleId: string; title: string; pdfSha256: string }, now = Date.now()): Deck {
  const id = newId();
  const { pos } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM deck WHERE module_id = ?').get(input.moduleId) as Row;
  db.prepare(
    "INSERT INTO deck (id, module_id, title, pdf_sha256, status, position, updated_at, seq) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
  ).run(id, input.moduleId, input.title, input.pdfSha256, pos, now, nextSeq(db));
  return getDeck(db, id)!;
}

export function updateDeck(
  db: Db,
  id: string,
  patch: Partial<{ title: string; status: DeckStatus; error: string | null; pageCount: number }>,
  now = Date.now(),
): Deck {
  const cur = getDeck(db, id);
  if (!cur) throw new Error(`Foliensatz ${id} nicht gefunden`);
  const next = { ...cur, ...patch };
  db.prepare(
    'UPDATE deck SET title = ?, status = ?, error = ?, page_count = ?, updated_at = ?, seq = ? WHERE id = ?',
  ).run(next.title, next.status, next.error, next.pageCount, now, nextSeq(db), id);
  return getDeck(db, id)!;
}

export function deleteDeck(db: Db, id: string, now = Date.now()): void {
  db.prepare('UPDATE deck SET deleted = 1, updated_at = ?, seq = ? WHERE id = ?').run(now, nextSeq(db), id);
}

// ---------- Folien ----------

export function replaceSlides(db: Db, deckId: string, slides: Slide[]): void {
  tx(db, () => {
    db.prepare('DELETE FROM slide WHERE deck_id = ?').run(deckId);
    const ins = db.prepare('INSERT INTO slide (deck_id, page, text, image, seq) VALUES (?, ?, ?, ?, ?)');
    for (const s of slides) ins.run(deckId, s.page, s.text, s.image, nextSeq(db));
  });
}

export function listSlides(db: Db, deckId: string): Slide[] {
  return (db.prepare('SELECT * FROM slide WHERE deck_id = ? ORDER BY page').all(deckId) as Row[]).map((r) => ({
    deckId: r.deck_id, page: r.page, text: r.text, image: r.image,
  }));
}

// ---------- Notes und Karten ----------

export interface NewNote {
  deckId: string;
  kind: NoteKind;
  front: string;
  back: string;
  slideRefs: number[];
  frontImagePage: number | null;
  tags: string[];
  source: NoteSource;
  position: number;
}

const toNote = (r: Row): Note => ({
  id: r.id, deckId: r.deck_id, kind: r.kind, front: r.front, back: r.back,
  slideRefs: JSON.parse(r.slide_refs), frontImagePage: r.front_image_page ?? null, tags: JSON.parse(r.tags),
  source: r.source, position: r.position, deleted: !!r.deleted, updatedAt: r.updated_at,
});

const toCard = (r: Row): Card => ({
  id: r.id, noteId: r.note_id, ordinal: r.ordinal, suspended: !!r.suspended, deleted: !!r.deleted, updatedAt: r.updated_at,
});

function ordinalsFor(kind: NoteKind, front: string): number[] {
  if (kind !== 'cloze') return [0];
  const ords = clozeOrdinals(front);
  if (ords.length === 0) throw new Error('Lückentext ohne Lücke ({{c1::…}})');
  return ords;
}

export function getNote(db: Db, id: string): Note | undefined {
  const r = db.prepare('SELECT * FROM note WHERE id = ?').get(id) as Row | undefined;
  return r && toNote(r);
}

export function listCardsOfNote(db: Db, noteId: string): Card[] {
  return (db.prepare('SELECT * FROM card WHERE note_id = ? ORDER BY ordinal').all(noteId) as Row[]).map(toCard);
}

export function getCard(db: Db, id: string): Card | undefined {
  const r = db.prepare('SELECT * FROM card WHERE id = ?').get(id) as Row | undefined;
  return r && toCard(r);
}

export function insertNote(db: Db, input: NewNote, now = Date.now()): { note: Note; cards: Card[] } {
  const ords = ordinalsFor(input.kind, input.front);
  return tx(db, () => {
    const id = newId();
    db.prepare(
      `INSERT INTO note (id, deck_id, kind, front, back, slide_refs, front_image_page, tags, source, position, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.deckId, input.kind, input.front, input.back, JSON.stringify(input.slideRefs),
      input.frontImagePage, JSON.stringify(input.tags), input.source, input.position, now, nextSeq(db));
    const ins = db.prepare('INSERT INTO card (id, note_id, ordinal, updated_at, seq) VALUES (?, ?, ?, ?, ?)');
    for (const o of ords) ins.run(newId(), id, o, now, nextSeq(db));
    return { note: getNote(db, id)!, cards: listCardsOfNote(db, id) };
  });
}

export function updateNote(
  db: Db,
  id: string,
  patch: { front?: string; back?: string; tags?: string[] },
  now = Date.now(),
): { note: Note; cards: Card[] } {
  const cur = getNote(db, id);
  if (!cur) throw new Error(`Note ${id} nicht gefunden`);
  const next = { ...cur, ...patch };
  const ords = ordinalsFor(next.kind, next.front);
  return tx(db, () => {
    db.prepare('UPDATE note SET front = ?, back = ?, tags = ?, updated_at = ?, seq = ? WHERE id = ?')
      .run(next.front, next.back, JSON.stringify(next.tags), now, nextSeq(db), id);
    const existing = listCardsOfNote(db, id);
    for (const c of existing) {
      const shouldLive = ords.includes(c.ordinal);
      if (shouldLive === c.deleted) {
        db.prepare('UPDATE card SET deleted = ?, updated_at = ?, seq = ? WHERE id = ?').run(shouldLive ? 0 : 1, now, nextSeq(db), c.id);
      }
    }
    for (const o of ords) {
      if (!existing.some((c) => c.ordinal === o)) {
        db.prepare('INSERT INTO card (id, note_id, ordinal, updated_at, seq) VALUES (?, ?, ?, ?, ?)').run(newId(), id, o, now, nextSeq(db));
      }
    }
    return { note: getNote(db, id)!, cards: listCardsOfNote(db, id) };
  });
}

export function deleteNote(db: Db, id: string, now = Date.now()): void {
  tx(db, () => {
    db.prepare('UPDATE note SET deleted = 1, updated_at = ?, seq = ? WHERE id = ?').run(now, nextSeq(db), id);
    for (const c of listCardsOfNote(db, id)) {
      db.prepare('UPDATE card SET deleted = 1, updated_at = ?, seq = ? WHERE id = ?').run(now, nextSeq(db), c.id);
    }
  });
}

export function setCardSuspended(db: Db, cardId: string, suspended: boolean, now = Date.now()): void {
  db.prepare('UPDATE card SET suspended = ?, updated_at = ?, seq = ? WHERE id = ?').run(suspended ? 1 : 0, now, nextSeq(db), cardId);
}

export interface NoteListItem extends Note {
  deckTitle: string;
  cards: Card[];
}

export function listNotes(
  db: Db,
  filter: { deckId?: string; moduleId?: string; q?: string; kind?: NoteKind; limit?: number },
): NoteListItem[] {
  const where = ['n.deleted = 0', 'd.deleted = 0'];
  const params: (string | number)[] = [];
  if (filter.deckId) { where.push('n.deck_id = ?'); params.push(filter.deckId); }
  if (filter.moduleId) { where.push('d.module_id = ?'); params.push(filter.moduleId); }
  if (filter.kind) { where.push('n.kind = ?'); params.push(filter.kind); }
  if (filter.q) { where.push('(n.front LIKE ? OR n.back LIKE ?)'); params.push(`%${filter.q}%`, `%${filter.q}%`); }
  params.push(filter.limit ?? 500);
  const rows = db.prepare(
    `SELECT n.*, d.title AS deck_title FROM note n JOIN deck d ON d.id = n.deck_id
     WHERE ${where.join(' AND ')} ORDER BY d.position, n.position LIMIT ?`,
  ).all(...params) as Row[];
  return rows.map((r) => ({ ...toNote(r), deckTitle: r.deck_title, cards: listCardsOfNote(db, r.id).filter((c) => !c.deleted) }));
}

export function countNotes(db: Db, deckId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM note WHERE deck_id = ? AND deleted = 0').get(deckId) as Row).n;
}

/** Notes eines Decks, von deren Karten noch keine bewertet wurde. */
export function unreviewedNoteIds(db: Db, deckId: string): string[] {
  return (db.prepare(
    `SELECT n.id FROM note n WHERE n.deck_id = ? AND n.deleted = 0 AND NOT EXISTS (
       SELECT 1 FROM card c JOIN revlog r ON r.card_id = c.id WHERE c.note_id = n.id)`,
  ).all(deckId) as Row[]).map((r) => r.id);
}

// ---------- Bewertungen und Zustand ----------

const toRevlog = (r: Row): RevlogEntry => ({
  id: r.id, cardId: r.card_id, rating: r.rating, reviewedAt: r.reviewed_at, durationMs: r.duration_ms,
  deviceId: r.device_id, revokes: r.revokes ?? null,
});

export function insertRevlog(db: Db, e: RevlogEntry): void {
  const exists = db.prepare('SELECT 1 FROM revlog WHERE id = ?').get(e.id);
  if (exists) return;
  db.prepare(
    'INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, revokes, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.id, e.cardId, e.rating, e.reviewedAt, e.durationMs, e.deviceId, e.revokes, nextSeq(db));
}

export function getRevlog(db: Db, id: string): RevlogEntry | undefined {
  const r = db.prepare('SELECT * FROM revlog WHERE id = ?').get(id) as Row | undefined;
  return r && toRevlog(r);
}

export function listRevlogForCard(db: Db, cardId: string): RevlogEntry[] {
  return (db.prepare('SELECT * FROM revlog WHERE card_id = ?').all(cardId) as Row[]).map(toRevlog);
}

export function saveCardState(db: Db, cardId: string, state: CardState, firstReviewedAt: number | null): void {
  db.prepare(
    `INSERT INTO card_state (card_id, json, first_reviewed_at) VALUES (?, ?, ?)
     ON CONFLICT(card_id) DO UPDATE SET json = excluded.json, first_reviewed_at = excluded.first_reviewed_at`,
  ).run(cardId, JSON.stringify(state), firstReviewedAt);
}

/** Alle lernbaren Karten (nicht gelöscht, Note/Deck/Modul nicht gelöscht). */
export function studyRows(db: Db): QueueCard[] {
  const rows = db.prepare(
    `SELECT c.id AS card_id, c.ordinal, c.suspended, n.id AS note_id, n.position AS note_pos,
            d.id AS deck_id, d.position AS deck_pos, d.module_id, s.json, s.first_reviewed_at
     FROM card c
     JOIN note n ON n.id = c.note_id
     JOIN deck d ON d.id = n.deck_id
     JOIN module m ON m.id = d.module_id
     LEFT JOIN card_state s ON s.card_id = c.id
     WHERE c.deleted = 0 AND n.deleted = 0 AND d.deleted = 0 AND m.deleted = 0`,
  ).all() as Row[];
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

/** Zeitpunkte aller gültigen Bewertungen (für Serie/heute gelernt). */
export function allReviewTimes(db: Db): number[] {
  return (db.prepare(
    `SELECT reviewed_at FROM revlog r WHERE rating >= 1
     AND NOT EXISTS (SELECT 1 FROM revlog u WHERE u.revokes = r.id)`,
  ).all() as Row[]).map((r) => r.reviewed_at);
}
