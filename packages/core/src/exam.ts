import { addDays, dayStartMs, daysBetween, studyDay } from './day.ts';
import type { CardState } from './types.ts';

export const EXAM_BUFFER_DAYS = 3;
export const NEW_PER_DAY_WARN = 60;

/** FNV-1a, 32 Bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Fälligkeit unter Berücksichtigung des Prüfungsdatums: Wiederholungskarten, die erst
 * am Prüfungstag oder danach fällig wären, landen auf einem der 3 Tage davor.
 */
export function effectiveDueMs(state: CardState, cardId: string, examDate: string | null, now: number): number {
  if (!examDate || state.state !== 2) return state.due;
  const today = studyDay(now);
  if (daysBetween(today, examDate) <= 0) return state.due;
  if (studyDay(state.due) < examDate) return state.due;

  let target = addDays(examDate, -(1 + (hashString(cardId) % EXAM_BUFFER_DAYS)));
  if (state.lastReview !== null) {
    const earliest = addDays(studyDay(state.lastReview), 1);
    if (target < earliest) target = earliest;
  }
  if (target >= examDate) return state.due;
  return dayStartMs(target);
}

export function newCardLimit(o: {
  newPerDay: number;
  examDate: string | null;
  remainingNew: number;
  introducedToday: number;
  now: number;
}): { limit: number; target: number; warn: boolean } {
  let target = o.newPerDay;
  if (o.examDate) {
    const today = studyDay(o.now);
    if (daysBetween(today, o.examDate) > 0) {
      const deadline = addDays(o.examDate, -EXAM_BUFFER_DAYS);
      const days = Math.max(1, daysBetween(today, deadline) + 1);
      target = Math.max(o.newPerDay, Math.ceil((o.remainingNew + o.introducedToday) / days));
    }
  }
  const limit = Math.max(0, Math.min(o.remainingNew, target - o.introducedToday));
  return { limit, target, warn: target > NEW_PER_DAY_WARN };
}
