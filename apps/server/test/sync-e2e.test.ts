import type { SyncRequest, SyncResponse } from '@naklearn/core';
import { LocalStore, syncStore, type SqlAdapter } from '@naklearn/store';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { addDevice, createUser } from '../src/accounts.ts';
import { buildApp } from '../src/app.ts';
import { applyPush, pullSince } from '../src/sync.ts';
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
  const cfg = { dataDir: '/tmp', port: 0, host: '127.0.0.1', token: 't', deviceId: 'laptop', password: null, adminName: 'luna', sessionSecret: 's', publicUrl: null, claudePath: '', summaryModel: null, cardsModel: null, webDir: null };
  const worker = { wake() {}, resume() {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
  const app = buildApp({ db, cfg, worker, now: () => NOW });
  const owner = createUser(db, { name: 'luna', password: 'pw-luna-123', isAdmin: true, now: NOW });
  const { token } = addDevice(db, owner.id, 'Handy', NOW);
  // Server-Daten entstehen kurz vor der (festen) Testuhr, wie im echten Leben vor dem Lernen.
  const t0 = NOW - 60_000;
  const mod = repo.createModule(db, { name: 'UIUX', language: 'en', createdBy: owner.id }, t0);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'Ch1', pdfSha256: 's' }, t0);
  repo.replaceSlides(db, deck.id, [{ deckId: deck.id, page: 1, text: 't', image: '1.jpg' }]);
  for (let i = 0; i < 3; i++) {
    repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: `Q${i}`, back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: i }, t0);
  }
  let calls = 0;
  let failNext = false;
  const transport = async (req: SyncRequest): Promise<SyncResponse> => {
    calls++;
    if (failNext) { failNext = false; throw new Error('Netz weg'); }
    const r = await app.inject({ method: 'POST', url: '/api/sync', payload: req, headers: { authorization: `Bearer ${token}` } });
    if (r.statusCode !== 200) throw new Error(r.body);
    return r.json();
  };
  let phoneNow = NOW;
  const phone = await LocalStore.open(nodeAdapter(), { now: () => phoneNow });
  return { db, owner, mod, deck, phone, transport, calls: () => calls, failOnce: () => (failNext = true), tick: (ms: number) => (phoneNow += ms) };
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
    const { db, owner, phone, transport } = await setup();
    await syncStore(phone, transport);
    const c = (await phone.next({})).card!;
    await phone.answer(c.cardId, 4, 1000);
    const pushed = await syncStore(phone, transport);
    expect(pushed.pushed).toBe(1);
    expect(repo.studyRows(db, owner.id).find((x) => x.cardId === c.cardId)!.state.state).toBe(2);

    const laptopCard = getNext(db, owner.id, {}, NOW).card!;
    expect(laptopCard.cardId).not.toBe(c.cardId);
    answer(db, { userId: owner.id, cardId: laptopCard.cardId, rating: 3, durationMs: 1, deviceId: 'laptop', now: NOW });
    await syncStore(phone, transport);
    expect((await phone.next({})).counts.learning).toBe(1);
  });

  it('dieselbe Karte auf beiden Geräten gelernt → gleicher Zustand überall', async () => {
    const { db, owner, phone, transport, tick } = await setup();
    await syncStore(phone, transport);
    const cardId = (await phone.next({})).card!.cardId;
    answer(db, { userId: owner.id, cardId, rating: 3, durationMs: 1, deviceId: 'laptop', now: NOW });
    tick(15 * 60_000);
    await phone.answer(cardId, 3, 1000);
    await syncStore(phone, transport);
    const server = repo.studyRows(db, owner.id).find((x) => x.cardId === cardId)!.state;
    const [local] = await phone.db.all<{ json: string }>('SELECT json FROM card_state WHERE card_id = ?', [cardId]);
    expect(JSON.parse(local!.json)).toEqual(server);
    expect(server.reps).toBe(2);
  });

  it('bricht der Sync ab, geht nichts verloren und nichts doppelt', async () => {
    const { db, owner, phone, transport, failOnce } = await setup();
    await syncStore(phone, transport);
    const c = (await phone.next({})).card!;
    await phone.answer(c.cardId, 3, 1000);
    failOnce();
    await expect(syncStore(phone, transport)).rejects.toThrow('Netz weg');
    const dirty = await phone.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM revlog WHERE dirty = 1');
    expect(dirty[0]!.n).toBe(1);
    await syncStore(phone, transport);
    await syncStore(phone, transport);
    expect(repo.listRevlogForCard(db, owner.id, c.cardId)).toHaveLength(1);
  });

  it('Bearbeitung, Pausieren und Prüfungsdatum vom Handy erreichen den Laptop', async () => {
    const { db, owner, mod, phone, transport, tick } = await setup();
    await syncStore(phone, transport);
    tick(60_000);
    const c = (await phone.next({})).card!;
    await phone.updateNote(c.noteId, { front: 'Neu vom Handy', back: 'B' });
    await phone.setSuspended(c.cardId, true);
    await phone.updateModule(mod.id, { examDate: '2026-10-30' });
    await syncStore(phone, transport);
    expect(repo.getNote(db, c.noteId)!.front).toBe('Neu vom Handy');
    expect(repo.studyRows(db, owner.id).find((r) => r.cardId === c.cardId)!.suspended).toBe(true);
    expect(repo.getMyModule(db, owner.id, mod.id)!.examDate).toBe('2026-10-30');
    const [dirtyNotes] = await phone.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM note WHERE dirty = 1');
    expect(dirtyNotes!.n).toBe(0);
  });

  it('Rückgängig auf dem Handy nach bereits erfolgtem Sync', async () => {
    const { db, owner, phone, transport } = await setup();
    await syncStore(phone, transport);
    const c = (await phone.next({})).card!;
    const { revlogId } = await phone.answer(c.cardId, 4, 1000);
    await syncStore(phone, transport);
    await phone.undo(revlogId);
    await syncStore(phone, transport);
    expect(repo.studyRows(db, owner.id).find((x) => x.cardId === c.cardId)!.state.state).toBe(0);
  });

  it('Löschen auf dem Handy erreicht den Laptop', async () => {
    const { db, owner, phone, transport, tick } = await setup();
    await syncStore(phone, transport);
    tick(60_000);
    const c = (await phone.next({})).card!;
    await phone.deleteNote(c.noteId);
    await syncStore(phone, transport);
    expect(repo.getNote(db, c.noteId)!.deleted).toBe(true);
    expect(repo.getCard(db, c.cardId)!.deleted).toBe(true);
  });

  it('vollständiger Sync über viele Seiten, auch wenn Eltern-Zeilen später geändert wurden', async () => {
    const { db, owner, deck, phone } = await setup();
    repo.updateDeck(db, deck.id, { status: 'ready' }, NOW); // Deck bekommt eine höhere seq als seine Notes
    const paged = async (req: SyncRequest): Promise<SyncResponse> => {
      applyPush(db, owner.id, req.push);
      return pullSince(db, owner.id, req.cursor, 2);
    };
    await syncStore(phone, paged);
    expect((await phone.overview()).modules[0]).toMatchObject({ total: 3 });
  });

  it('Handy-Änderung gewinnt gegen die Version, die das Handy gesehen hat – auch bei nachgehender Uhr', async () => {
    const { db, owner, phone, transport } = await setup();
    await syncStore(phone, transport);
    const c = (await phone.next({})).card!;
    repo.updateNote(db, c.noteId, { front: 'Laptop' }, NOW + 10 * 60_000); // Laptop-Uhr 10 min voraus
    await syncStore(phone, transport);
    await phone.updateNote(c.noteId, { front: 'Handy', back: 'B' }); // Handy-Uhr steht noch auf NOW
    await syncStore(phone, transport);
    expect(repo.getNote(db, c.noteId)!.front).toBe('Handy');
  });

  it('abgelehnte (ältere) Handy-Änderung wird durch die Server-Version ersetzt', async () => {
    const { db, owner, phone, transport } = await setup();
    await syncStore(phone, transport);
    const c = (await phone.next({})).card!;
    await phone.updateNote(c.noteId, { front: 'Handy offline', back: 'B' });
    repo.updateNote(db, c.noteId, { front: 'Laptop später' }, NOW + 3_600_000);
    await syncStore(phone, transport);
    const [row] = await phone.db.all<{ front: string; dirty: number }>('SELECT front, dirty FROM note WHERE id = ?', [c.noteId]);
    expect(row).toEqual({ front: 'Laptop später', dirty: 0 });
  });

  it('Löschungen auf dem Laptop verschwinden vom Handy', async () => {
    const { db, owner, deck, phone, transport } = await setup();
    await syncStore(phone, transport);
    repo.deleteDeck(db, deck.id);
    await syncStore(phone, transport);
    expect((await phone.overview()).modules[0]!.total).toBe(0);
    expect(await phone.listSlides()).toHaveLength(0);
  });
});

