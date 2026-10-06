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
