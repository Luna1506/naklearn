import { describe, expect, it } from 'vitest';
import { addDays, dayStartMs, daysBetween, studyDay } from '../src/day.ts';

describe('studyDay (TZ=Asia/Seoul, Tageswechsel 04:00)', () => {
  it('zählt 03:59 zum Vortag', () => {
    expect(studyDay(new Date('2026-10-06T03:59:00+09:00').getTime())).toBe('2026-10-05');
  });
  it('beginnt um 04:00 den neuen Tag', () => {
    expect(studyDay(new Date('2026-10-06T04:00:00+09:00').getTime())).toBe('2026-10-06');
  });
  it('dayStartMs liefert 04:00 lokale Zeit', () => {
    expect(dayStartMs('2026-10-06')).toBe(new Date('2026-10-06T04:00:00+09:00').getTime());
  });
  it('addDays über Monats- und Jahresgrenzen', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('daysBetween', () => {
    expect(daysBetween('2026-10-06', '2026-10-20')).toBe(14);
    expect(daysBetween('2026-10-20', '2026-10-06')).toBe(-14);
  });
});
