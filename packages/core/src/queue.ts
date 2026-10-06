import { addDays, dayStartMs, daysBetween, studyDay } from './day.ts';
import { effectiveDueMs, newCardLimit } from './exam.ts';
import type { CardState, QueueCounts, Scope } from './types.ts';

export interface QueueCard {
  cardId: string;
  noteId: string;
  deckId: string;
  moduleId: string;
  /** deck.position, note.position, card.ordinal */
  sortKey: [number, number, number];
  state: CardState;
  firstReviewedAt: number | null;
  suspended: boolean;
}

export interface QueueModule {
  id: string;
  examDate: string | null;
  newPerDay: number;
}

export const LEARN_AHEAD_MS = 20 * 60_000;
export const NEW_EVERY = 4;

function examRank(mod: QueueModule, today: string): number {
  if (!mod.examDate) return Number.POSITIVE_INFINITY;
  const d = daysBetween(today, mod.examDate);
  return d > 0 ? d : Number.POSITIVE_INFINITY;
}

function compareKeys(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function inScopeOf(scope: Scope) {
  return (c: QueueCard) =>
    (!scope.moduleId || c.moduleId === scope.moduleId) && (!scope.deckId || c.deckId === scope.deckId);
}

export function buildQueue(
  cards: QueueCard[],
  modules: QueueModule[],
  scope: Scope,
  now: number,
): { learning: QueueCard[]; review: QueueCard[]; fresh: QueueCard[] } {
  const today = studyDay(now);
  const tomorrowStart = dayStartMs(addDays(today, 1));
  const modById = new Map(modules.map((m) => [m.id, m]));
  const active = cards.filter((c) => !c.suspended && modById.has(c.moduleId));

  const reviewedToday = new Map<string, Set<string>>();
  for (const c of active) {
    if (c.state.lastReview !== null && studyDay(c.state.lastReview) === today) {
      const set = reviewedToday.get(c.noteId) ?? new Set<string>();
      set.add(c.cardId);
      reviewedToday.set(c.noteId, set);
    }
  }
  const buried = (c: QueueCard) =>
    (c.state.state === 0 || c.state.state === 2) &&
    [...(reviewedToday.get(c.noteId) ?? [])].some((id) => id !== c.cardId);
  const inScope = inScopeOf(scope);

  const learning = active
    .filter((c) => (c.state.state === 1 || c.state.state === 3) && inScope(c) && c.state.due <= now + LEARN_AHEAD_MS)
    .sort((a, b) => a.state.due - b.state.due);

  const review = active
    .filter((c) => c.state.state === 2 && inScope(c) && !buried(c))
    .map((c) => ({ c, due: effectiveDueMs(c.state, c.cardId, modById.get(c.moduleId)!.examDate, now) }))
    .filter((x) => x.due < tomorrowStart)
    .sort(
      (a, b) =>
        examRank(modById.get(a.c.moduleId)!, today) - examRank(modById.get(b.c.moduleId)!, today) || a.due - b.due,
    )
    .map((x) => x.c);

  const fresh: QueueCard[] = [];
  const sortedModules = [...modules].sort((a, b) => examRank(a, today) - examRank(b, today));
  for (const mod of sortedModules) {
    const modCards = active.filter((c) => c.moduleId === mod.id);
    const remainingNew = modCards.filter((c) => c.state.state === 0).length;
    const introducedToday = modCards.filter(
      (c) => c.firstReviewedAt !== null && studyDay(c.firstReviewedAt) === today,
    ).length;
    const { limit } = newCardLimit({ newPerDay: mod.newPerDay, examDate: mod.examDate, remainingNew, introducedToday, now });
    const candidates = modCards
      .filter((c) => c.state.state === 0 && inScope(c) && !buried(c))
      .sort((a, b) => compareKeys(a.sortKey, b.sortKey));
    fresh.push(...candidates.slice(0, limit));
  }

  return { learning, review, fresh };
}

/**
 * Jede NEW_EVERY-te Karte ist neu: Eine neue Karte kommt dran, sobald heute (im Scope)
 * mindestens (neu_heute + 1) × (NEW_EVERY − 1) Wiederholungen beantwortet wurden.
 * Zustandsbasiert, damit das Muster auch beim Neuaufbau nach jeder Antwort stimmt.
 */
function preferNew(cards: QueueCard[], scope: Scope, now: number): boolean {
  const today = studyDay(now);
  const inScope = inScopeOf(scope);
  let reviewsDone = 0;
  let newDone = 0;
  for (const c of cards) {
    if (!inScope(c) || c.firstReviewedAt === null) continue;
    if (studyDay(c.firstReviewedAt) === today) newDone++;
    else if (c.state.lastReview !== null && studyDay(c.state.lastReview) === today) reviewsDone++;
  }
  return reviewsDone >= (newDone + 1) * (NEW_EVERY - 1);
}

export function nextCard(
  cards: QueueCard[],
  modules: QueueModule[],
  scope: Scope,
  now: number,
): { next: QueueCard | null; counts: QueueCounts } {
  const q = buildQueue(cards, modules, scope, now);
  const dueLearning = q.learning.filter((c) => c.state.due <= now);
  let next: QueueCard | null = dueLearning[0] ?? null;
  if (!next) {
    const takeNew = q.fresh.length > 0 && (q.review.length === 0 || preferNew(cards, scope, now));
    next = (takeNew ? q.fresh[0] : q.review[0]) ?? q.fresh[0] ?? q.learning[0] ?? null;
  }
  return { next, counts: { learning: q.learning.length, review: q.review.length, new: q.fresh.length } };
}
