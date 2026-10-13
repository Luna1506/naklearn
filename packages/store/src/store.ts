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
    // Das Handy ist nur eine Kopie: Sync-Seiten können Kinder vor ihren Eltern liefern.
    await db.execute('PRAGMA foreign_keys = OFF');
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

  /** Zeitstempel für eine lokale Änderung: immer neuer als die zuletzt gesehene Version (gegen nachgehende Uhren). */
  private async editTime(table: 'module' | 'note' | 'card', id: string): Promise<number> {
    const [r] = await this.db.all<{ updated_at: number }>(`SELECT updated_at FROM ${table} WHERE id = ?`, [id]);
    return Math.max(this.clock(), (r?.updated_at ?? 0) + 1);
  }

  async getMeta(key: string): Promise<string | null> {
    const r = await this.db.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return r[0]?.value ?? null;
  }

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
    const now = await this.editTime('note', noteId);
    await this.db.transaction(async () => {
      await this.db.run('UPDATE note SET deleted = 1, updated_at = ?, dirty = 1 WHERE id = ?', [now, noteId]);
      await this.db.run('UPDATE card SET deleted = 1, updated_at = ?, dirty = 1 WHERE note_id = ?', [now, noteId]);
    });
  }

  async setSuspended(cardId: string, suspended: boolean): Promise<void> {
    await this.db.run('UPDATE card SET suspended = ?, updated_at = ?, dirty = 1 WHERE id = ?', [suspended ? 1 : 0, await this.editTime('card', cardId), cardId]);
  }

  async updateNote(noteId: string, patch: { front: string; back: string }): Promise<void> {
    const [row] = await this.db.all('SELECT * FROM note WHERE id = ?', [noteId]);
    if (!row) throw new Error('Karte nicht gefunden');
    const note = toNote(row);
    const ords = note.kind === 'cloze' ? clozeOrdinals(patch.front) : [0];
    if (ords.length === 0) throw new Error('Lückentext ohne Lücke ({{c1::…}})');
    const now = await this.editTime('note', noteId);
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
    if (patch.examDate !== undefined && patch.examDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.examDate)) {
      throw new Error('Prüfungsdatum muss JJJJ-MM-TT sein');
    }
    const m = { ...toModule(row), ...patch };
    const newPerDay = Math.min(500, Math.max(0, Math.round(Number(m.newPerDay) || 0)));
    await this.db.run('UPDATE module SET exam_date = ?, new_per_day = ?, updated_at = ?, dirty = 1 WHERE id = ?', [m.examDate, newPerDay, await this.editTime('module', id), id]);
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
