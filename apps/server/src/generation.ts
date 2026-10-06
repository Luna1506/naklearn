import {
  ChunkOutputSchema, SynthesisOutputSchema, clozeOrdinals, newId,
  type GeneratedNote, type NoteKind,
} from '@kartei/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClaudeResult, RunClaude } from './claude.ts';
import { tx, type Db } from './db.ts';
import { renderPdf, type RenderedSlide } from './pdf.ts';
import { buildChunkPrompt, buildSynthesisPrompt, chunkJsonSchema, outlineOf, synthesisJsonSchema } from './prompt.ts';
import * as repo from './repo.ts';

export const CHUNK_SIZE = 15;
export const MAX_ATTEMPTS = 3;
export const RATE_LIMIT_BACKOFF_MS = [300_000, 900_000, 3_600_000];
const SYNTHESIS_POSITION_BASE = 1_000_000;

export interface Job {
  id: string;
  deckId: string;
  kind: 'render' | 'chunk' | 'synthesis';
  chunkFrom: number | null;
  chunkTo: number | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  error: string | null;
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
  status: r.status, attempts: r.attempts, error: r.error ?? null, createdAt: r.created_at,
});

function insertJob(db: Db, deckId: string, kind: Job['kind'], from: number | null, to: number | null, now: number): void {
  db.prepare("INSERT INTO job (id, deck_id, kind, chunk_from, chunk_to, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)")
    .run(newId(), deckId, kind, from, to, now);
}

function insertGenerationJobs(db: Db, deckId: string, pageCount: number, chunkSize: number, now: number): void {
  for (let from = 1; from <= pageCount; from += chunkSize) {
    insertJob(db, deckId, 'chunk', from, Math.min(pageCount, from + chunkSize - 1), now);
  }
  insertJob(db, deckId, 'synthesis', null, null, now);
}

export function listJobs(db: Db, deckId: string): Job[] {
  return (db.prepare('SELECT * FROM job WHERE deck_id = ? ORDER BY rowid').all(deckId) as Row[]).map(toJob);
}

export function enqueueDeck(db: Db, deckId: string, now = Date.now()): void {
  tx(db, () => {
    insertJob(db, deckId, 'render', null, null, now);
    repo.updateDeck(db, deckId, { status: 'pending', error: null }, now);
  });
}

export function regenerateDeck(db: Db, deckId: string, now = Date.now(), chunkSize = CHUNK_SIZE): void {
  tx(db, () => {
    for (const id of repo.unreviewedNoteIds(db, deckId)) repo.deleteNote(db, id, now);
    db.prepare("DELETE FROM job WHERE deck_id = ? AND status IN ('queued', 'failed', 'done')").run(deckId);
    const deck = repo.getDeck(db, deckId)!;
    if (deck.pageCount > 0) {
      insertGenerationJobs(db, deckId, deck.pageCount, chunkSize, now);
      repo.updateDeck(db, deckId, { status: 'generating', error: null }, now);
    } else {
      insertJob(db, deckId, 'render', null, null, now);
      repo.updateDeck(db, deckId, { status: 'pending', error: null }, now);
    }
  });
}

export function retryJob(db: Db, jobId: string): void {
  const r = db.prepare('SELECT * FROM job WHERE id = ?').get(jobId) as Row | undefined;
  if (!r) throw new Error(`Job ${jobId} nicht gefunden`);
  db.prepare("UPDATE job SET status = 'queued', attempts = 0, error = NULL WHERE id = ?").run(jobId);
  repo.updateDeck(db, r.deck_id, { status: r.kind === 'render' ? 'pending' : 'generating', error: null });
}

export function resetRunningJobs(db: Db): void {
  db.prepare("UPDATE job SET status = 'queued' WHERE status = 'running'").run();
}

