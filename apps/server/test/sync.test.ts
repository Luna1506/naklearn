import { emptyPush } from '@naklearn/core';
import { describe, expect, it } from 'vitest';
import * as repo from '../src/repo.ts';
import { getNext } from '../src/study.ts';
import { applyPush, pullSince } from '../src/sync.ts';
import { memDb } from './helpers.ts';

function seeded() {
  const db = memDb();
  const mod = repo.createModule(db, { name: 'M', language: 'en' }, 1000);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' }, 1000);
  repo.replaceSlides(db, deck.id, [{ deckId: deck.id, page: 1, text: 'langer Text', image: '1.jpg' }]);
  const qa = repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 }, 1000);
  const cz = repo.insertNote(db, { deckId: deck.id, kind: 'cloze', front: '{{c1::X}}', back: '', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 1 }, 1000);
  return { db, mod, deck, qa, cz };
}

describe('pullSince', () => {
  it('liefert beim ersten Pull alles, danach nichts mehr', () => {
    const { db } = seeded();
    const first = pullSince(db, 0);
    expect(first.hasMore).toBe(false);
    expect(first.pull.modules).toHaveLength(1);
    expect(first.pull.decks).toHaveLength(1);
    expect(first.pull.slides).toEqual([{ deckId: first.pull.decks[0]!.id, page: 1, image: '1.jpg' }]);
    expect(first.pull.notes).toHaveLength(2);
    expect(first.pull.cards).toHaveLength(2);
    const again = pullSince(db, first.cursor);
    expect(again.cursor).toBe(first.cursor);
    expect(Object.values(again.pull).every((a) => a.length === 0)).toBe(true);
  });

  it('teilt große Änderungsmengen in Seiten ohne Lücken oder Doppelte', () => {
    const { db } = seeded();
    const seen = new Set<string>();
    let cursor = 0;
    let pages = 0;
    for (;;) {
      const r = pullSince(db, cursor, 3);
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
    const { db, qa } = seeded();
    const r = { id: 'r1', cardId: qa.cards[0]!.id, rating: 4 as const, reviewedAt: Date.now(), durationMs: 10, deviceId: 'phone', revokes: null };
    applyPush(db, { ...emptyPush(), revlog: [r] });
    applyPush(db, { ...emptyPush(), revlog: [r] });
    expect(repo.listRevlogForCard(db, qa.cards[0]!.id)).toHaveLength(1);
    expect(repo.studyRows(db).find((x) => x.cardId === qa.cards[0]!.id)!.state.state).toBe(2);
  });

  it('Last-Writer-Wins für Notes: ältere Änderung wird ignoriert, neuere übernommen und neu nummeriert', () => {
    const { db, qa } = seeded();
    const cursor = pullSince(db, 0).cursor;
    applyPush(db, { ...emptyPush(), notes: [{ ...qa.note, front: 'alt', updatedAt: 500 }] });
    expect(repo.getNote(db, qa.note.id)!.front).toBe('Q');
    applyPush(db, { ...emptyPush(), notes: [{ ...qa.note, front: 'neu', updatedAt: 5000 }] });
    expect(repo.getNote(db, qa.note.id)!.front).toBe('neu');
    expect(pullSince(db, cursor).pull.notes.map((n) => n.front)).toEqual(['neu']);
  });

  it('eine neuere Löschung auf dem Laptop gewinnt gegen eine ältere Bearbeitung vom Handy', () => {
    const { db, qa } = seeded();
    repo.deleteNote(db, qa.note.id, 9000);
    applyPush(db, { ...emptyPush(), notes: [{ ...qa.note, front: 'Handy', updatedAt: 8000 }] });
    expect(repo.getNote(db, qa.note.id)).toMatchObject({ deleted: true, front: 'Q' });
  });

  it('legt neue Lücken-Karten vom Handy an und übernimmt Pausieren', () => {
    const { db, cz } = seeded();
    applyPush(db, {
      ...emptyPush(),
      notes: [{ ...cz.note, front: '{{c1::X}} {{c2::Y}}', updatedAt: 5000 }],
      cards: [
        { id: 'phone-card', noteId: cz.note.id, ordinal: 2, suspended: false, deleted: false, updatedAt: 5000 },
        { ...cz.cards[0]!, suspended: true, updatedAt: 5000 },
      ],
    });
    const cards = repo.listCardsOfNote(db, cz.note.id);
    expect(cards.map((c) => [c.ordinal, c.suspended])).toEqual([[1, true], [2, false]]);
  });

  it('ignoriert Karten zu unbekannten Notes', () => {
    const { db } = seeded();
    applyPush(db, { ...emptyPush(), cards: [{ id: 'x', noteId: 'gibt-es-nicht', ordinal: 0, suspended: false, deleted: false, updatedAt: 1 }] });
    expect(repo.getCard(db, 'x')).toBeUndefined();
  });

  it('übernimmt Prüfungsdatum vom Handy', () => {
    const { db, mod } = seeded();
    applyPush(db, { ...emptyPush(), modules: [{ ...mod, examDate: '2026-10-30', updatedAt: 5000 }] });
    expect(repo.getModule(db, mod.id)!.examDate).toBe('2026-10-30');
    expect(getNext(db, {}, Date.now()).counts.new).toBeGreaterThan(0);
  });

  it('eine Löschung auf dem Laptop bleibt bestehen, auch gegen eine neuere Handy-Bearbeitung', () => {
    const { db, qa, mod } = seeded();
    repo.deleteNote(db, qa.note.id, 2_000_000);
    applyPush(db, { ...emptyPush(), notes: [{ ...qa.note, front: 'Handy', updatedAt: 2_100_000 }] });
    expect(repo.getNote(db, qa.note.id)).toMatchObject({ deleted: true, front: 'Q' });
    repo.deleteModule(db, mod.id, 2_000_000);
    applyPush(db, { ...emptyPush(), modules: [{ ...mod, examDate: '2026-10-30', updatedAt: 2_100_000 }] });
    expect(repo.getModule(db, mod.id)).toBeUndefined();
  });

  it('Lücken-Karten passen nach dem Push zur gewinnenden Notiz (keine Waisen, keine Doppelten)', () => {
    const { db, cz } = seeded();
    // Laptop hat die Notiz später auf c1 + c2 gebracht
    repo.updateNote(db, cz.note.id, { front: '{{c1::X}} {{c2::Y}}' }, 9000);
    const laptopC2 = repo.listCardsOfNote(db, cz.note.id).find((c) => c.ordinal === 2)!;
    // Handy (älter) hatte c2 und c3 angelegt
    applyPush(db, {
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
    const { db, qa } = seeded();
    const cursor = pullSince(db, 0).cursor;
    applyPush(db, { ...emptyPush(), notes: [{ ...qa.note, front: 'alt', updatedAt: 1 }] });
    expect(pullSince(db, cursor).pull.notes.map((n) => n.front)).toEqual(['Q']);
  });
});
