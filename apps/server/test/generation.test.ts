import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ClaudeRequest, ClaudeResult } from '../src/claude.ts';
import { createWorker, enqueueDeck, listJobs, regenerateDeck, resetRunningJobs, retryJob, sanitizeNote } from '../src/generation.ts';
import * as repo from '../src/repo.ts';
import { memDb } from './helpers.ts';

const PAGES = 5;

/** Fake-Claude: erzeugt pro Folie im Prompt eine qa-Karte, bei Synthese eine Verknüpfungskarte. */
function fakeClaude(script: Partial<Record<number, ClaudeResult>> = {}) {
  const calls: ClaudeRequest[] = [];
  const run = async (req: ClaudeRequest): Promise<ClaudeResult> => {
    calls.push(req);
    const scripted = script[calls.length];
    if (scripted) return scripted;
    if (req.prompt.includes('removeNoteIds')) {
      const ids = [...req.prompt.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]!);
      return { ok: true, output: { notes: [{ kind: 'qa', front: 'Compare A and B', back: 'x', slides: [1, 2], frontImagePage: null, tags: [] }], removeNoteIds: ids.slice(0, 1) } };
    }
    const pages = [...req.prompt.matchAll(/=== Slide (\d+) ===/g)].map((m) => Number(m[1]));
    return { ok: true, output: { notes: pages.map((p) => ({ kind: 'qa', front: `Q${p}`, back: `A${p}`, slides: [p], frontImagePage: null, tags: [] })) } };
  };
  return { run, calls };
}

const fakeRender = async () =>
  Array.from({ length: PAGES }, (_, i) => ({ page: i + 1, text: `Text of slide ${i + 1}`, image: `${i + 1}.jpg` }));

async function setup(script: Partial<Record<number, ClaudeResult>> = {}) {
  const db = memDb();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'kartei-gen-'));
  const mod = repo.createModule(db, { name: 'UIUX', language: 'en' });
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'Ch1', pdfSha256: 'sha' });
  let now = 1_000_000;
  const claude = fakeClaude(script);
  const worker = createWorker({ db, dataDir, runClaude: claude.run, render: fakeRender, now: () => now, chunkSize: 2 });
  const drain = async () => { for (let i = 0; i < 50 && (await worker.tick()); i++); };
  return { db, deck, worker, claude, drain, advance: (ms: number) => (now += ms) };
}

describe('Worker', () => {
  it('rendert, erzeugt pro Abschnitt Karten und führt die Synthese aus', async () => {
    const { db, deck, claude, drain } = await setup();
    enqueueDeck(db, deck.id);
    await drain();
    expect(repo.getDeck(db, deck.id)).toMatchObject({ status: 'ready', pageCount: PAGES, error: null });
    expect(repo.listSlides(db, deck.id)).toHaveLength(PAGES);
    expect(listJobs(db, deck.id).map((j) => j.kind)).toEqual(['render', 'chunk', 'chunk', 'chunk', 'synthesis']);
    expect(claude.calls).toHaveLength(4);
    expect(claude.calls[0]!.addDirs[0]).toContain(path.join('slides', deck.id));
    const fronts = repo.listNotes(db, { deckId: deck.id }).map((n) => n.front);
    // Q1 wurde von der Synthese als Duplikat entfernt, die Verknüpfungskarte kam dazu
    expect(fronts).toEqual(['Q2', 'Q3', 'Q4', 'Q5', 'Compare A and B']);
  });

  it('wiederholt bei ungültigem JSON und gibt nach 3 Versuchen auf', async () => {
    const bad: ClaudeResult = { ok: true, output: { nope: 1 } };
    const { db, deck, drain } = await setup({ 1: bad, 2: bad, 3: bad });
    enqueueDeck(db, deck.id);
    await drain();
    const chunk1 = listJobs(db, deck.id).find((j) => j.kind === 'chunk')!;
    expect(chunk1).toMatchObject({ status: 'failed', attempts: 3 });
    expect(repo.getDeck(db, deck.id)).toMatchObject({ status: 'ready', error: '1 Abschnitt(e) fehlgeschlagen' });
    retryJob(db, chunk1.id);
    await drain();
    expect(listJobs(db, deck.id).find((j) => j.id === chunk1.id)!.status).toBe('done');
    expect(repo.getDeck(db, deck.id)!.error).toBeNull();
  });

  it('pausiert bei fehlendem Login, bis fortgesetzt wird', async () => {
    const { db, deck, worker, drain } = await setup({ 1: { ok: false, kind: 'auth', message: 'Not logged in' } });
    enqueueDeck(db, deck.id);
    await drain();
    expect(worker.status()).toMatchObject({ state: 'paused', pausedUntil: null });
    expect(worker.status().pauseReason).toContain('nicht eingeloggt');
    expect(listJobs(db, deck.id).find((j) => j.kind === 'chunk')!).toMatchObject({ status: 'queued', attempts: 0 });
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

  it('regenerateDeck behält bewertete Karten', async () => {
    const { db, deck, drain } = await setup();
    enqueueDeck(db, deck.id);
    await drain();
    const keep = repo.listNotes(db, { deckId: deck.id })[0]!;
    repo.insertRevlog(db, { id: 'r1', cardId: keep.cards[0]!.id, rating: 3, reviewedAt: 1, durationMs: 1, deviceId: 'x', revokes: null });
    regenerateDeck(db, deck.id);
    expect(repo.listNotes(db, { deckId: deck.id }).map((n) => n.id)).toEqual([keep.id]);
    await drain();
    expect(repo.listNotes(db, { deckId: deck.id }).length).toBeGreaterThan(1);
  });
});

describe('sanitizeNote', () => {
  const base = { kind: 'qa' as const, front: 'F', back: 'B', slides: [2], frontImagePage: null, tags: ['t'] };
  it('verwirft Foliennummern außerhalb des Decks und nutzt die Ersatzfolie', () => {
    expect(sanitizeNote({ ...base, slides: [0, 99] }, 10, 4)!.slideRefs).toEqual([4]);
  });
  it('wandelt Lückentext ohne Lücke in Frage/Antwort um', () => {
    expect(sanitizeNote({ ...base, kind: 'cloze', front: 'ohne Lücke' }, 10, 1)!.kind).toBe('qa');
  });
  it('wandelt Diagramm-Karte ohne gültige Seite in Frage/Antwort um', () => {
    const n = sanitizeNote({ ...base, kind: 'diagram', frontImagePage: 42 }, 10, 1)!;
    expect(n).toMatchObject({ kind: 'qa', frontImagePage: null });
  });
  it('verwirft Karten ohne Inhalt', () => {
    expect(sanitizeNote({ ...base, front: '   ' }, 10, 1)).toBeNull();
  });
});
