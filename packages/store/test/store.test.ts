import { CORE_MIGRATIONS } from '@naklearn/core';
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

  it('das Update mit Übersetzungsspalten setzt den Sync-Cursor zurück (alles neu laden)', async () => {
    const db = nodeAdapter();
    for (let v = 0; v < CORE_MIGRATIONS.length - 1; v++) await db.execute(CORE_MIGRATIONS[v]!);
    await db.execute(`PRAGMA user_version = ${CORE_MIGRATIONS.length - 1}`);
    await db.run("INSERT INTO meta (key, value) VALUES ('sync_cursor', '42')");
    const store = await LocalStore.open(db);
    expect(await store.getMeta('sync_cursor')).toBeNull();
    expect(await db.all('SELECT front_de, back_de FROM note')).toEqual([]);
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
    expect((await store.next({})).counts.new).toBe(1); // 2 nicht pausierte neue Karten, exakt auf 22 Tage verteilt
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

  it('Moduleinstellungen werden auf gültige Werte begrenzt', async () => {
    const { db, store } = await open();
    await store.updateModule('m1', { newPerDay: 1.6 });
    await store.updateModule('m1', { newPerDay: -3 });
    let [m] = await db.all<{ new_per_day: number }>("SELECT new_per_day FROM module WHERE id = 'm1'");
    expect(m!.new_per_day).toBe(0);
    await store.updateModule('m1', { newPerDay: 9999 });
    [m] = await db.all<{ new_per_day: number }>("SELECT new_per_day FROM module WHERE id = 'm1'");
    expect(m!.new_per_day).toBe(500);
    await expect(store.updateModule('m1', { examDate: '30.10.2026' })).rejects.toThrow();
  });

  it('lokale Änderungen sind immer neuer als die zuletzt gesehene Version (Uhr geht nach)', async () => {
    const { db, store } = await open();
    await db.run("UPDATE note SET updated_at = ? WHERE id = 'n1'", [NOW + 3_600_000]);
    await store.updateNote('n1', { front: 'neu', back: 'b' });
    const [n] = await db.all<{ updated_at: number }>("SELECT updated_at FROM note WHERE id = 'n1'");
    expect(n!.updated_at).toBeGreaterThan(NOW + 3_600_000);
  });
});

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
