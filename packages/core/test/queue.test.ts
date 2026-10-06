import { describe, expect, it } from 'vitest';
import { nextCard, buildQueue, type QueueCard, type QueueModule } from '../src/queue.ts';
import { emptyState } from '../src/scheduler.ts';
import type { CardState } from '../src/types.ts';

const at = (iso: string) => new Date(iso).getTime();
const NOW = at('2026-10-06T10:00:00+09:00');
const MIN = 60_000;
const DAY = 86_400_000;

const mod: QueueModule = { id: 'm1', examDate: null, newPerDay: 20 };

function qc(id: string, patch: Partial<QueueCard> = {}, state: Partial<CardState> = {}): QueueCard {
  return {
    cardId: id, noteId: `n-${id}`, deckId: 'd1', moduleId: 'm1', sortKey: [1, 0, 0],
    state: { ...emptyState(), ...state }, firstReviewedAt: null, suspended: false, ...patch,
  };
}
const learning = (id: string, due: number) => qc(id, { firstReviewedAt: NOW - 5 * MIN }, { state: 1, due, lastReview: NOW - 5 * MIN });
const review = (id: string, due: number, extra: Partial<QueueCard> = {}) =>
  qc(id, { firstReviewedAt: NOW - 10 * DAY, ...extra }, { state: 2, due, lastReview: NOW - 5 * DAY, stability: 5 });
const fresh = (id: string, pos: number, extra: Partial<QueueCard> = {}) => qc(id, { sortKey: [1, pos, 0], ...extra });

describe('nextCard', () => {
  it('zeigt fällige Lernkarten zuerst', () => {
    const cards = [review('r1', NOW - DAY), learning('l1', NOW - MIN), fresh('f1', 1)];
    expect(nextCard(cards, [mod], {}, NOW).next?.cardId).toBe('l1');
  });
  it('mischt jede 4. Karte als neue Karte', () => {
    const cards = [
      ...[1, 2, 3, 4, 5, 6].map((i) => review(`r${i}`, NOW - i * MIN)),
      fresh('f1', 1), fresh('f2', 2),
    ];
    const q = buildQueue(cards, [mod], {}, NOW);
    expect(q.review).toHaveLength(6);
    expect(q.fresh.map((c) => c.cardId)).toEqual(['f1', 'f2']);
    // Reihenfolge prüfen, indem wir jede gezeigte Karte als heute beantwortet markieren
    const order: string[] = [];
    let rest = cards;
    for (let i = 0; i < 8; i++) {
      const n = nextCard(rest, [mod], {}, NOW).next!;
      order.push(n.cardId[0]!);
      rest = rest.map((c) =>
        c.cardId !== n.cardId
          ? c
          : { ...c, firstReviewedAt: c.firstReviewedAt ?? NOW, state: { ...c.state, state: 2, due: NOW + 3 * DAY, lastReview: NOW } },
      );
    }
    expect(order.join('')).toBe('rrrfrrrf');
  });
  it('begrenzt neue Karten auf das Tageskontingent', () => {
    const cards = [
      ...Array.from({ length: 30 }, (_, i) => fresh(`f${i}`, i)),
      ...Array.from({ length: 5 }, (_, i) => review(`x${i}`, NOW + 2 * DAY, { firstReviewedAt: NOW - MIN })),
    ];
    const q = buildQueue(cards, [mod], {}, NOW);
    expect(q.fresh).toHaveLength(15); // 20 − 5 heute eingeführte
    expect(q.fresh[0]!.cardId).toBe('f0');
  });
  it('vergräbt Geschwister einer heute gelernten Note', () => {
    const a = review('a', NOW + 3 * DAY, { noteId: 'n1' });
    a.state.lastReview = NOW - MIN;
    const b = fresh('b', 1, { noteId: 'n1' });
    expect(buildQueue([a, b], [mod], {}, NOW).fresh).toHaveLength(0);
  });
  it('filtert nach Foliensatz', () => {
    const cards = [fresh('f1', 1, { deckId: 'd1' }), fresh('f2', 2, { deckId: 'd2' })];
    expect(buildQueue(cards, [mod], { deckId: 'd2' }, NOW).fresh.map((c) => c.cardId)).toEqual(['f2']);
  });
  it('Learn-ahead: Lernkarte in 15 min wird gezeigt, in 30 min nicht', () => {
    expect(nextCard([learning('l1', NOW + 15 * MIN)], [mod], {}, NOW).next?.cardId).toBe('l1');
    expect(nextCard([learning('l1', NOW + 30 * MIN)], [mod], {}, NOW).next).toBeNull();
  });
  it('Wiederholungen des Moduls mit näherer Prüfung zuerst', () => {
    const near: QueueModule = { id: 'm2', examDate: '2026-10-10', newPerDay: 20 };
    const cards = [review('r1', NOW - 5 * DAY), review('r2', NOW - MIN, { moduleId: 'm2' })];
    expect(nextCard(cards, [mod, near], {}, NOW).next?.cardId).toBe('r2');
  });
  it('lässt pausierte Karten weg und zählt korrekt', () => {
    const cards = [fresh('f1', 1, { suspended: true }), review('r1', NOW - MIN), learning('l1', NOW + 5 * MIN)];
    expect(nextCard(cards, [mod], {}, NOW).counts).toEqual({ learning: 1, review: 1, new: 0 });
  });
  it('nach Mitternacht kein neues Kontingent', () => {
    const lateNight = at('2026-10-07T01:00:00+09:00');
    const introduced = Array.from({ length: 20 }, (_, i) =>
      review(`i${i}`, lateNight + 3 * DAY, { firstReviewedAt: at('2026-10-06T20:00:00+09:00') }),
    );
    const cards = [...introduced, fresh('f1', 1)];
    expect(buildQueue(cards, [mod], {}, lateNight).fresh).toHaveLength(0);
  });
});
