import {
  clozeOrdinals, emptyState, newId, toCard, toDeck, toModule, toNote, toRevlog,
  type Card, type CardState, type Deck, type DeckStatus, type Language, type Module, type Note,
  type NoteKind, type NoteSource, type QueueCard, type RevlogEntry, type Slide,
} from '@naklearn/core';
import { tx, type Db } from './db.ts';

// node:sqlite liefert Zeilen als untypisierte Objekte.
type Row = Record<string, any>;

export function nextSeq(db: Db): number {
  const r = db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'seq' RETURNING value").get() as Row;
  return Number(r.value);
}

// ---------- Module ----------


export function getModule(db: Db, id: string): Module | undefined {
  const r = db.prepare('SELECT * FROM module WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
  return r && toModule(r);
}

export function listModules(db: Db): Module[] {
  return (db.prepare('SELECT * FROM module WHERE deleted = 0 ORDER BY name').all() as Row[]).map(toModule);
}

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

export function deleteModule(db: Db, id: string, now = Date.now()): void {
  db.prepare('UPDATE module SET deleted = 1, updated_at = ?, seq = ? WHERE id = ?').run(now, nextSeq(db), id);
}

// ---------- Decks ----------


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
  patch: Partial<{ title: string; status: DeckStatus; error: string | null; pageCount: number; summary: string | null }>,
  now = Date.now(),
): Deck {
  const cur = getDeck(db, id);
  if (!cur) throw new Error(`Foliensatz ${id} nicht gefunden`);
  const next = { ...cur, ...patch };
  db.prepare(
    'UPDATE deck SET title = ?, status = ?, error = ?, page_count = ?, summary = ?, updated_at = ?, seq = ? WHERE id = ?',
  ).run(next.title, next.status, next.error, next.pageCount, next.summary, now, nextSeq(db), id);
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
    // Geänderter Text → deutsche Fassung veraltet, wird neu übersetzt.
    db.prepare(`UPDATE note SET front_de = CASE WHEN front = ? AND back = ? THEN front_de END,
      back_de = CASE WHEN front = ? AND back = ? THEN back_de END,
      front = ?, back = ?, tags = ?, updated_at = ?, seq = ? WHERE id = ?`)
      .run(next.front, next.back, next.front, next.back, next.front, next.back, JSON.stringify(next.tags), now, nextSeq(db), id);
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

export function setCardFlag(db: Db, userId: string, cardId: string, suspended: boolean, now: number): void {
  tx(db, () => {
    db.prepare(
      `INSERT INTO card_flag (user_id, card_id, suspended, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, card_id) DO UPDATE SET suspended = excluded.suspended, updated_at = excluded.updated_at`,
    ).run(userId, cardId, suspended ? 1 : 0, now);
    db.prepare('UPDATE card SET seq = ? WHERE id = ?').run(nextSeq(db), cardId);
  });
}

/**
 * Schreibt die deutsche Fassung, falls `front`/`back` noch dem übersetzten Text entsprechen. Neue seq (Geräte laden sie),
 * `updated_at` bleibt (kein Last-Writer-Wins-Konflikt mit echten Bearbeitungen).
 */
export function setNoteTranslation(
  db: Db, id: string, source: { front: string; back: string }, de: { frontDe: string; backDe: string },
): boolean {
  const r = db.prepare('UPDATE note SET front_de = ?, back_de = ?, seq = ? WHERE id = ? AND front = ? AND back = ? AND deleted = 0')
    .run(de.frontDe, de.backDe, nextSeq(db), id, source.front, source.back);
  return Number(r.changes) > 0;
}

export interface NoteListItem extends Note {
  deckTitle: string;
  cards: Card[];
}

export function listNotes(
  db: Db,
  filter: { deckId?: string; moduleId?: string; q?: string; kind?: NoteKind; limit?: number; userId?: string },
): NoteListItem[] {
  const where = ['n.deleted = 0', 'd.deleted = 0'];
  const params: (string | number)[] = [];
  if (filter.deckId) { where.push('n.deck_id = ?'); params.push(filter.deckId); }
  if (filter.moduleId) { where.push('d.module_id = ?'); params.push(filter.moduleId); }
  if (filter.kind) { where.push('n.kind = ?'); params.push(filter.kind); }
  if (filter.q) { where.push('(n.front LIKE ? OR n.back LIKE ?)'); params.push(`%${filter.q}%`, `%${filter.q}%`); }
  if (filter.userId) { where.push('d.module_id IN (SELECT module_id FROM membership WHERE user_id = ?)'); params.push(filter.userId); }
  params.push(filter.limit ?? 500);
  const rows = db.prepare(
    `SELECT n.*, d.title AS deck_title FROM note n JOIN deck d ON d.id = n.deck_id
     WHERE ${where.join(' AND ')} ORDER BY d.position, n.position LIMIT ?`,
  ).all(...params) as Row[];
  const flags = (cardId: string) => filter.userId
    ? !!(db.prepare('SELECT suspended FROM card_flag WHERE user_id = ? AND card_id = ?').get(filter.userId, cardId) as Row | undefined)?.suspended
    : false;
  return rows.map((r) => ({
    ...toNote(r), deckTitle: r.deck_title,
    cards: listCardsOfNote(db, r.id).filter((c) => !c.deleted).map((c) => ({ ...c, suspended: flags(c.id) })),
  }));
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

export function getRevlog(db: Db, id: string): RevlogEntry | undefined {
  const r = db.prepare('SELECT * FROM revlog WHERE id = ?').get(id) as Row | undefined;
  return r && toRevlog(r);
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

/** Alle lernbaren Karten der eigenen Module (nicht gelöscht, Note/Deck/Modul nicht gelöscht). */
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

/** Zeitpunkte aller gültigen Bewertungen einer Person (für Serie/heute gelernt). */
export function allReviewTimes(db: Db, userId: string): number[] {
  return (db.prepare(
    `SELECT reviewed_at FROM revlog r WHERE r.user_id = ? AND rating >= 1
     AND NOT EXISTS (SELECT 1 FROM revlog u WHERE u.revokes = r.id AND u.user_id = r.user_id)`,
  ).all(userId) as Row[]).map((r) => r.reviewed_at);
}
