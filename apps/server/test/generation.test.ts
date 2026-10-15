import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ClaudeRequest, ClaudeResult } from '../src/claude.ts';
import {
  applyCardLimits, createWorker, enqueueDeck, enqueueGaps, enqueueMissingTranslations, listJobs, maxCardsFor, regenerateDeck,
  resetRunningJobs, retryJob, sanitizeNote,
} from '../src/generation.ts';
import * as repo from '../src/repo.ts';
import { addUser, memDb } from './helpers.ts';

const PAGES = 6;
const usage = { model: 'm', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.01 };

/** Fake-Claude: Zusammenfassung bzw. pro Folie drei Karten (davon ein Lückentext mit 4 Lücken). */
function fakeClaude(script: Partial<Record<number, ClaudeResult>> = {}) {
  const calls: ClaudeRequest[] = [];
  const run = async (req: ClaudeRequest): Promise<ClaudeResult> => {
    calls.push(req);
    const scripted = script[calls.length];
    if (scripted) return scripted;
    if (JSON.stringify(req.jsonSchema).includes('"summary"')) {
      return { ok: true, output: { summary: `## Summary of ${PAGES} slides` }, usage };
    }
    const notes = [];
    for (let p = 1; p <= PAGES; p++) {
      notes.push({ kind: 'qa', front: `Q${p}a`, back: 'A', slides: [p], frontImagePage: null, tags: [] });
      notes.push({ kind: 'qa', front: `Q${p}b`, back: 'A', slides: [p], frontImagePage: null, tags: [] });
      notes.push({ kind: 'cloze', front: `{{c1::a}} {{c2::b}} {{c3::c}} {{c4::d}} (${p})`, back: '', slides: [p], frontImagePage: null, tags: [] });
    }
    return { ok: true, output: { notes }, usage };
  };
  return { run, calls };
}

const fakeRender = async () =>
  Array.from({ length: PAGES }, (_, i) => ({ page: i + 1, text: i === 2 ? '' : `Text of slide ${i + 1} `.repeat(20), image: `${i + 1}.jpg` }));

async function setup(script: Partial<Record<number, ClaudeResult>> = {}, language: 'en' | 'de' = 'en') {
  const db = memDb();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'naklearn-gen-'));
  const mod = repo.createModule(db, { name: 'CS', language });
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'Week 1', pdfSha256: 'sha' });
  let now = 1_000_000;
  const claude = fakeClaude(script);
  const worker = createWorker({ db, dataDir, runClaude: claude.run, render: fakeRender, now: () => now, summaryModel: 'sonnet', cardsModel: 'opus' });
  const drain = async () => { for (let i = 0; i < 50 && (await worker.tick()); i++); };
  return { db, deck, worker, claude, drain, advance: (ms: number) => (now += ms) };
}

const cardCount = (db: ReturnType<typeof memDb>, deckId: string) =>
  repo.listNotes(db, { deckId }).reduce((s, n) => s + n.cards.length, 0);

