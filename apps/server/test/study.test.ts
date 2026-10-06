import { describe, expect, it } from 'vitest';
import * as repo from '../src/repo.ts';
import { answer, getNext, getOverview, undo } from '../src/study.ts';
import { memDb } from './helpers.ts';

const NOW = new Date('2026-10-06T10:00:00+09:00').getTime();
const MIN = 60_000;

function setup(examDate: string | null = null) {
  const db = memDb();
  const mod = repo.createModule(db, { name: 'UIUX', language: 'en', examDate });
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'Ch1', pdfSha256: 's' });
  const base = { deckId: deck.id, back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk' as const };
  const n1 = repo.insertNote(db, { ...base, kind: 'qa', front: 'Q1', position: 1 });
  const n2 = repo.insertNote(db, { ...base, kind: 'qa', front: 'Q2', position: 2 });
  return { db, mod, deck, n1, n2 };
}

describe('Lern-Service', () => {
  it('liefert die erste neue Karte mit Intervallen und Kontext', () => {
    const { db } = setup();
    const r = getNext(db, {}, NOW);
    expect(r.card).toMatchObject({ front: 'Q1', moduleName: 'UIUX', deckTitle: 'Ch1', intervals: { 1: '1m', 2: '6m', 3: '10m' } });
    expect(r.counts).toEqual({ learning: 0, review: 0, new: 2 });
  });

  it('Bewerten verschiebt die Karte in die Lernphase, Rückgängig stellt sie wieder her', () => {
    const { db } = setup();
    const first = getNext(db, {}, NOW).card!;
    const { revlogId } = answer(db, { cardId: first.cardId, rating: 3, durationMs: 4000, deviceId: 'laptop', now: NOW });
    const after = getNext(db, {}, NOW + MIN);
    expect(after.card!.front).toBe('Q2');
    expect(after.counts).toEqual({ learning: 1, review: 0, new: 1 });
    expect(getOverview(db, NOW + MIN).studiedToday).toBe(1);

    undo(db, revlogId, 'laptop', NOW + 2 * MIN);
    const restored = getNext(db, {}, NOW + 2 * MIN);
    expect(restored.card!.front).toBe('Q1');
    expect(restored.counts).toEqual({ learning: 0, review: 0, new: 2 });
    expect(getOverview(db, NOW + 2 * MIN).studiedToday).toBe(0);
  });

  it('Rückgängig einer unbekannten oder bereits zurückgenommenen Bewertung schlägt fehl', () => {
    const { db } = setup();
    const c = getNext(db, {}, NOW).card!;
    const { revlogId } = answer(db, { cardId: c.cardId, rating: 3, durationMs: 1, deviceId: 'l', now: NOW });
    undo(db, revlogId, 'l', NOW + 1);
    expect(() => undo(db, revlogId, 'l', NOW + 2)).toThrow();
    expect(() => undo(db, 'gibt-es-nicht', 'l', NOW + 2)).toThrow();
  });

  it('Übersicht enthält Modulstatistik und Serie', () => {
    const { db, mod } = setup('2026-10-30');
    const c = getNext(db, {}, NOW).card!;
    answer(db, { cardId: c.cardId, rating: 4, durationMs: 1, deviceId: 'l', now: NOW });
    const o = getOverview(db, NOW + MIN);
    expect(o.streak).toBe(1);
    expect(o.modules[0]).toMatchObject({ moduleId: mod.id, name: 'UIUX', total: 2, new: 1, review: 1, seenPct: 50, daysToExam: 24 });
  });

  it('Intervall-Vorschau berücksichtigt die Prüfungs-Obergrenze', () => {
    const { db } = setup('2026-10-09');
    const c = getNext(db, {}, NOW).card!;
    answer(db, { cardId: c.cardId, rating: 4, durationMs: 1, deviceId: 'l', now: NOW });
    // nach "Einfach" wäre die Karte > 3 Tage weg, darf aber höchstens bis 08.10. reichen
    const due = repo.studyRows(db).find((r) => r.cardId === c.cardId)!;
    expect(due.state.state).toBe(2);
    const later = getNext(db, { deckId: due.deckId }, new Date('2026-10-08T05:00:00+09:00').getTime());
    expect(later.counts.review).toBe(1);
  });
});
