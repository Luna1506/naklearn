import { emptyPush } from '@naklearn/core';
import { describe, expect, it } from 'vitest';
import * as repo from '../src/repo.ts';
import { getNext } from '../src/study.ts';
import { applyPush, pullSince } from '../src/sync.ts';
import { addUser, memDb } from './helpers.ts';

function seeded() {
  const db = memDb();
  const U = addUser(db);
  const mod = repo.createModule(db, { name: 'M', language: 'en', createdBy: U }, 1000);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' }, 1000);
  repo.replaceSlides(db, deck.id, [{ deckId: deck.id, page: 1, text: 'langer Text', image: '1.jpg' }]);
  const qa = repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 }, 1000);
  const cz = repo.insertNote(db, { deckId: deck.id, kind: 'cloze', front: '{{c1::X}}', back: '', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 1 }, 1000);
  return { db, mod, deck, qa, cz, U };
}

describe('pullSince', () => {
  it('liefert beim ersten Pull alles, danach nichts mehr', () => {
    const { db, U } = seeded();
    const first = pullSince(db, U, 0);
    expect(first.hasMore).toBe(false);
    expect(first.pull.modules).toHaveLength(1);
    expect(first.pull.decks).toHaveLength(1);
    expect(first.pull.slides).toEqual([{ deckId: first.pull.decks[0]!.id, page: 1, image: '1.jpg' }]);
    expect(first.pull.notes).toHaveLength(2);
    expect(first.pull.cards).toHaveLength(2);
    const again = pullSince(db, U, first.cursor);
    expect(again.cursor).toBe(first.cursor);
    expect(Object.values(again.pull).every((a) => a.length === 0)).toBe(true);
  });

  it('teilt große Änderungsmengen in Seiten ohne Lücken oder Doppelte', () => {
    const { db, U } = seeded();
    const seen = new Set<string>();
    let cursor = 0;
    let pages = 0;
    for (;;) {
      const r = pullSince(db, U, cursor, 3);
      pages++;
      for (const [k, arr] of Object.entries(r.pull)) for (const x of arr as { id?: string; deckId?: string; page?: number }[]) {
        const key = `${k}:${x.id ?? `${x.deckId}/${x.page}`}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      cursor = r.cursor;
      if (!r.hasMore) break;
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen.size).toBe(1 + 1 + 1 + 2 + 2);
  });
});

describe('applyPush', () => {
  it('übernimmt Bewertungen idempotent und berechnet den Kartenzustand', () => {
    const { db, U, qa } = seeded();
    const r = { id: 'r1', cardId: qa.cards[0]!.id, rating: 4 as const, reviewedAt: Date.now(), durationMs: 10, deviceId: 'phone', revokes: null };
    applyPush(db, U, { ...emptyPush(), revlog: [r] });
    applyPush(db, U, { ...emptyPush(), revlog: [r] });
    expect(repo.listRevlogForCard(db, U, qa.cards[0]!.id)).toHaveLength(1);
    expect(repo.studyRows(db, U).find((x) => x.cardId === qa.cards[0]!.id)!.state.state).toBe(2);
  });

  it('Last-Writer-Wins für Notes: ältere Änderung wird ignoriert, neuere übernommen und neu nummeriert', () => {
    const { db, U, qa } = seeded();
    const cursor = pullSince(db, U, 0).cursor;
    applyPush(db, U, { ...emptyPush(), notes: [{ ...qa.note, front: 'alt', updatedAt: 500 }] });
    expect(repo.getNote(db, qa.note.id)!.front).toBe('Q');
    applyPush(db, U, { ...emptyPush(), notes: [{ ...qa.note, front: 'neu', updatedAt: 5000 }] });
    expect(repo.getNote(db, qa.note.id)!.front).toBe('neu');
    expect(pullSince(db, U, cursor).pull.notes.map((n) => n.front)).toEqual(['neu']);
  });

  it('eine neuere Löschung auf dem Laptop gewinnt gegen eine ältere Bearbeitung vom Handy', () => {
    const { db, U, qa } = seeded();
    repo.deleteNote(db, qa.note.id, 9000);
    applyPush(db, U, { ...emptyPush(), notes: [{ ...qa.note, front: 'Handy', updatedAt: 8000 }] });
    expect(repo.getNote(db, qa.note.id)).toMatchObject({ deleted: true, front: 'Q' });
  });

  it('legt neue Lücken-Karten vom Handy an und übernimmt Pausieren', () => {
    const { db, U, cz } = seeded();
    applyPush(db, U, {
      ...emptyPush(),
      notes: [{ ...cz.note, front: '{{c1::X}} {{c2::Y}}', updatedAt: 5000 }],
      cards: [
        { id: 'phone-card', noteId: cz.note.id, ordinal: 2, suspended: false, deleted: false, updatedAt: 5000 },
        { ...cz.cards[0]!, suspended: true, updatedAt: 5000 },
      ],
    });
    const cards = repo.listCardsOfNote(db, cz.note.id);
    expect(cards.map((c) => c.ordinal)).toEqual([1, 2]);
    const flagged = repo.studyRows(db, U).filter((r) => r.suspended).map((r) => r.cardId);
    expect(flagged).toEqual([cz.cards[0]!.id]);
  });

  it('ignoriert Karten zu unbekannten Notes', () => {
    const { db, U } = seeded();
    applyPush(db, U, { ...emptyPush(), cards: [{ id: 'x', noteId: 'gibt-es-nicht', ordinal: 0, suspended: false, deleted: false, updatedAt: 1 }] });
    expect(repo.getCard(db, 'x')).toBeUndefined();
  });

  it('übernimmt Prüfungsdatum vom Handy', () => {
    const { db, U, mod } = seeded();
    applyPush(db, U, { ...emptyPush(), modules: [{ ...mod, examDate: '2026-10-30', updatedAt: 5000 }] });
    expect(repo.getMyModule(db, U, mod.id)!.examDate).toBe('2026-10-30');
    expect(getNext(db, U, {}, Date.now()).counts.new).toBeGreaterThan(0);
  });

  it('eine Löschung auf dem Laptop bleibt bestehen, auch gegen eine neuere Handy-Bearbeitung', () => {
    const { db, U, qa, mod } = seeded();
    repo.deleteNote(db, qa.note.id, 2_000_000);
    applyPush(db, U, { ...emptyPush(), notes: [{ ...qa.note, front: 'Handy', updatedAt: 2_100_000 }] });
    expect(repo.getNote(db, qa.note.id)).toMatchObject({ deleted: true, front: 'Q' });
    repo.deleteModule(db, mod.id, 2_000_000);
    applyPush(db, U, { ...emptyPush(), modules: [{ ...mod, examDate: '2026-10-30', updatedAt: 2_100_000 }] });
    expect(repo.getModule(db, mod.id)).toBeUndefined();
  });

  it('Lücken-Karten passen nach dem Push zur gewinnenden Notiz (keine Waisen, keine Doppelten)', () => {
    const { db, U, cz } = seeded();
    // Laptop hat die Notiz später auf c1 + c2 gebracht
    repo.updateNote(db, cz.note.id, { front: '{{c1::X}} {{c2::Y}}' }, 9000);
    const laptopC2 = repo.listCardsOfNote(db, cz.note.id).find((c) => c.ordinal === 2)!;
    // Handy (älter) hatte c2 und c3 angelegt
    applyPush(db, U, {
      ...emptyPush(),
      notes: [{ ...cz.note, front: '{{c1::X}} {{c2::Y}} {{c3::Z}}', updatedAt: 5000 }],
      cards: [
        { id: 'phone-c2', noteId: cz.note.id, ordinal: 2, suspended: false, deleted: false, updatedAt: 5000 },
        { id: 'phone-c3', noteId: cz.note.id, ordinal: 3, suspended: false, deleted: false, updatedAt: 5000 },
      ],
    });
    const live = repo.listCardsOfNote(db, cz.note.id).filter((c) => !c.deleted);
    expect(live.map((c) => [c.ordinal, c.id === laptopC2.id || c.ordinal === 1])).toEqual([[1, true], [2, true]]);
  });

  it('abgelehnte Pushes bekommen eine neue seq, damit das Gerät die Server-Version zieht', () => {
    const { db, U, qa } = seeded();
    const cursor = pullSince(db, U, 0).cursor;
    applyPush(db, U, { ...emptyPush(), notes: [{ ...qa.note, front: 'alt', updatedAt: 1 }] });
    expect(pullSince(db, U, cursor).pull.notes.map((n) => n.front)).toEqual(['Q']);
  });
});

describe('Sicht der Person', () => {
  it('liefert nur Inhalte eigener Module, fremde Module als gelöscht', () => {
    const { db, mod } = seeded();
    const mia = addUser(db, 'mia');
    const page = pullSince(db, mia, 0);
    expect(page.pull.decks).toEqual([]);
    expect(page.pull.notes).toEqual([]);
    expect(page.pull.modules).toEqual([expect.objectContaining({ id: mod.id, deleted: true })]);
  });

  it('Join liefert alten Inhalt, auch wenn der Cursor schon weiter ist', () => {
    const { db, mod } = seeded();
    const mia = addUser(db, 'mia');
    const cursor = pullSince(db, mia, 0).cursor;
    repo.joinModule(db, mia, mod.id, 5000);
    const page = pullSince(db, mia, cursor);
    expect(page.pull.modules).toEqual([expect.objectContaining({ id: mod.id, deleted: false })]);
    expect(page.pull.decks).toHaveLength(1);
    expect(page.pull.slides).toHaveLength(1);
    expect(page.pull.notes).toHaveLength(2);
    expect(page.pull.cards).toHaveLength(2);
  });

  it('Leave liefert das Modul als gelöscht', () => {
    const { db, mod, U } = seeded();
    const cursor = pullSince(db, U, 0).cursor;
    repo.leaveModule(db, U, mod.id);
    expect(pullSince(db, U, cursor).pull.modules).toEqual([expect.objectContaining({ id: mod.id, deleted: true })]);
  });

  it('fremde Bewertungen werden nie geliefert', () => {
    const { db, mod, qa, U } = seeded();
    const mia = addUser(db, 'mia');
    repo.joinModule(db, mia, mod.id, 2000);
    applyPush(db, mia, { ...emptyPush(), revlog: [{ id: 'r-mia', cardId: qa.cards[0]!.id, rating: 3, reviewedAt: 3000, durationMs: 1, deviceId: 'mia-phone', revokes: null }] });
    expect(pullSince(db, U, 0).pull.revlog).toEqual([]);
    expect(pullSince(db, mia, 0).pull.revlog.map((r) => r.id)).toEqual(['r-mia']);
    expect(repo.studyRows(db, U).find((r) => r.cardId === qa.cards[0]!.id)!.state.reps).toBe(0);
  });

  it('persönliche Felder kommen aus Mitgliedschaft und Flags', () => {
    const { db, mod, qa, U } = seeded();
    repo.updateMembership(db, U, mod.id, { examDate: '2026-12-01', newPerDay: 7 }, 6000);
    repo.setCardFlag(db, U, qa.cards[0]!.id, true, 6000);
    const page = pullSince(db, U, 0).pull;
    expect(page.modules[0]).toMatchObject({ examDate: '2026-12-01', newPerDay: 7 });
    expect(page.cards.find((c) => c.id === qa.cards[0]!.id)).toMatchObject({ suspended: true, updatedAt: 6000 });
  });

  it('Push trennt persönlich und gemeinsam; Löschen vom Gerät = Verlassen', () => {
    const { db, mod, qa, U } = seeded();
    const mia = addUser(db, 'mia');
    repo.joinModule(db, mia, mod.id, 2000);
    applyPush(db, mia, {
      ...emptyPush(),
      modules: [{ ...mod, examDate: '2026-12-24', newPerDay: 3, updatedAt: 7000 }],
      cards: [{ ...qa.cards[0]!, suspended: true, updatedAt: 7000 }],
    });
    expect(repo.getMyModule(db, mia, mod.id)).toMatchObject({ examDate: '2026-12-24', newPerDay: 3 });
    expect(repo.getMyModule(db, U, mod.id)!.examDate).toBeNull();
    expect(repo.studyRows(db, U).find((r) => r.cardId === qa.cards[0]!.id)!.suspended).toBe(false);
    applyPush(db, mia, { ...emptyPush(), modules: [{ ...mod, deleted: true, updatedAt: 8000 }] });
    expect(repo.memberIds(db, mod.id)).toEqual([U]);
    expect(repo.getModule(db, mod.id)).toBeDefined();
    applyPush(db, U, { ...emptyPush(), modules: [{ ...mod, deleted: true, updatedAt: 9000 }] });
    expect(repo.getModule(db, mod.id)).toBeUndefined();
  });
});