describe('Worker: Zusammenfassung → Karten', () => {
  it('fasst mit dem Zusammenfassungs-Modell zusammen und erzeugt Karten mit dem Karten-Modell', async () => {
    const { db, deck, claude, drain } = await setup();
    enqueueDeck(db, deck.id);
    await drain();
    expect(listJobs(db, deck.id).map((j) => j.kind)).toEqual(['render', 'summary', 'cards']);
    expect(claude.calls.map((c) => c.model)).toEqual(['sonnet', 'opus']);
    expect(claude.calls[1]!.prompt).toContain('## Summary of 6 slides');
    expect(repo.getDeck(db, deck.id)).toMatchObject({ status: 'ready', error: null, summary: '## Summary of 6 slides' });
    expect(listJobs(db, deck.id).find((j) => j.kind === 'cards')!.usage).toEqual(usage);
  });

  it('nur textarme Folien werden als Abbildungen angeboten (höchstens 5)', async () => {
    const { db, deck, claude, drain } = await setup();
    enqueueDeck(db, deck.id);
    await drain();
    const figureLines = claude.calls[0]!.prompt.split('\n').filter((l) => l.includes('.jpg'));
    expect(figureLines.length).toBeGreaterThan(0);
    expect(figureLines.length).toBeLessThanOrEqual(5);
    expect(figureLines.some((l) => l.includes('3.jpg'))).toBe(true);
  });

  it('hält höchstens 1,25 Karten pro Folie im Schnitt und 2 pro Folie, Lückentexte mit max. 2 Lücken', async () => {
    const { db, deck, drain } = await setup();
    enqueueDeck(db, deck.id);
    await drain();
    expect(maxCardsFor(PAGES)).toBe(7);
    expect(cardCount(db, deck.id)).toBeLessThanOrEqual(7);
    const perSlide = new Map<number, number>();
    for (const n of repo.listNotes(db, { deckId: deck.id })) {
      perSlide.set(n.slideRefs[0]!, (perSlide.get(n.slideRefs[0]!) ?? 0) + n.cards.length);
      if (n.kind === 'cloze') expect(n.cards.length).toBeLessThanOrEqual(2);
    }
    for (const c of perSlide.values()) expect(c).toBeLessThanOrEqual(2);
  });

  it('wiederholt bei ungültigem JSON und gibt nach 3 Versuchen auf', async () => {
    const bad: ClaudeResult = { ok: true, output: { nope: 1 }, usage: null };
    const { db, deck, drain } = await setup({ 2: bad, 3: bad, 4: bad });
    enqueueDeck(db, deck.id);
    await drain();
    const cards = listJobs(db, deck.id).find((j) => j.kind === 'cards')!;
    expect(cards).toMatchObject({ status: 'failed', attempts: 3 });
    expect(repo.getDeck(db, deck.id)).toMatchObject({ status: 'error', error: 'Kartenerzeugung fehlgeschlagen' });
    retryJob(db, cards.id);
    await drain();
    expect(repo.getDeck(db, deck.id)).toMatchObject({ status: 'ready', error: null });
  });

  it('pausiert bei fehlendem Login, bis fortgesetzt wird', async () => {
    const { db, deck, worker, drain } = await setup({ 1: { ok: false, kind: 'auth', message: 'Not logged in' } });
    enqueueDeck(db, deck.id);
    await drain();
    expect(worker.status()).toMatchObject({ state: 'paused', pausedUntil: null });
    expect(worker.status().pauseReason).toContain('Claude-Token ungültig');
    worker.resume();
    await drain();
    expect(repo.getDeck(db, deck.id)!.status).toBe('ready');
  });

  it('wartet bei Rate-Limit 5 Minuten', async () => {
    const { db, deck, worker, drain, advance } = await setup({ 1: { ok: false, kind: 'rate_limit', message: 'limit' } });
    enqueueDeck(db, deck.id);
    await drain();
    expect(worker.status().state).toBe('paused');
    expect(await worker.tick()).toBe(false);
    advance(300_001);
    await drain();
    expect(repo.getDeck(db, deck.id)!.status).toBe('ready');
  });

  it('setzt laufende Jobs nach Neustart zurück', async () => {
    const { db, deck } = await setup();
    enqueueDeck(db, deck.id);
    db.prepare("UPDATE job SET status = 'running'").run();
    resetRunningJobs(db);
    expect(listJobs(db, deck.id)[0]!.status).toBe('queued');
  });

  it('regenerateDeck behält bewertete Karten – außer bei includeReviewed', async () => {
    const { db, deck, drain } = await setup();
    enqueueDeck(db, deck.id);
    await drain();
    const keep = repo.listNotes(db, { deckId: deck.id })[0]!;
    repo.insertRevlog(db, { id: 'r1', cardId: keep.cards[0]!.id, rating: 3, reviewedAt: 1, durationMs: 1, deviceId: 'x', revokes: null }, addUser(db));
    regenerateDeck(db, deck.id);
    expect(repo.listNotes(db, { deckId: deck.id }).map((n) => n.id)).toEqual([keep.id]);
    expect(repo.getDeck(db, deck.id)!.summary).toBeNull();
    await drain();
    regenerateDeck(db, deck.id, Date.now(), { includeReviewed: true });
    expect(repo.listNotes(db, { deckId: deck.id })).toHaveLength(0);
    expect(listJobs(db, deck.id).map((j) => j.kind)).toEqual(['summary', 'cards']);
  });
});

