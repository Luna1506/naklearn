import { describe, expect, it } from 'vitest';
import { addDays, dayStartMs, studyDay } from '../src/day.ts';
import { effectiveDueMs, hashString, newCardLimit } from '../src/exam.ts';
import { applyReview, emptyState } from '../src/scheduler.ts';
import type { CardState } from '../src/types.ts';

const at = (iso: string) => new Date(iso).getTime();
const NOW = at('2026-10-06T10:00:00+09:00');

function review(due: number, lastReview: number): CardState {
  return { ...emptyState(), state: 2, due, lastReview, stability: 30, reps: 3 };
}

describe('effectiveDueMs', () => {
  const far = review(at('2026-11-15T10:00:00+09:00'), NOW);

  it('ändert ohne Prüfungsdatum nichts', () => {
    expect(effectiveDueMs(far, 'c1', null, NOW)).toBe(far.due);
  });
  it('legt Karten nach der Prüfung auf einen der 3 Tage davor', () => {
    const allowed = ['2026-10-27', '2026-10-28', '2026-10-29'].map(dayStartMs);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const d = effectiveDueMs(far, `card-${i}`, '2026-10-30', NOW);
      expect(allowed).toContain(d);
      seen.add(d);
    }
    expect(seen.size).toBe(3);
    expect(effectiveDueMs(far, 'card-7', '2026-10-30', NOW)).toBe(effectiveDueMs(far, 'card-7', '2026-10-30', NOW));
  });
  it('lässt Karten, die vor der Prüfung fällig sind, unverändert', () => {
    const s = review(at('2026-10-20T10:00:00+09:00'), NOW);
    expect(effectiveDueMs(s, 'c1', '2026-10-30', NOW)).toBe(s.due);
  });
  it('wirkt nicht mehr nach dem Prüfungstag', () => {
    const now = at('2026-10-31T10:00:00+09:00');
    const s = review(at('2026-11-20T10:00:00+09:00'), now);
    expect(effectiveDueMs(s, 'c1', '2026-10-30', now)).toBe(s.due);
  });
  it('zieht eine heute gelernte Karte nie auf heute vor', () => {
    const now = at('2026-10-28T10:00:00+09:00');
    for (let i = 0; i < 30; i++) {
      const s = review(at('2026-11-10T10:00:00+09:00'), now);
      const d = effectiveDueMs(s, `card-${i}`, '2026-10-30', now);
      expect(d === s.due || studyDay(d) > studyDay(now)).toBe(true);
    }
  });
  it('kappt eine Karte nicht erneut, die an oder nach ihrem Puffertag schon gelernt wurde', () => {
    const now = at('2026-10-29T10:00:00+09:00');
    const s = review(at('2026-11-20T10:00:00+09:00'), at('2026-10-27T09:00:00+09:00'));
    // Alle drei Puffertage (27.–29.) liegen am oder vor dem 27. → keine Karte darf wieder fällig werden
    for (let i = 0; i < 30; i++) {
      const id = `card-${i}`;
      const target = ['2026-10-29', '2026-10-28', '2026-10-27'][hashString(id) % 3]!;
      const d = effectiveDueMs(s, id, '2026-10-30', now);
      if (target <= '2026-10-27') expect(d).toBe(s.due);
    }
  });
  it('jede Karte wird im Puffer genau einmal wiederholt – an ihrem eigenen Tag', () => {
    const exam = '2026-10-30';
    const counts = new Map<string, string[]>();
    for (let i = 0; i < 60; i++) {
      const id = `sim-${i}`;
      // reife Karte aufbauen, deren FSRS-Fälligkeit nach der Prüfung liegt
      let s = applyReview(emptyState(), 4, at('2026-09-01T10:00:00+09:00'));
      while (studyDay(s.due) < exam) s = applyReview(s, 3, s.due + 3_600_000);
      const days: string[] = [];
      for (let d = 0; d <= 12; d++) {
        const day = addDays('2026-10-18', d);
        if (day >= exam) break;
        const now = dayStartMs(day) + 6 * 3_600_000;
        if (effectiveDueMs(s, id, exam, now) < dayStartMs(addDays(day, 1))) {
          days.push(day);
          s = applyReview(s, 3, now);
        }
      }
      counts.set(id, days);
    }
    for (const [id, days] of counts) {
      expect(days, id).toHaveLength(1);
      expect(days[0], id).toBe(addDays(exam, -(1 + (hashString(id) % 3))));
    }
  });
  it('lässt die Karte, wenn vor der Prüfung kein Tag mehr frei ist', () => {
    const now = at('2026-10-29T10:00:00+09:00');
    const s = review(at('2026-11-10T10:00:00+09:00'), now);
    expect(effectiveDueMs(s, 'c1', '2026-10-30', now)).toBe(s.due);
  });
  it('ignoriert neue Karten und Lernkarten', () => {
    expect(effectiveDueMs(emptyState(), 'c1', '2026-10-30', NOW)).toBe(emptyState().due);
  });
});