/** Bereinigt eine von Claude erzeugte Note; null = verwerfen. */
export function sanitizeNote(n: GeneratedNote, pageCount: number, fallbackPage: number) {
  const front = n.front.trim();
  if (!front) return null;
  const valid = (p: number) => Number.isInteger(p) && p >= 1 && p <= pageCount;
  const slides = [...new Set(n.slides.filter(valid))];
  let kind: NoteKind = n.kind;
  let frontImagePage = n.frontImagePage;
  if (kind === 'cloze' && clozeOrdinals(front).length === 0) kind = 'qa';
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

export function createWorker(deps: {
  db: Db;
  dataDir: string;
  runClaude: RunClaude;
  render?: (pdf: string, out: string) => Promise<RenderedSlide[]>;
  now?: () => number;
  chunkSize?: number;
}): Worker {
  const { db, dataDir, runClaude } = deps;
  const render = deps.render ?? renderPdf;
  const now = deps.now ?? Date.now;
  const chunkSize = deps.chunkSize ?? CHUNK_SIZE;

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
    const chunks = jobs.filter((j) => j.kind === 'chunk');
    const failed = chunks.filter((j) => j.status === 'failed').length;
    if (chunks.length > 0 && failed === chunks.length) {
      repo.updateDeck(db, deckId, { status: 'error', error: 'Alle Abschnitte fehlgeschlagen' }, now());
    } else if (chunks.length > 0) {
      repo.updateDeck(db, deckId, { status: 'ready', error: failed ? `${failed} Abschnitt(e) fehlgeschlagen` : null }, now());
    }
  }

  function setJob(id: string, fields: { status: Job['status']; attempts?: number; error?: string | null }) {
    db.prepare('UPDATE job SET status = ?, attempts = COALESCE(?, attempts), error = ? WHERE id = ?')
      .run(fields.status, fields.attempts ?? null, fields.error ?? null, id);
  }

  /** Gemeinsame Fehlerbehandlung für Claude-Jobs. */
  function handleFailure(job: Job, r: Extract<ClaudeResult, { ok: false }>) {
    if (r.kind === 'auth') {
      setJob(job.id, { status: 'queued', error: r.message });
      pause('claude ist nicht eingeloggt – bitte `claude` im Terminal starten und anmelden, dann „Fortsetzen“.', null);
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

  async function callClaude(prompt: string, jsonSchema: object, deckId: string): Promise<ClaudeResult> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'kartei-claude-'));
    try {
      return await runClaude({ prompt, jsonSchema, addDirs: [slidesDir(deckId)], cwd });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }

  async function doRender(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    if (!deck) return setJob(job.id, { status: 'failed', error: 'Foliensatz gelöscht' });
    repo.updateDeck(db, deck.id, { status: 'rendering' }, now());
    try {
      const slides = await render(path.join(dataDir, 'pdfs', `${deck.pdfSha256}.pdf`), slidesDir(deck.id));
      tx(db, () => {
        repo.replaceSlides(db, deck.id, slides.map((s) => ({ deckId: deck.id, ...s })));
        repo.updateDeck(db, deck.id, { pageCount: slides.length, status: 'generating', error: null }, now());
        insertGenerationJobs(db, deck.id, slides.length, chunkSize, now());
        setJob(job.id, { status: 'done' });
      });
    } catch (e) {
      setJob(job.id, { status: 'failed', attempts: job.attempts + 1, error: String(e) });
      repo.updateDeck(db, deck.id, { status: 'error', error: `PDF konnte nicht gelesen werden: ${String(e).slice(0, 300)}` }, now());
    }
  }

  async function doChunk(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    const mod = deck && repo.getModule(db, deck.moduleId);
    if (!deck || !mod) return setJob(job.id, { status: 'failed', error: 'Foliensatz oder Modul gelöscht' });
    const all = repo.listSlides(db, deck.id);
    const part = all.filter((s) => s.page >= job.chunkFrom! && s.page <= job.chunkTo!);
    const prompt = buildChunkPrompt({
      language: mod.language,
      deckTitle: deck.title,
      outline: outlineOf(all),
      slides: part.map((s) => ({ page: s.page, text: s.text, imagePath: path.join(slidesDir(deck.id), s.image) })),
    });
    const r = await callClaude(prompt, chunkJsonSchema, deck.id);
    if (!r.ok) return handleFailure(job, r);
    const parsed = ChunkOutputSchema.safeParse(r.output);
    if (!parsed.success) return handleFailure(job, { ok: false, kind: 'invalid', message: 'Antwort passt nicht zum Schema' });
    rateStrikes = 0;
    tx(db, () => {
      parsed.data.notes.forEach((n, i) => {
        const clean = sanitizeNote(n, deck.pageCount, job.chunkFrom!);
        if (clean) repo.insertNote(db, { deckId: deck.id, source: 'chunk', position: job.chunkFrom! * 1000 + i, ...clean }, now());
      });
      setJob(job.id, { status: 'done', attempts: job.attempts + 1 });
    });
    finalizeDeck(deck.id);
  }

  async function doSynthesis(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    const mod = deck && repo.getModule(db, deck.moduleId);
    if (!deck || !mod) return setJob(job.id, { status: 'failed', error: 'Foliensatz oder Modul gelöscht' });
    const notes = repo.listNotes(db, { deckId: deck.id, limit: 5000 });
    const prompt = buildSynthesisPrompt({
      language: mod.language,
      deckTitle: deck.title,
      slides: repo.listSlides(db, deck.id),
      existing: notes.map((n) => ({ id: n.id, front: n.front })),
    });
    const r = await callClaude(prompt, synthesisJsonSchema, deck.id);
    if (!r.ok) return handleFailure(job, r);
    const parsed = SynthesisOutputSchema.safeParse(r.output);
    if (!parsed.success) return handleFailure(job, { ok: false, kind: 'invalid', message: 'Antwort passt nicht zum Schema' });
    rateStrikes = 0;
    const removable = new Set(repo.unreviewedNoteIds(db, deck.id));
    tx(db, () => {
      for (const id of parsed.data.removeNoteIds) if (removable.has(id)) repo.deleteNote(db, id, now());
      parsed.data.notes.forEach((n, i) => {
        const clean = sanitizeNote(n, deck.pageCount, 1);
        if (clean) repo.insertNote(db, { deckId: deck.id, source: 'synthesis', position: SYNTHESIS_POSITION_BASE + i, ...clean }, now());
      });
      setJob(job.id, { status: 'done', attempts: job.attempts + 1 });
    });
    finalizeDeck(deck.id);
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
      else if (job.kind === 'chunk') await doChunk(job);
      else await doSynthesis(job);
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
        console.error('[kartei] Worker-Fehler', e);
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