describe('zwei Personen, zwei Handys', () => {
  it('lernen dasselbe Modul offline, jede behält ihren Stand, Karteninhalte sind gemeinsam', async () => {
    const db = memDb();
    const cfg = { dataDir: '/tmp', port: 0, host: '127.0.0.1', token: 't', deviceId: 'server', password: null, adminName: 'luna', sessionSecret: 's', publicUrl: null, claudePath: '', summaryModel: null, cardsModel: null, webDir: null };
    const worker = { wake() {}, resume() {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
    const app = buildApp({ db, cfg, worker, now: () => NOW });
    const luna = createUser(db, { name: 'luna', password: 'pw-luna-123', isAdmin: true, now: NOW });
    const mia = createUser(db, { name: 'mia', password: 'pw-mia-1234', now: NOW });
    const mod = repo.createModule(db, { name: 'Cloud', language: 'en', createdBy: luna.id }, NOW - 60_000);
    repo.joinModule(db, mia.id, mod.id, NOW - 60_000);
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' }, NOW - 60_000);
    for (let i = 0; i < 2; i++) {
      repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: `Q${i}`, back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: i }, NOW - 60_000);
    }
    const phoneOf = async (userId: string) => {
      const { token } = addDevice(db, userId, 'Handy', NOW);
      const transport = async (req: SyncRequest): Promise<SyncResponse> => {
        const r = await app.inject({ method: 'POST', url: '/api/sync', payload: req, headers: { authorization: `Bearer ${token}` } });
        if (r.statusCode !== 200) throw new Error(r.body);
        return r.json();
      };
      return { store: await LocalStore.open(nodeAdapter(), { now: () => NOW }), transport };
    };
    const a = await phoneOf(luna.id);
    const b = await phoneOf(mia.id);
    await syncStore(a.store, a.transport);
    await syncStore(b.store, b.transport);
    const card = (await a.store.next({})).card!;
    await a.store.answer(card.cardId, 4, 1000);
    await a.store.updateNote(card.noteId, { front: 'Q0 verbessert', back: 'A' });
    await syncStore(a.store, a.transport);
    await syncStore(b.store, b.transport);
    expect((await a.store.next({})).counts.new).toBe(1);
    expect((await b.store.next({})).counts.new).toBe(2);
    const [note] = await b.store.db.all<{ front: string }>('SELECT front FROM note WHERE id = ?', [card.noteId]);
    expect(note!.front).toBe('Q0 verbessert');
    expect(await b.store.db.all('SELECT * FROM revlog')).toEqual([]);
  });

  it('Übersetzungen kommen aufs Handy; Bearbeiten auf dem Handy leert sie hier und dort', async () => {
    const { db, deck, phone, transport } = await setup();
    const note = repo.listNotes(db, { deckId: deck.id }).find((n) => n.front === 'Q0')!;
    repo.setNoteTranslation(db, note.id, { front: 'Q0', back: 'A' }, { frontDe: 'F0', backDe: 'Antwort' });
    await syncStore(phone, transport);
    const card = (await phone.next({})).card!;
    expect(card).toMatchObject({ front: 'Q0', frontDe: 'F0', backDe: 'Antwort' });

    await phone.updateNote(note.id, { front: 'Q0 neu', back: 'A' });
    expect((await phone.next({})).card).toMatchObject({ front: 'Q0 neu', frontDe: null, backDe: null });
    await syncStore(phone, transport);
    expect(repo.getNote(db, note.id)).toMatchObject({ front: 'Q0 neu', frontDe: null, backDe: null });
  });
});
