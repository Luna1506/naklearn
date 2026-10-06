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
