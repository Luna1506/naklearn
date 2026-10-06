import { addDays, daysBetween, studyDay } from './day.ts';
import { newCardLimit } from './exam.ts';
import { buildQueue, type QueueCard, type QueueModule } from './queue.ts';

export interface ModuleStats {
  moduleId: string;
  total: number;
  new: number;
  learning: number;
  review: number;
  seenPct: number;
  dueToday: number;
  daysToExam: number | null;
  newTarget: number;
  warn: boolean;
}

export function moduleStats(cards: QueueCard[], mod: QueueModule, now: number): ModuleStats {
  const mine = cards.filter((c) => c.moduleId === mod.id && !c.suspended);
  const count = (s: number) => mine.filter((c) => c.state.state === s).length;
  const isNew = count(0);
  const learning = count(1) + count(3);
  const review = count(2);
  const q = buildQueue(mine, [mod], { moduleId: mod.id }, now);
  const today = studyDay(now);
  const introducedToday = mine.filter((c) => c.firstReviewedAt !== null && studyDay(c.firstReviewedAt) === today).length;
  const quota = newCardLimit({ newPerDay: mod.newPerDay, examDate: mod.examDate, remainingNew: isNew, introducedToday, now });
  const daysToExam = mod.examDate ? daysBetween(today, mod.examDate) : null;
  return {
    moduleId: mod.id,
    total: mine.length,
    new: isNew,
    learning,
    review,
    seenPct: mine.length ? Math.round(((mine.length - isNew) / mine.length) * 100) : 0,
    dueToday: q.learning.length + q.review.length + q.fresh.length,
    daysToExam: daysToExam !== null && daysToExam >= 0 ? daysToExam : null,
    newTarget: quota.target,
    warn: quota.warn && isNew > 0,
  };
}

export function streak(reviewTimes: number[], now: number): number {
  const days = new Set(reviewTimes.map(studyDay));
  let day = studyDay(now);
  if (!days.has(day)) day = addDays(day, -1);
  let n = 0;
  while (days.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
