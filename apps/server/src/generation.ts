import {
  CardsOutputSchema, SummaryOutputSchema, clozeOrdinals, limitClozeGaps, newId,
  type GeneratedNote, type NoteKind,
} from '@naklearn/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClaudeResult, ClaudeUsage, RunClaude } from './claude.ts';
import { tx, type Db } from './db.ts';
import { renderPdf, type RenderedSlide } from './pdf.ts';
import { buildCardsPrompt, buildGapsPrompt, buildSummaryPrompt, cardsJsonSchema, pickFigurePages, summaryJsonSchema } from './prompt.ts';
import * as repo from './repo.ts';

export const MAX_ATTEMPTS = 3;
export const RATE_LIMIT_BACKOFF_MS = [300_000, 900_000, 3_600_000];
/** Höchstens so viele Karten pro Folie im Schnitt bzw. zu einer einzelnen Folie. */
export const CARDS_PER_SLIDE = 1.25;
export const MAX_CARDS_PER_SLIDE = 2;
export const MAX_CLOZE_GAPS = 2;
export const MAX_FIGURES = 5;

export interface Job {
  id: string;
  deckId: string;
  /** 'gaps' ergänzt fehlende Karten. 'chunk'/'synthesis' stammen aus dem alten Verfahren und werden nicht mehr ausgeführt. */
  kind: 'render' | 'summary' | 'cards' | 'gaps' | 'chunk' | 'synthesis';
  chunkFrom: number | null;
  chunkTo: number | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  error: string | null;
  usage: ClaudeUsage | null;
  createdAt: number;
}

export interface WorkerStatus {
  state: 'idle' | 'running' | 'paused';
  pauseReason: string | null;
  pausedUntil: number | null;
  current: { jobId: string; deckId: string; kind: Job['kind'] } | null;
  queued: number;
}

export interface Worker {
  tick(): Promise<boolean>;
  start(): void;
  stop(): Promise<void>;
  status(): WorkerStatus;
  resume(): void;
  wake(): void;
}

type Row = Record<string, any>;

const toJob = (r: Row): Job => ({
  id: r.id, deckId: r.deck_id, kind: r.kind, chunkFrom: r.chunk_from ?? null, chunkTo: r.chunk_to ?? null,
  status: r.status, attempts: r.attempts, error: r.error ?? null,
  usage: r.usage_json ? JSON.parse(r.usage_json) : null, createdAt: r.created_at,
});

function insertJob(db: Db, deckId: string, kind: Job['kind'], now: number): void {
  db.prepare("INSERT INTO job (id, deck_id, kind, status, created_at) VALUES (?, ?, ?, 'queued', ?)").run(newId(), deckId, kind, now);
}

function insertGenerationJobs(db: Db, deckId: string, now: number): void {
  insertJob(db, deckId, 'summary', now);
  insertJob(db, deckId, 'cards', now);
}

export function listJobs(db: Db, deckId: string): Job[] {
  return (db.prepare('SELECT * FROM job WHERE deck_id = ? ORDER BY rowid').all(deckId) as Row[]).map(toJob);
}

export function enqueueDeck(db: Db, deckId: string, now = Date.now()): void {
  tx(db, () => {
    insertJob(db, deckId, 'render', now);
    repo.updateDeck(db, deckId, { status: 'pending', error: null }, now);
  });
}

/** Erzeugt Zusammenfassung und Karten neu; bewertete Karten bleiben, außer bei `includeReviewed`. */
export function regenerateDeck(db: Db, deckId: string, now = Date.now(), opts: { includeReviewed?: boolean } = {}): void {
  tx(db, () => {
    const ids = opts.includeReviewed
      ? repo.listNotes(db, { deckId, limit: 100_000 }).map((n) => n.id)
      : repo.unreviewedNoteIds(db, deckId);
    for (const id of ids) repo.deleteNote(db, id, now);
    db.prepare("DELETE FROM job WHERE deck_id = ? AND status IN ('queued', 'failed', 'done')").run(deckId);
    const deck = repo.getDeck(db, deckId)!;
    if (deck.pageCount > 0) {
      insertGenerationJobs(db, deckId, now);
      repo.updateDeck(db, deckId, { status: 'generating', error: null, summary: null }, now);
    } else {
      insertJob(db, deckId, 'render', now);
      repo.updateDeck(db, deckId, { status: 'pending', error: null, summary: null }, now);
    }
  });
}