describe('applyCardLimits', () => {
  const n = (slide: number, kind: 'qa' | 'cloze' = 'qa', front = `F${slide}`) =>
    ({ kind, front, back: '', slideRefs: [slide], frontImagePage: null, tags: [] });
  it('behält die Reihenfolge (Wichtigkeit) bis zur Obergrenze', () => {
    expect(applyCardLimits([n(1), n(2), n(3)], 2).map((x) => x.front)).toEqual(['F1', 'F2']);
  });
  it('höchstens 2 Karten pro Folie, Lücken zählen einzeln', () => {
    const kept = applyCardLimits([n(1), n(1, 'cloze', '{{c1::a}} {{c2::b}}'), n(1), n(2)], 10);
    expect(kept.map((x) => x.front)).toEqual(['F1', 'F1', 'F2']);
  });
});

describe('sanitizeNote', () => {
  const base = { kind: 'qa' as const, front: 'F', back: 'B', slides: [2], frontImagePage: null, tags: ['t'] };
  it('verwirft Foliennummern außerhalb des Decks und nutzt die Ersatzfolie', () => {
    expect(sanitizeNote({ ...base, slides: [0, 99] }, 10, 4)!.slideRefs).toEqual([4]);
  });
  it('wandelt Lückentext ohne Lücke in Frage/Antwort um und kürzt auf 2 Lücken', () => {
    expect(sanitizeNote({ ...base, kind: 'cloze', front: 'ohne Lücke' }, 10, 1)!.kind).toBe('qa');
    expect(sanitizeNote({ ...base, kind: 'cloze', front: '{{c1::a}} {{c2::b}} {{c3::c}}' }, 10, 1)!.front).toBe('{{c1::a}} {{c2::b}} c');
  });
  it('wandelt Diagramm-Karte ohne gültige Seite in Frage/Antwort um', () => {
    expect(sanitizeNote({ ...base, kind: 'diagram', frontImagePage: 42 }, 10, 1)).toMatchObject({ kind: 'qa', frontImagePage: null });
  });
  it('verwirft Karten ohne Inhalt', () => {
    expect(sanitizeNote({ ...base, front: '   ' }, 10, 1)).toBeNull();
  });
});

