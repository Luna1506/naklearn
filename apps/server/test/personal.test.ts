import { emptyPush } from '@naklearn/core';
import { describe, expect, it } from 'vitest';
import * as repo from '../src/repo.ts';
import { answer, getNext, getOverview, undo } from '../src/study.ts';
import { applyPush } from '../src/sync.ts';
import { addUser, memDb } from './helpers.ts';

const NOW = new Date('2026-10-21T10:00:00+09:00').getTime();

function setup() {
  const db = memDb();
  const luna = addUser(db, 'luna');
  const mia = addUser(db, 'mia');
  const mod = repo.createModule(db, { name: 'Cloud Security', language: 'en', examDate: '2026-11-20', createdBy: luna }, 1);
  repo.joinModule(db, mia, mod.id, 2);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' }, 1);
  const base = { deckId: deck.id, back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk' as const };
  const n1 = repo.insertNote(db, { ...base, kind: 'qa', front: 'Q1', position: 1 }, 1);
  repo.insertNote(db, { ...base, kind: 'qa', front: 'Q2', position: 2 }, 1);
  return { db, luna, mia, mod, deck, cardId: n1.cards[0]!.id };
}

describe('persönlicher Lernstand', () => {
  it('Bewertungen von Luna ändern nichts bei Mia', () => {
    const { db, luna, mia, cardId } = setup();
    answer(db, { userId: luna, cardId, rating: 4, durationMs: 1, deviceId: 'web', now: NOW });
    // Luna: Prüfung in 30 Tagen, 2 Karten → 1 neue pro Tag, heute schon gelernt. Mia: kein Datum → beide neu
    expect(getNext(db, luna, {}, NOW).counts).toEqual({ learning: 0, review: 0, new: 0 });
    expect(getNext(db, mia, {}, NOW).counts).toEqual({ learning: 0, review: 0, new: 2 });
    expect(getOverview(db, luna, NOW).studiedToday).toBe(1);
    expect(getOverview(db, mia, NOW).studiedToday).toBe(0);
    expect(repo.studyRows(db, mia).find((r) => r.cardId === cardId)!.state.reps).toBe(0);
  });

  it('fremde Bewertung lässt sich nicht zurücknehmen', () => {
    const { db, luna, mia, cardId } = setup();
    const { revlogId } = answer(db, { userId: luna, cardId, rating: 3, durationMs: 1, deviceId: 'web', now: NOW });
    expect(() => undo(db, mia, revlogId, 'web', NOW)).toThrow(/nicht gefunden/);
    undo(db, luna, revlogId, 'web', NOW);
  });

  it('fremde Bewertung lässt sich auch nicht per Sync-Push zurücknehmen', () => {
    const { db, luna, mia, cardId } = setup();
    const { revlogId } = answer(db, { userId: luna, cardId, rating: 3, durationMs: 1, deviceId: 'web', now: NOW });
    const e = { id: 'x', cardId, rating: 0 as const, reviewedAt: NOW, durationMs: 0, deviceId: 'mia-phone', revokes: revlogId };
    applyPush(db, mia, { ...emptyPush(), revlog: [e] });
    expect(repo.revlogOwner(db, 'x')).toBeNull();
    expect(getOverview(db, luna, NOW).studiedToday).toBe(1);
    undo(db, luna, revlogId, 'web', NOW);
  });

  it('Prüfungsdatum, neue Karten pro Tag und Zurückstellen sind persönlich', () => {
    const { db, luna, mia, mod, cardId } = setup();
    repo.updateMembership(db, mia, mod.id, { examDate: '2026-12-01', newPerDay: 5 }, 3);
    expect(repo.getMyModule(db, luna, mod.id)).toMatchObject({ examDate: '2026-11-20', newPerDay: 20 });
    expect(repo.getMyModule(db, mia, mod.id)).toMatchObject({ examDate: '2026-12-01', newPerDay: 5 });
    repo.setCardFlag(db, mia, cardId, true, 4);
    expect(repo.studyRows(db, mia).find((r) => r.cardId === cardId)!.suspended).toBe(true);
    expect(repo.studyRows(db, luna).find((r) => r.cardId === cardId)!.suspended).toBe(false);
  });

  it('Übersicht und Lernen nur mit eigenen Modulen', () => {
    const { db, luna, mia } = setup();
    repo.createModule(db, { name: 'Nur Mia', language: 'de', createdBy: mia }, 5);
    expect(getOverview(db, luna, NOW).modules.map((m) => m.name)).toEqual(['Cloud Security']);
    expect(getOverview(db, mia, NOW).modules.map((m) => m.name)).toEqual(['Cloud Security', 'Nur Mia']);
  });
});

describe('Modulauswahl', () => {
  it('alle Module mit Anzahl und eigener Auswahl; Beitreten und Verlassen', () => {
    const { db, luna, mia, mod } = setup();
    const other = repo.createModule(db, { name: 'UI/UX', language: 'en', createdBy: mia }, 5);
    expect(repo.listAllModules(db, luna)).toEqual([
      { id: mod.id, name: 'Cloud Security', language: 'en', memberCount: 2, mine: true },
      { id: other.id, name: 'UI/UX', language: 'en', memberCount: 1, mine: false },
    ]);
    repo.joinModule(db, luna, other.id, 6);
    repo.joinModule(db, luna, other.id, 7);
    expect(repo.memberIds(db, other.id).sort()).toEqual([luna, mia].sort());
    repo.leaveModule(db, luna, mod.id);
    expect(repo.listMyModules(db, luna).map((m) => m.name)).toEqual(['UI/UX']);
  });

  it('Beitreten nummeriert den Modulinhalt neu, damit Geräte ihn nachladen', () => {
    const { db, luna, deck } = setup();
    const other = repo.createModule(db, { name: 'Neu', language: 'en' }, 5);
    const d2 = repo.createDeck(db, { moduleId: other.id, title: 'D2', pdfSha256: 't' }, 5);
    const seqBefore = (db.prepare('SELECT seq FROM deck WHERE id = ?').get(d2.id) as { seq: number }).seq;
    repo.joinModule(db, luna, other.id, 6);
    expect((db.prepare('SELECT seq FROM deck WHERE id = ?').get(d2.id) as { seq: number }).seq).toBeGreaterThan(seqBefore);
    const lunaDeckSeq = (db.prepare('SELECT seq FROM deck WHERE id = ?').get(deck.id) as { seq: number }).seq;
    expect(lunaDeckSeq).toBeLessThan(seqBefore);
  });
});
