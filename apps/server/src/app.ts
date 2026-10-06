import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z, ZodError } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { enqueueDeck, listJobs, regenerateDeck, retryJob, type Worker } from './generation.ts';
import * as repo from './repo.ts';
import { answer, getNext, getOverview, undo } from './study.ts';
import { applyPush, pullSince } from './sync.ts';
import QRCode from 'qrcode';
import { detectPublicUrl, pairingPayload } from './pair.ts';
import { SyncRequestSchema } from '@naklearn/core';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostName(host: string | undefined): string {
  if (!host) return '';
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0]!.toLowerCase();
}

class NotFound extends Error {}

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ModuleInput = z.object({
  name: z.string().trim().min(1).max(100),
  language: z.enum(['en', 'de']),
  examDate: DateStr.nullable().optional(),
  newPerDay: z.number().int().min(0).max(500).optional(),
});
const ModulePatch = ModuleInput.partial();
const IdParam = z.object({ id: z.string().min(1) });
const NotePatch = z.object({
  front: z.string().min(1).optional(),
  back: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
const NotesQuery = z.object({
  deckId: z.string().optional(),
  moduleId: z.string().optional(),
  q: z.string().optional(),
  kind: z.enum(['qa', 'cloze', 'diagram']).optional(),
});
const ScopeQuery = z.object({ moduleId: z.string().optional(), deckId: z.string().optional() });
const AnswerInput = z.object({
  cardId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  durationMs: z.number().min(0).max(3_600_000),
});

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new NotFound(`${what} nicht gefunden`);
  return v;
}

export function buildApp(deps: {
  db: Db;
  cfg: Config;
  worker: Pick<Worker, 'wake' | 'status' | 'resume'>;
  now?: () => number;
  /** Ermittelt die Adresse fürs Handy (Standard: Tailscale). */
  publicUrl?: () => Promise<string | null>;
}): FastifyInstance {
  const { db, cfg, worker } = deps;
  const now = deps.now ?? Date.now;
  const app = Fastify({ logger: false, bodyLimit: 16 << 20 });

  app.register(multipart, { limits: { fileSize: 300 * 1024 * 1024, files: 50 } });
  if (cfg.webDir) app.register(fastifyStatic, { root: cfg.webDir, prefix: '/' });

  app.addHook('onRequest', async (req, reply) => {
    // Schreibende Requests von fremden Webseiten (CSRF) ablehnen.
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch {}
      if (!sameOrigin) return reply.code(403).send({ error: 'forbidden origin' });
    }
    // Ohne Token nur echte lokale Aufrufe – der Host-Header schützt vor DNS-Rebinding.
    if (LOOPBACK.has(req.socket.remoteAddress ?? '') && LOCAL_HOSTS.has(hostName(req.headers.host))) return;
    if (req.headers.authorization === `Bearer ${cfg.token}`) return;
    return reply.code(401).send({ error: 'unauthorized' });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    if (err instanceof NotFound) return reply.code(404).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    console.error(err);
    return reply.code(500).send({ error: String(e.message ?? err) });
  });

  // ---- Übersicht und Module ----
  app.get('/api/overview', async () => getOverview(db, now()));

  app.post('/api/modules', async (req) => {
    const input = ModuleInput.parse(req.body);
    return repo.createModule(db, input, now());
  });

  app.get('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const module = must(repo.getModule(db, id), 'Modul');
    const decks = repo.listDecks(db, id).map((d) => ({ ...d, noteCount: repo.countNotes(db, d.id) }));
    return { module, decks };
  });

  app.patch('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getModule(db, id), 'Modul');
    return repo.updateModule(db, id, ModulePatch.parse(req.body), now());
  });

  app.delete('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getModule(db, id), 'Modul');
    repo.deleteModule(db, id, now());
    return { ok: true };
  });

  app.post('/api/modules/:id/upload', async (req) => {
    const { id } = IdParam.parse(req.params);
    const mod = must(repo.getModule(db, id), 'Modul');
    const created = [];
    const skipped: { file: string; reason: string }[] = [];
    for await (const part of req.files()) {
      const buf = await part.toBuffer();
      const file = part.filename;
      if (!file.toLowerCase().endsWith('.pdf') || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        skipped.push({ file, reason: 'keine PDF' });
        continue;
      }
      const sha = createHash('sha256').update(buf).digest('hex');
      const dup = repo.findDeckBySha(db, mod.id, sha);
      if (dup) {
        skipped.push({ file, reason: `bereits hochgeladen (${dup.title})` });
        continue;
      }
      await writeFile(path.join(cfg.dataDir, 'pdfs', `${sha}.pdf`), buf);
      const deck = repo.createDeck(db, { moduleId: mod.id, title: file.replace(/\.pdf$/i, ''), pdfSha256: sha }, now());
      enqueueDeck(db, deck.id, now());
      created.push(repo.getDeck(db, deck.id)!);
    }
    if (created.length) worker.wake();
    return { created, skipped };
  });

  // ---- Foliensätze und Jobs ----
  app.get('/api/decks/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const deck = must(repo.getDeck(db, id), 'Foliensatz');
    return {
      deck,
      jobs: listJobs(db, id),
      noteCount: repo.countNotes(db, id),
      moduleName: repo.getModule(db, deck.moduleId)?.name ?? '',
    };
  });

  app.patch('/api/decks/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getDeck(db, id), 'Foliensatz');
    const { title } = z.object({ title: z.string().trim().min(1).max(200) }).parse(req.body);
    return repo.updateDeck(db, id, { title }, now());
  });

  app.delete('/api/decks/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getDeck(db, id), 'Foliensatz');
    repo.deleteDeck(db, id, now());
    db.prepare("DELETE FROM job WHERE deck_id = ? AND status = 'queued'").run(id);
    return { ok: true };
  });

  app.post('/api/decks/:id/regenerate', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getDeck(db, id), 'Foliensatz');
    const { includeReviewed } = z.object({ includeReviewed: z.boolean().optional() }).parse(req.body ?? {});
    regenerateDeck(db, id, now(), { includeReviewed });
    worker.wake();
    return { ok: true };
  });

  app.post('/api/jobs/:id/retry', async (req) => {
    const { id } = IdParam.parse(req.params);
    try {
      retryJob(db, id);
    } catch {
      throw new NotFound('Job nicht gefunden');
    }
    worker.wake();
    return { ok: true };
  });

  app.get('/api/worker', async () => worker.status());
  app.post('/api/worker/resume', async () => {
    worker.resume();
    return { ok: true };
  });

  // ---- Notes und Karten ----
  app.get('/api/notes', async (req) => repo.listNotes(db, NotesQuery.parse(req.query)));

  app.patch('/api/notes/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getNote(db, id), 'Karte');
    const patch = NotePatch.parse(req.body);
    try {
      return repo.updateNote(db, id, patch, now());
    } catch (e) {
      throw Object.assign(new Error((e as Error).message), { statusCode: 400 });
    }
  });

  app.delete('/api/notes/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getNote(db, id), 'Karte');
    repo.deleteNote(db, id, now());
    return { ok: true };
  });

  app.post('/api/cards/:id/suspend', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getCard(db, id), 'Karte');
    const { suspended } = z.object({ suspended: z.boolean() }).parse(req.body);
    repo.setCardSuspended(db, id, suspended, now());
    return { ok: true };
  });

  // ---- Lernen ----
  app.get('/api/study/next', async (req) => getNext(db, ScopeQuery.parse(req.query), now()));

  app.post('/api/study/answer', async (req) => {
    const a = AnswerInput.parse(req.body);
    must(repo.getCard(db, a.cardId), 'Karte');
    return answer(db, { ...a, deviceId: cfg.deviceId, now: now() });
  });

  app.post('/api/study/undo', async (req) => {
    const { revlogId } = z.object({ revlogId: z.string().min(1) }).parse(req.body);
    try {
      undo(db, revlogId, cfg.deviceId, now());
    } catch (e) {
      throw new NotFound((e as Error).message);
    }
    return { ok: true };
  });

  // ---- Koppeln ----
  app.get('/api/pair', async (req, reply) => {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return reply.code(403).send({ error: 'Koppeln nur am Laptop' });
    const url = await (deps.publicUrl ?? (() => detectPublicUrl(cfg.port, process.env)))();
    const payload = url ? pairingPayload(url, cfg.token) : null;
    const qrSvg = payload ? await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
    return { url, token: cfg.token, payload, qrSvg };
  });

  // ---- Sync ----
  app.post('/api/sync', async (req) => {
    const body = SyncRequestSchema.parse(req.body);
    applyPush(db, body.push);
    return pullSince(db, body.cursor);
  });

  // ---- Folienbilder ----
  app.get('/api/slides/:deckId/:file', async (req, reply) => {
    const { deckId, file } = z.object({ deckId: z.string(), file: z.string() }).parse(req.params);
    if (!/^[0-9a-f-]{36}$/.test(deckId) || !/^\d+\.jpg$/.test(file)) throw new NotFound('Bild nicht gefunden');
    const full = path.join(cfg.dataDir, 'slides', deckId, file);
    if (!existsSync(full)) throw new NotFound('Bild nicht gefunden');
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.type('image/jpeg').send(createReadStream(full));
  });

  return app;
}