/** Lässt fehlende Karten ergänzen; vorhandene bleiben unverändert. Kein zweiter Job, solange einer wartet. */
export function enqueueGaps(db: Db, deckId: string, now = Date.now()): boolean {
  const pending = db.prepare("SELECT 1 FROM job WHERE deck_id = ? AND kind = 'gaps' AND status IN ('queued', 'running')").get(deckId);
  if (pending) return false;
  insertJob(db, deckId, 'gaps', now);
  return true;
}

export function retryJob(db: Db, jobId: string): void {
  const r = db.prepare('SELECT * FROM job WHERE id = ?').get(jobId) as Row | undefined;
  if (!r) throw new Error(`Job ${jobId} nicht gefunden`);
  db.prepare("UPDATE job SET status = 'queued', attempts = 0, error = NULL WHERE id = ?").run(jobId);
  if (r.kind !== 'gaps') repo.updateDeck(db, r.deck_id, { status: r.kind === 'render' ? 'pending' : 'generating', error: null });
}

export function resetRunningJobs(db: Db): void {
  db.prepare("UPDATE job SET status = 'queued' WHERE status = 'running'").run();
}

export const maxCardsFor = (pageCount: number) => Math.max(3, Math.floor(pageCount * CARDS_PER_SLIDE));

export interface CleanNote {
  kind: NoteKind;
  front: string;
  back: string;
  slideRefs: number[];
  frontImagePage: number | null;
  tags: string[];
}

/** Bereinigt eine von Claude erzeugte Note; null = verwerfen. */
export function sanitizeNote(n: GeneratedNote, pageCount: number, fallbackPage: number): CleanNote | null {
  let front = n.front.trim();
  if (!front) return null;
  const valid = (p: number) => Number.isInteger(p) && p >= 1 && p <= pageCount;
  const slides = [...new Set(n.slides.filter(valid))];
  let kind: NoteKind = n.kind;
  let frontImagePage = n.frontImagePage;
  if (kind === 'cloze' && clozeOrdinals(front).length === 0) kind = 'qa';
  if (kind === 'cloze') front = limitClozeGaps(front, MAX_CLOZE_GAPS);
  if (kind === 'diagram' && (frontImagePage === null || !valid(frontImagePage))) kind = 'qa';
  if (kind !== 'diagram') frontImagePage = null;
  return {
    kind,
    front,
    back: n.back.trim(),
    slideRefs: slides.length ? slides : [fallbackPage],
    frontImagePage,
    tags: n.tags.slice(0, 5),
  };
}

const cardsOf = (n: { kind: NoteKind; front: string }) => (n.kind === 'cloze' ? clozeOrdinals(n.front).length : 1);

/**
 * Behält Notes in der gelieferten Reihenfolge (Wichtigkeit), solange Gesamt- und Pro-Folie-Grenze halten.
 * `existing` zählt bereits vorhandene Karten mit (Ergänzen von Lücken).
 */
export function applyCardLimits<T extends { kind: NoteKind; front: string; slideRefs: number[] }>(
  notes: T[],
  maxCards: number,
  perSlide = MAX_CARDS_PER_SLIDE,
  existing: { cards: number; slide: number }[] = [],
): T[] {
  const kept: T[] = [];
  const bySlide = new Map<number, number>();
  for (const e of existing) bySlide.set(e.slide, (bySlide.get(e.slide) ?? 0) + e.cards);
  let total = existing.reduce((s, e) => s + e.cards, 0);
  for (const n of notes) {
    const count = cardsOf(n);
    const slide = n.slideRefs[0]!;
    const onSlide = bySlide.get(slide) ?? 0;
    if (total + count > maxCards || onSlide + count > perSlide) continue;
    kept.push(n);
    total += count;
    bySlide.set(slide, onSlide + count);
  }
  return kept;
}

