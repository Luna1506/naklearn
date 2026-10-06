import { describe, expect, it } from 'vitest';
import { applyReview, emptyState, formatInterval, previewIntervals, replay } from '../src/scheduler.ts';
import type { Grade, RevlogEntry } from '../src/types.ts';

const T0 = new Date('2026-10-06T10:00:00+09:00').getTime();
const MIN = 60_000;
const DAY = 86_400_000;

function log(id: string, rating: 0 | Grade, at: number, revokes: string | null = null): RevlogEntry {
  return { id, cardId: 'c', rating, reviewedAt: at, durationMs: 1000, deviceId: 'dev', revokes };
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe('applyReview', () => {
  it('neue Karte: Nochmal → 1 min, Gut → 10 min (Lernschritte)', () => {
    expect(applyReview(emptyState(), 1, T0).due).toBe(T0 + MIN);
    const good = applyReview(emptyState(), 3, T0);
    expect(good.due).toBe(T0 + 10 * MIN);
    expect(good.state).toBe(1);
  });
  it('neue Karte: Einfach → direkt Wiederholung mit ≥ 1 Tag', () => {
    const s = applyReview(emptyState(), 4, T0);
    expect(s.state).toBe(2);
    expect(s.due - T0).toBeGreaterThanOrEqual(DAY);
  });
});

describe('replay', () => {
  it('ist unabhängig von der Ankunftsreihenfolge', () => {
    const r = rng(42);
    for (let run = 0; run < 25; run++) {
      const logs: RevlogEntry[] = [];
      let t = T0;
      for (let i = 0; i < 8; i++) {
        t += Math.floor(r() * 5 * DAY);
        logs.push(log(`l${run}-${i}`, (1 + Math.floor(r() * 4)) as Grade, t));
      }
      const shuffled = [...logs].sort(() => r() - 0.5);
      expect(replay(shuffled)).toEqual(replay(logs));
    }
  });
  it('ignoriert zurückgenommene Bewertungen', () => {
    const a = log('a', 3, T0);
    const b = log('b', 3, T0 + 10 * MIN);
    const undoB = log('u', 0, T0 + 11 * MIN, 'b');
    expect(replay([a, b, undoB])).toEqual(replay([a]));
  });
  it('ohne Einträge ist die Karte neu', () => {
    expect(replay([]).state).toBe(0);
  });
});

describe('previewIntervals', () => {
  it('zeigt die Lernschritte einer neuen Karte', () => {
    const p = previewIntervals(emptyState(), T0);
    expect(p[1]).toBe(MIN);
    expect(p[2]).toBe(6 * MIN);
    expect(p[3]).toBe(10 * MIN);
    expect(p[4]).toBeGreaterThanOrEqual(DAY);
  });
  it('nutzt eine angepasste Fälligkeit, wenn angegeben', () => {
    const p = previewIntervals(emptyState(), T0, () => T0 + 2 * DAY);
    expect(p[3]).toBe(2 * DAY);
  });
});

describe('formatInterval', () => {
  it.each([
    [30_000, '<1m'],
    [10 * MIN, '10m'],
    [3 * 60 * MIN, '3h'],
    [3 * DAY, '3d'],
    [45 * DAY, '1.5mo'],
    [400 * DAY, '1.1y'],
  ])('%i ms → %s', (ms, s) => {
    expect(formatInterval(ms)).toBe(s);
  });
});
