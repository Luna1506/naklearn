import {
  effectiveDueMs, effectiveLogs, formatInterval, moduleStats, newId, nextCard, previewIntervals, replay,
  streak, studyDay, toStudyCard,
  type Grade, type Language, type ModuleStats, type QueueCounts, type QueueModule, type Scope, type StudyCard,
} from '@naklearn/core';
import { tx, type Db } from './db.ts';
import * as repo from './repo.ts';

function queueModules(db: Db, userId: string): QueueModule[] {
  return repo.listMyModules(db, userId).map((m) => ({ id: m.id, examDate: m.examDate, newPerDay: m.newPerDay }));
}

export function getNext(db: Db, userId: string, scope: Scope, now: number): { card: StudyCard | null; counts: QueueCounts } {
  const mods = repo.listMyModules(db, userId);
  const { next, counts } = nextCard(repo.studyRows(db, userId), queueModules(db, userId), scope, now);
  if (!next) return { card: null, counts };
  const note = repo.getNote(db, next.noteId)!;
  const card = repo.getCard(db, next.cardId)!;
  const deck = repo.getDeck(db, next.deckId)!;
  const mod = mods.find((m) => m.id === next.moduleId)!;
  const raw = previewIntervals(next.state, now, (s) => effectiveDueMs(s, next.cardId, mod.examDate, now));
  const intervals = {
    1: formatInterval(raw[1]), 2: formatInterval(raw[2]), 3: formatInterval(raw[3]), 4: formatInterval(raw[4]),
  };
  return { card: toStudyCard({ note, card, moduleName: mod.name, deckTitle: deck.title, intervals }), counts };
}

export function recomputeCard(db: Db, userId: string, cardId: string): void {
  const logs = repo.listRevlogForCard(db, userId, cardId);
  const first = effectiveLogs(logs)[0]?.reviewedAt ?? null;
  repo.saveCardState(db, userId, cardId, replay(logs), first);
}

export function answer(
  db: Db,
  i: { userId: string; cardId: string; rating: Grade; durationMs: number; deviceId: string; now: number },
): { revlogId: string } {
  if (!repo.getCard(db, i.cardId)) throw new Error(`Karte ${i.cardId} nicht gefunden`);
  const id = newId();
  tx(db, () => {
    repo.insertRevlog(db, {
      id, cardId: i.cardId, rating: i.rating, reviewedAt: i.now, durationMs: Math.max(0, Math.round(i.durationMs)),
      deviceId: i.deviceId, revokes: null,
    }, i.userId);
    recomputeCard(db, i.userId, i.cardId);
  });
  return { revlogId: id };
}

export function undo(db: Db, userId: string, revlogId: string, deviceId: string, now: number): void {
  const target = repo.getRevlog(db, revlogId);
  if (!target || target.revokes !== null || repo.revlogOwner(db, revlogId) !== userId) throw new Error('Bewertung nicht gefunden');
  const already = db.prepare('SELECT 1 FROM revlog WHERE revokes = ? AND user_id = ?').get(revlogId, userId);
  if (already) throw new Error('Bewertung wurde bereits zurückgenommen');
  tx(db, () => {
    repo.insertRevlog(db, { id: newId(), cardId: target.cardId, rating: 0, reviewedAt: now, durationMs: 0, deviceId, revokes: revlogId }, userId);
    recomputeCard(db, userId, target.cardId);
  });
}

export interface Overview {
  studiedToday: number;
  streak: number;
  modules: (ModuleStats & { name: string; language: Language; examDate: string | null; newPerDay: number })[];
}

export function getOverview(db: Db, userId: string, now: number): Overview {
  const times = repo.allReviewTimes(db, userId);
  const today = studyDay(now);
  const rows = repo.studyRows(db, userId);
  return {
    studiedToday: times.filter((t) => studyDay(t) === today).length,
    streak: streak(times, now),
    modules: repo.listMyModules(db, userId).map((m) => ({
      ...moduleStats(rows, { id: m.id, examDate: m.examDate, newPerDay: m.newPerDay }, now),
      name: m.name,
      language: m.language,
      examDate: m.examDate,
      newPerDay: m.newPerDay,
    })),
  };
}