export function createWorker(deps: {
  db: Db;
  dataDir: string;
  runClaude: RunClaude;
  render?: (pdf: string, out: string) => Promise<RenderedSlide[]>;
  now?: () => number;
  /** Modell für die Zusammenfassung (z. B. "sonnet"), null = Standard des Accounts. */
  summaryModel?: string | null;
  /** Modell für die Kartenerzeugung (z. B. "opus"), null = Standard des Accounts. */
  cardsModel?: string | null;
}): Worker {
  const { db, dataDir, runClaude } = deps;
  const render = deps.render ?? renderPdf;
  const now = deps.now ?? Date.now;
  const summaryModel = deps.summaryModel ?? null;
  const cardsModel = deps.cardsModel ?? null;

  let paused = false;
  let pauseReason: string | null = null;
  let pausedUntil: number | null = null;
  let rateStrikes = 0;
  let current: WorkerStatus['current'] = null;
  let stopped = true;
  let loopDone: Promise<void> = Promise.resolve();
  let wakeUp: (() => void) | null = null;

  const slidesDir = (deckId: string) => path.join(dataDir, 'slides', deckId);

  function pause(reason: string, until: number | null) {
    paused = true;
    pauseReason = reason;
    pausedUntil = until;
  }

  function finalizeDeck(deckId: string) {
    const jobs = listJobs(db, deckId);
    if (jobs.some((j) => j.status === 'queued' || j.status === 'running')) return;
    const summary = jobs.find((j) => j.kind === 'summary');
    const cards = jobs.find((j) => j.kind === 'cards');
    if (cards?.status === 'done') {
      repo.updateDeck(db, deckId, { status: 'ready', error: null }, now());
    } else if (summary?.status === 'failed') {
      repo.updateDeck(db, deckId, { status: 'error', error: 'Zusammenfassung fehlgeschlagen' }, now());
    } else if (cards?.status === 'failed') {
      repo.updateDeck(db, deckId, { status: 'error', error: 'Kartenerzeugung fehlgeschlagen' }, now());
    }
  }

  function setJob(id: string, fields: { status: Job['status']; attempts?: number; error?: string | null; usage?: ClaudeUsage | null }) {
    db.prepare('UPDATE job SET status = ?, attempts = COALESCE(?, attempts), error = ?, usage_json = COALESCE(?, usage_json) WHERE id = ?')
      .run(fields.status, fields.attempts ?? null, fields.error ?? null, fields.usage ? JSON.stringify(fields.usage) : null, id);
  }

  /** Gemeinsame Fehlerbehandlung für Claude-Jobs. */
  function handleFailure(job: Job, r: Extract<ClaudeResult, { ok: false }>) {
    if (r.kind === 'auth') {
      setJob(job.id, { status: 'queued', error: r.message });
      pause('Claude-Token ungültig oder abgelaufen – am Laptop `claude setup-token` ausführen, Token in `~/naklearn/.env` auf torte eintragen, `docker compose up -d`, dann „Fortsetzen“.', null);
      return;
    }
    if (r.kind === 'rate_limit') {
      setJob(job.id, { status: 'queued', error: r.message });
      const wait = RATE_LIMIT_BACKOFF_MS[Math.min(rateStrikes, RATE_LIMIT_BACKOFF_MS.length - 1)]!;
      rateStrikes++;
      pause(`Rate-Limit erreicht – neuer Versuch in ${Math.round(wait / 60_000)} min.`, now() + wait);
      return;
    }
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      setJob(job.id, { status: 'failed', attempts, error: r.message });
      finalizeDeck(job.deckId);
    } else {
      setJob(job.id, { status: 'queued', attempts, error: r.message });
    }
  }

  async function callClaude(prompt: string, jsonSchema: object, deckId: string, model: string | null): Promise<ClaudeResult> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'naklearn-claude-'));
    try {
      return await runClaude({ prompt, jsonSchema, addDirs: [slidesDir(deckId)], cwd, model });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }

  function figuresOf(deckId: string, slides: { page: number; text: string; image: string }[]) {
    const pages = pickFigurePages(slides, MAX_FIGURES);
    return slides.filter((s) => pages.includes(s.page)).map((s) => ({ page: s.page, imagePath: path.join(slidesDir(deckId), s.image) }));
  }

  async function doRender(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    if (!deck) return setJob(job.id, { status: 'failed', error: 'Foliensatz gelöscht' });
    repo.updateDeck(db, deck.id, { status: 'rendering' }, now());
    try {
      const slides = await render(path.join(dataDir, 'pdfs', `${deck.pdfSha256}.pdf`), slidesDir(deck.id));
      tx(db, () => {
        repo.replaceSlides(db, deck.id, slides.map((s) => ({ deckId: deck.id, ...s })));
        repo.updateDeck(db, deck.id, { pageCount: slides.length, status: 'generating', error: null, summary: null }, now());
        insertGenerationJobs(db, deck.id, now());
        setJob(job.id, { status: 'done' });
      });
    } catch (e) {
      setJob(job.id, { status: 'failed', attempts: job.attempts + 1, error: String(e) });
      repo.updateDeck(db, deck.id, { status: 'error', error: `PDF konnte nicht gelesen werden: ${String(e).slice(0, 300)}` }, now());
    }
  }

  async function doSummary(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    const mod = deck && repo.getModule(db, deck.moduleId);
    if (!deck || !mod) return setJob(job.id, { status: 'failed', error: 'Foliensatz oder Modul gelöscht' });
    const slides = repo.listSlides(db, deck.id);
    const prompt = buildSummaryPrompt({ language: mod.language, deckTitle: deck.title, slides, figures: figuresOf(deck.id, slides) });
    const r = await callClaude(prompt, summaryJsonSchema, deck.id, summaryModel);
    if (!r.ok) return handleFailure(job, r);
    const parsed = SummaryOutputSchema.safeParse(r.output);
    if (!parsed.success) return handleFailure(job, { ok: false, kind: 'invalid', message: 'Antwort passt nicht zum Schema' });
    rateStrikes = 0;
    tx(db, () => {
      repo.updateDeck(db, deck.id, { summary: parsed.data.summary }, now());
      setJob(job.id, { status: 'done', attempts: job.attempts + 1, usage: r.usage });
    });
  }

  async function doCards(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    const mod = deck && repo.getModule(db, deck.moduleId);
    if (!deck || !mod) return setJob(job.id, { status: 'failed', error: 'Foliensatz oder Modul gelöscht' });
    if (!deck.summary) {
      setJob(job.id, { status: 'failed', error: 'Zusammenfassung fehlt' });
      return finalizeDeck(deck.id);
    }
    const slides = repo.listSlides(db, deck.id);
    const maxCards = maxCardsFor(deck.pageCount);
    const prompt = buildCardsPrompt({
      language: mod.language,
      deckTitle: deck.title,
      summary: deck.summary,
      slides,
      maxCards,
      figures: figuresOf(deck.id, slides),
    });
    const r = await callClaude(prompt, cardsJsonSchema, deck.id, cardsModel);
    if (!r.ok) return handleFailure(job, r);
    const parsed = CardsOutputSchema.safeParse(r.output);
    if (!parsed.success) return handleFailure(job, { ok: false, kind: 'invalid', message: 'Antwort passt nicht zum Schema' });
    rateStrikes = 0;
    const clean = parsed.data.notes.map((n) => sanitizeNote(n, deck.pageCount, 1)).filter((n): n is CleanNote => n !== null);
    const kept = applyCardLimits(clean, maxCards);
    tx(db, () => {
      kept.forEach((n, i) => {
        repo.insertNote(db, { deckId: deck.id, source: 'chunk', position: n.slideRefs[0]! * 1000 + i, ...n }, now());
      });
      setJob(job.id, { status: 'done', attempts: job.attempts + 1, usage: r.usage });
    });
    finalizeDeck(deck.id);
  }

  async function doGaps(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    const mod = deck && repo.getModule(db, deck.moduleId);
    if (!deck || !mod) return setJob(job.id, { status: 'failed', error: 'Foliensatz oder Modul gelöscht' });
    const notes = repo.listNotes(db, { deckId: deck.id, limit: 100_000 });
    const existing = notes.map((n) => ({ cards: n.cards.length, slide: n.slideRefs[0]! }));
    const room = maxCardsFor(deck.pageCount) - existing.reduce((s, e) => s + e.cards, 0);
    if (room <= 0) return setJob(job.id, { status: 'done', attempts: job.attempts + 1 }); // Obergrenze erreicht, kein Aufruf
    const slides = repo.listSlides(db, deck.id);
    const prompt = buildGapsPrompt({
      language: mod.language,
      deckTitle: deck.title,
      slides,
      existing: notes.map((n) => ({ front: n.front, back: n.back, slides: n.slideRefs })),
      maxCards: room,
      figures: figuresOf(deck.id, slides),
    });
    const r = await callClaude(prompt, cardsJsonSchema, deck.id, cardsModel);
    if (!r.ok) return handleFailure(job, r);
    const parsed = CardsOutputSchema.safeParse(r.output);
    if (!parsed.success) return handleFailure(job, { ok: false, kind: 'invalid', message: 'Antwort passt nicht zum Schema' });
    rateStrikes = 0;
    const clean = parsed.data.notes.map((n) => sanitizeNote(n, deck.pageCount, 1)).filter((n): n is CleanNote => n !== null);
    const kept = applyCardLimits(clean, maxCardsFor(deck.pageCount), MAX_CARDS_PER_SLIDE, existing);
    tx(db, () => {
      // hinter die vorhandenen Karten derselben Folie (die liegen bei Folie × 1000 + Index)
      kept.forEach((n, i) => {
        repo.insertNote(db, { deckId: deck.id, source: 'chunk', position: n.slideRefs[0]! * 1000 + 500 + i, ...n }, now());
      });
      setJob(job.id, { status: 'done', attempts: job.attempts + 1, usage: r.usage });
    });
  }

  async function tick(): Promise<boolean> {
    if (paused) {
      if (pausedUntil === null || now() < pausedUntil) return false;
      paused = false;
      pauseReason = null;
      pausedUntil = null;
    }
    const row = db.prepare("SELECT * FROM job WHERE status = 'queued' ORDER BY rowid LIMIT 1").get() as Row | undefined;
    if (!row) return false;
    const job = toJob(row);
    setJob(job.id, { status: 'running', error: job.error });
    current = { jobId: job.id, deckId: job.deckId, kind: job.kind };
    try {
      if (job.kind === 'render') await doRender(job);
      else if (job.kind === 'summary') await doSummary(job);
      else if (job.kind === 'cards') await doCards(job);
      else if (job.kind === 'gaps') await doGaps(job);
      else setJob(job.id, { status: 'failed', error: 'Veralteter Job – bitte „Neu erzeugen“' });
    } catch (e) {
      handleFailure(job, { ok: false, kind: 'failed', message: String(e) });
    } finally {
      current = null;
    }
    return true;
  }

  async function loop() {
    while (!stopped) {
      const worked = await tick().catch((e) => {
        console.error('[naklearn] Worker-Fehler', e);
        return false;
      });
      if (!worked && !stopped) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 2000);
          wakeUp = () => {
            clearTimeout(t);
            resolve();
          };
        });
        wakeUp = null;
      }
    }
  }

  return {
    tick,
    start() {
      if (!stopped) return;
      stopped = false;
      loopDone = loop();
    },
    async stop() {
      stopped = true;
      wakeUp?.();
      await loopDone;
    },
    status() {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM job WHERE status = 'queued'").get() as Row;
      return {
        state: paused ? 'paused' : current ? 'running' : 'idle',
        pauseReason,
        pausedUntil,
        current,
        queued: n,
      };
    },
    resume() {
      paused = false;
      pauseReason = null;
      pausedUntil = null;
      rateStrikes = 0;
      wakeUp?.();
    },
    wake() {
      wakeUp?.();
    },
  };
}