describe('Worker: fehlende Karten ergänzen', () => {
  const twoOnSlide1: ClaudeResult = {
    ok: true,
    output: { notes: [1, 2].map((i) => ({ kind: 'qa', front: `Alt ${i}`, back: 'A', slides: [1], frontImagePage: null, tags: [] })) },
    usage,
  };

  it('fügt nur hinzu, zählt vorhandene Karten mit und lässt alte Karten samt Lernstand unberührt', async () => {
    const { db, deck, claude, drain } = await setup({ 2: twoOnSlide1 });
    enqueueDeck(db, deck.id);
    await drain();
    const before = repo.listNotes(db, { deckId: deck.id });
    expect(before).toHaveLength(2);
    const userId = addUser(db);
    repo.insertRevlog(db, { id: 'r1', cardId: before[0]!.cards[0]!.id, rating: 3, reviewedAt: 1, durationMs: 1, deviceId: 'x', revokes: null }, userId);

    expect(enqueueGaps(db, deck.id)).toBe(true);
    expect(enqueueGaps(db, deck.id)).toBe(false); // wartet schon
    await drain();

    expect(claude.calls).toHaveLength(3);
    expect(claude.calls[2]!.model).toBe('opus');
    expect(claude.calls[2]!.prompt).toContain('] Alt 1 → A');
    expect(claude.calls[2]!.prompt).toContain('=== Slide 2 ===');
    expect(claude.calls[2]!.prompt).toContain('at most 5 new cards');

    const after = repo.listNotes(db, { deckId: deck.id });
    for (const old of before) expect(after.find((n) => n.id === old.id)).toMatchObject({ front: old.front, back: old.back });
    expect(cardCount(db, deck.id)).toBe(maxCardsFor(PAGES));
    const onSlide1 = after.filter((n) => n.slideRefs[0] === 1).reduce((s, n) => s + n.cards.length, 0);
    expect(onSlide1).toBe(2); // Folie 1 war schon voll
    expect(repo.getDeck(db, deck.id)).toMatchObject({ status: 'ready', error: null });
    expect(listJobs(db, deck.id).at(-1)).toMatchObject({ kind: 'gaps', status: 'done', usage });
    expect(db.prepare('SELECT COUNT(*) AS n FROM revlog').get()).toEqual({ n: 1 });
  });

  it('ruft Claude nicht auf, wenn die Obergrenze schon erreicht ist', async () => {
    const { db, deck, claude, drain } = await setup();
    enqueueDeck(db, deck.id);
    await drain();
    expect(cardCount(db, deck.id)).toBe(maxCardsFor(PAGES));
    enqueueGaps(db, deck.id);
    await drain();
    expect(claude.calls).toHaveLength(2);
    expect(listJobs(db, deck.id).at(-1)).toMatchObject({ kind: 'gaps', status: 'done' });
  });

  it('eine leere Antwort ist ein gültiges Ergebnis', async () => {
    const { db, deck, drain } = await setup({ 2: twoOnSlide1, 3: { ok: true, output: { notes: [] }, usage } });
    enqueueDeck(db, deck.id);
    await drain();
    enqueueGaps(db, deck.id);
    await drain();
    expect(cardCount(db, deck.id)).toBe(2);
    expect(listJobs(db, deck.id).at(-1)).toMatchObject({ kind: 'gaps', status: 'done' });
  });
});