describe('newCardLimit', () => {
  it('ohne Prüfung: eingestellter Wert minus heute eingeführte', () => {
    expect(newCardLimit({ newPerDay: 20, examDate: null, remainingNew: 100, introducedToday: 5, now: NOW })).toEqual({
      limit: 15, target: 20, warn: false,
    });
  });
  it('mit Prüfung: verteilt exakt bis 3 Tage vorher, „pro Tag“ ist kein Mindestwert', () => {
    // 06.10. bis 27.10. = 22 Tage inklusive heute
    const base = { newPerDay: 20, examDate: '2026-10-30', introducedToday: 0, now: NOW };
    expect(newCardLimit({ ...base, remainingNew: 400 }).target).toBe(19);
    expect(newCardLimit({ ...base, remainingNew: 44 }).target).toBe(2);
    expect(newCardLimit({ ...base, remainingNew: 0 }).target).toBe(0);
    expect(newCardLimit({ ...base, remainingNew: 1000 }).target).toBe(46);
    expect(newCardLimit({ ...base, remainingNew: 2000 })).toEqual({ limit: 91, target: 91, warn: true });
  });
  it('mit Prüfung: ein verpasster Tag wird auf die restlichen Tage verteilt', () => {
    // 22 Tage, 220 Karten → 10/Tag; 07.10. ausgelassen → am 08.10. 210 Karten auf 20 Tage
    const base = { newPerDay: 0, examDate: '2026-10-30', introducedToday: 0 };
    expect(newCardLimit({ ...base, remainingNew: 220, now: NOW }).target).toBe(10);
    expect(newCardLimit({ ...base, remainingNew: 210, now: at('2026-10-08T10:00:00+09:00') }).target).toBe(11);
  });
  it('bleibt über den Tag stabil (heute eingeführte zählen zum Gesamtbestand)', () => {
    const base = { newPerDay: 20, examDate: '2026-10-30', now: NOW };
    const morning = newCardLimit({ ...base, remainingNew: 1000, introducedToday: 0 });
    const later = newCardLimit({ ...base, remainingNew: 970, introducedToday: 30 });
    expect(later.target).toBe(morning.target);
    expect(later.limit).toBe(morning.target - 30);
  });
  it('begrenzt auf den Rest', () => {
    expect(newCardLimit({ newPerDay: 20, examDate: null, remainingNew: 3, introducedToday: 0, now: NOW }).limit).toBe(3);
  });
  it('nach Ablauf des Puffers: alles Verbleibende sofort', () => {
    const now = at('2026-10-28T10:00:00+09:00');
    expect(newCardLimit({ newPerDay: 20, examDate: '2026-10-30', remainingNew: 150, introducedToday: 0, now }).target).toBe(150);
  });
  it('nach der Prüfung: normaler Wert', () => {
    const now = at('2026-11-02T10:00:00+09:00');
    expect(newCardLimit({ newPerDay: 20, examDate: '2026-10-30', remainingNew: 500, introducedToday: 0, now }).target).toBe(20);
  });
  it('zählt nach Mitternacht noch zum Vortag (kein neues Kontingent um 00:00)', () => {
    const lateNight = at('2026-10-07T01:30:00+09:00'); // Lerntag 06.10.
    expect(newCardLimit({ newPerDay: 20, examDate: null, remainingNew: 100, introducedToday: 20, now: lateNight }).limit).toBe(0);
  });
});
