import { describe, expect, it } from 'vitest';
import * as repo from '../src/repo.ts';
import { addUser, memDb } from './helpers.ts';

function setup() {
  const db = memDb();
  const U = addUser(db);
  const mod = repo.createModule(db, { name: 'UI/UX', language: 'en', createdBy: U }, 1000);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'Ch1', pdfSha256: 'abc' }, 1000);
  return { db, U, mod, deck };
}

describe('repo', () => {
  it('legt Module mit Standardwerten an und vergibt steigende seq', () => {
    const { db, mod } = setup();
    expect(mod).toMatchObject({ name: 'UI/UX', language: 'en', examDate: null, newPerDay: 20, deleted: false });
    const s1 = repo.nextSeq(db);
    const s2 = repo.nextSeq(db);
    expect(s2).toBe(s1 + 1);
  });

  it('aktualisiert Module und blendet gelöschte aus', () => {
    const { db, U, mod } = setup();
    repo.updateMembership(db, U, mod.id, { examDate: '2026-10-30', newPerDay: 30 }, 2000);
    expect(repo.getMyModule(db, U, mod.id)).toMatchObject({ examDate: '2026-10-30', newPerDay: 30, updatedAt: 2000 });
    repo.deleteModule(db, mod.id, 3000);
    expect(repo.listModules(db)).toHaveLength(0);
    expect(repo.listMyModules(db, U)).toHaveLength(0);
  });

  it('speichert die Zusammenfassung eines Foliensatzes', () => {
    const { db, deck } = setup();
    expect(deck.summary).toBeNull();
    expect(repo.updateDeck(db, deck.id, { summary: '## Kern' }, 2000).summary).toBe('## Kern');
  });

  it('vergibt Deck-Positionen fortlaufend und findet PDFs per Hash', () => {
    const { db, mod, deck } = setup();
    const d2 = repo.createDeck(db, { moduleId: mod.id, title: 'Ch2', pdfSha256: 'def' }, 1000);
    expect(d2.position).toBe(deck.position + 1);
    expect(repo.findDeckBySha(db, mod.id, 'def')?.id).toBe(d2.id);
    expect(repo.findDeckBySha(db, mod.id, 'zzz')).toBeUndefined();
  });

  it('legt für Lückentext eine Karte pro Lücke an und gleicht beim Bearbeiten ab', () => {
    const { db, deck } = setup();
    const { note, cards } = repo.insertNote(db, {
      deckId: deck.id, kind: 'cloze', front: '{{c1::A}} und {{c2::B}}', back: '', slideRefs: [1],
      frontImagePage: null, tags: [], source: 'chunk', position: 0,
    }, 1000);
    expect(cards.map((c) => c.ordinal)).toEqual([1, 2]);

    const upd = repo.updateNote(db, note.id, { front: '{{c1::A}} und {{c3::C}}' }, 2000);
    const live = upd.cards.filter((c) => !c.deleted).map((c) => c.ordinal);
    expect(live).toEqual([1, 3]);
    expect(upd.cards.find((c) => c.ordinal === 2)?.deleted).toBe(true);

    const back = repo.updateNote(db, note.id, { front: '{{c1::A}} {{c2::B}} {{c3::C}}' }, 3000);
    expect(back.cards.filter((c) => !c.deleted).map((c) => c.ordinal)).toEqual([1, 2, 3]);
  });

  it('lehnt Lückentext ohne Lücke ab', () => {
    const { db, deck } = setup();
    expect(() => repo.insertNote(db, {
      deckId: deck.id, kind: 'cloze', front: 'keine Lücke', back: '', slideRefs: [1],
      frontImagePage: null, tags: [], source: 'chunk', position: 0,
    }, 1000)).toThrow(/Lücke/);
  });

  it('listNotes filtert nach Text und liefert Deck-Titel und Karten', () => {
    const { db, deck, mod } = setup();
    const base = { deckId: deck.id, back: 'x', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk' as const };
    repo.insertNote(db, { ...base, kind: 'qa', front: 'What is HCI?', position: 0 }, 1000);
    repo.insertNote(db, { ...base, kind: 'qa', front: 'Define affordance', position: 1 }, 1000);
    const res = repo.listNotes(db, { moduleId: mod.id, q: 'afford' });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ front: 'Define affordance', deckTitle: 'Ch1' });
    expect(res[0]!.cards).toHaveLength(1);
  });

  it('studyRows liefert nur aktive Karten mit Zustand', () => {
    const { db, U, deck, mod } = setup();
    const { cards } = repo.insertNote(db, {
      deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null,
      tags: [], source: 'chunk', position: 5,
    }, 1000);
    const rows = repo.studyRows(db, U);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cardId: cards[0]!.id, moduleId: mod.id, sortKey: [deck.position, 5, 0], firstReviewedAt: null });
    expect(rows[0]!.state.state).toBe(0);
    repo.deleteDeck(db, deck.id, 2000);
    expect(repo.studyRows(db, U)).toHaveLength(0);
  });

  it('insertRevlog ist idempotent', () => {
    const { db, U } = setup();
    const e = { id: 'r1', cardId: 'c1', rating: 3 as const, reviewedAt: 1, durationMs: 5, deviceId: 'd', revokes: null };
    repo.insertRevlog(db, e, U);
    repo.insertRevlog(db, e, U);
    expect(repo.listRevlogForCard(db, U, 'c1')).toHaveLength(1);
  });
});