describe('Worker: deutsche Übersetzung', () => {
  const notes2: ClaudeResult = {
    ok: true,
    output: {
      notes: [
        { kind: 'qa', front: 'What is IaaS?', back: 'Infrastructure as a Service', slides: [1], frontImagePage: null, tags: [] },
        { kind: 'cloze', front: '{{c1::Confidentiality}} and {{c2::integrity}}', back: '', slides: [2], frontImagePage: null, tags: [] },
      ],
    },
    usage,
  };
  const translated = (items: { n: number; front: string; back: string }[]): ClaudeResult => ({ ok: true, output: { items }, usage });

  async function generated(script: Partial<Record<number, ClaudeResult>> = {}, language: 'en' | 'de' = 'en') {
    const env = await setup({ 2: notes2, ...script }, language);
    enqueueDeck(env.db, env.deck.id);
    await env.drain();
    env.advance(1000);
    const byFront = (f: string) => repo.listNotes(env.db, { deckId: env.deck.id }).find((n) => n.front.startsWith(f))!;
    return { ...env, byFront };
  }

  it('übersetzt fehlende Karten mit dem Zusammenfassungs-Modell und lässt Lücken gleich', async () => {
    const { db, deck, claude, drain, byFront } = await generated({
      3: translated([
        { n: 1, front: 'Was ist IaaS?', back: 'Infrastruktur als Dienst (Infrastructure as a Service)' },
        { n: 2, front: '{{c1::Vertraulichkeit}} und {{c2::Integrität}}', back: '' },
      ]),
    });
    expect(enqueueMissingTranslations(db, 2_000_000)).toBe(1);
    await drain();
    expect(claude.calls[2]!.model).toBe('sonnet');
    expect(claude.calls[2]!.prompt).toContain('What is IaaS?');
    expect(claude.calls[2]!.prompt).toContain('{{c1::Confidentiality}}');
    expect(byFront('What')).toMatchObject({ frontDe: 'Was ist IaaS?', backDe: 'Infrastruktur als Dienst (Infrastructure as a Service)' });
    expect(byFront('{{c1')).toMatchObject({ frontDe: '{{c1::Vertraulichkeit}} und {{c2::Integrität}}' });
    expect(listJobs(db, deck.id).at(-1)).toMatchObject({ kind: 'translate', status: 'done' });
    expect(repo.getDeck(db, deck.id)).toMatchObject({ status: 'ready' });
  });

  it('schickt nur noch nicht übersetzte Karten', async () => {
    const { db, claude, drain, byFront } = await generated({ 3: translated([{ n: 1, front: 'L', back: '' }]) });
    const qa = byFront('What');
    repo.setNoteTranslation(db, qa.id, qa, { frontDe: 'schon da', backDe: 'ja' });
    enqueueMissingTranslations(db, 2_000_000);
    await drain();
    expect(claude.calls[2]!.prompt).not.toContain('What is IaaS?');
    expect(byFront('What')).toMatchObject({ frontDe: 'schon da' });
  });

  it('verwirft Lückentexte mit anderen Lücken und unbekannte Nummern, stößt danach nicht endlos neu an', async () => {
    const { db, deck, claude, drain, advance, byFront } = await generated({
      3: translated([
        { n: 1, front: 'Was ist IaaS?', back: 'IaaS' },
        { n: 2, front: '{{c1::Vertraulichkeit}} und Integrität', back: '' },
        { n: 9, front: 'gibt es nicht', back: '' },
      ]),
      4: translated([{ n: 1, front: '{{c1::Vertraulichkeit}} und {{c2::Integrität}}', back: '' }]),
    });
    enqueueMissingTranslations(db, 2_000_000);
    await drain();
    expect(byFront('{{c1')).toMatchObject({ frontDe: null });
    expect(enqueueMissingTranslations(db, 3_000_000)).toBe(0); // unverändert → kein neuer Versuch

    advance(5_000_000);
    const cz = byFront('{{c1');
    repo.updateNote(db, cz.id, { back: 'CIA' }, 6_000_000);
    expect(enqueueMissingTranslations(db, 6_000_001)).toBe(1);
    await drain();
    expect(claude.calls).toHaveLength(4);
    expect(byFront('{{c1')).toMatchObject({ frontDe: '{{c1::Vertraulichkeit}} und {{c2::Integrität}}' });
    expect(listJobs(db, deck.id).filter((j) => j.kind === 'translate')).toHaveLength(2);
  });

  it('kein zweiter Job, solange einer wartet; deutsche Module werden nie übersetzt', async () => {
    const en = await generated();
    expect(enqueueMissingTranslations(en.db, 2_000_000)).toBe(1);
    expect(enqueueMissingTranslations(en.db, 2_000_001)).toBe(0);
    const de = await generated({}, 'de');
    expect(enqueueMissingTranslations(de.db, 2_000_000)).toBe(0);
  });

  it('der Worker stößt fehlende Übersetzungen selbst an, wenn er nichts zu tun hat', async () => {
    const { db, deck, worker, claude, advance, byFront } = await generated({ 3: translated([{ n: 1, front: 'Was ist IaaS?', back: 'IaaS' }]) });
    expect(await worker.tick()).toBe(false); // höchstens einmal pro Minute nachsehen
    advance(60_000);
    for (let i = 0; i < 5 && (await worker.tick()); i++);
    expect(claude.calls).toHaveLength(3);
    expect(byFront('What')).toMatchObject({ frontDe: 'Was ist IaaS?' });
    expect(listJobs(db, deck.id).at(-1)).toMatchObject({ kind: 'translate', status: 'done' });
  });
});
