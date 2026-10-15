import { describe, expect, it } from 'vitest';
import { moduleStats, streak } from '../src/stats.ts';
import { emptyState } from '../src/scheduler.ts';
import type { QueueCard } from '../src/queue.ts';

const at = (iso: string) => new Date(iso).getTime();
const NOW = at('2026-10-06T10:00:00+09:00');
const DAY = 86_400_000;

function card(id: string, state: 0 | 1 | 2): QueueCard {
  return {
    cardId: id, noteId: id, deckId: 'd', moduleId: 'm', sortKey: [0, 0, 0],
    state: { ...emptyState(), state, due: NOW + DAY, lastReview: state ? NOW - DAY : null },
    firstReviewedAt: state ? NOW - 2 * DAY : null, suspended: false,
  };
}

describe('moduleStats', () => {
  it('zählt Zustände und Anteil gesehener Karten', () => {
    const cards = [card('a', 0), card('b', 0), card('c', 1), card('d', 2)];
    const s = moduleStats(cards, { id: 'm', examDate: '2026-10-30', newPerDay: 20 }, NOW);
    expect(s).toMatchObject({ total: 4, new: 2, learning: 1, review: 1, seenPct: 50, daysToExam: 24 });
    expect(s.dueToday).toBe(1); // 2 neue auf 22 Tage → 1 heute, Lern-/Wiederholungskarte erst morgen
  });
});

describe('streak', () => {
  const d = (n: number) => NOW - n * DAY;
  it('zählt aufeinanderfolgende Tage bis heute', () => {
    expect(streak([d(0), d(1), d(1), d(2)], NOW)).toBe(3);
  });
  it('zählt bis gestern, wenn heute noch nichts gelernt wurde', () => {
    expect(streak([d(1), d(2)], NOW)).toBe(2);
  });
  it('ist 0 nach einer Lücke', () => {
    expect(streak([d(3)], NOW)).toBe(0);
  });
});
