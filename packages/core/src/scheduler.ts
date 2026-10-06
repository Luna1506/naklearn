import { createEmptyCard, fsrs, generatorParameters, type Card as FsrsCard, type Grade as FsrsGrade } from 'ts-fsrs';
import type { CardState, FsrsStateCode, Grade, RevlogEntry } from './types.ts';

const scheduler = fsrs(
  generatorParameters({
    request_retention: 0.9,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m'],
  }),
);

function toFsrs(s: CardState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    reps: s.reps,
    lapses: s.lapses,
    learning_steps: s.learningSteps,
    state: s.state,
    last_review: s.lastReview === null ? undefined : new Date(s.lastReview),
  } as FsrsCard;
}

function fromFsrs(c: FsrsCard): CardState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    learningSteps: c.learning_steps,
    state: c.state as FsrsStateCode,
    lastReview: c.last_review ? c.last_review.getTime() : null,
  };
}

export function emptyState(): CardState {
  return fromFsrs(createEmptyCard(new Date(0)));
}

export function applyReview(s: CardState, grade: Grade, at: number): CardState {
  return fromFsrs(scheduler.next(toFsrs(s), new Date(at), grade as FsrsGrade).card);
}

/** Gültige Bewertungen (ohne Rücknahmen und Zurückgenommenes), deterministisch sortiert. */
export function effectiveLogs(logs: RevlogEntry[]): RevlogEntry[] {
  const revoked = new Set(logs.filter((l) => l.revokes !== null).map((l) => l.revokes));
  return logs
    .filter((l) => l.revokes === null && l.rating >= 1 && !revoked.has(l.id))
    .sort((a, b) => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function replay(logs: RevlogEntry[]): CardState {
  return effectiveLogs(logs).reduce((s, l) => applyReview(s, l.rating as Grade, l.reviewedAt), emptyState());
}

export function previewIntervals(
  s: CardState,
  now: number,
  dueOf: (next: CardState) => number = (next) => next.due,
): Record<Grade, number> {
  const out = {} as Record<Grade, number>;
  for (const g of [1, 2, 3, 4] as const) out[g] = dueOf(applyReview(s, g, now)) - now;
  return out;
}

export function formatInterval(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30).toFixed(1)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
