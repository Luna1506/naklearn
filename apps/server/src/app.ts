import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z, ZodError } from 'zod';
import type { Db } from './db.ts';
import { enqueueDeck, enqueueGaps, listJobs, regenerateDeck, retryJob, type Worker } from './generation.ts';
import * as repo from './repo.ts';
import { answer, getNext, getOverview, undo } from './study.ts';
import { applyPush, pullSince } from './sync.ts';
import { authenticateToken, getUser, touchUser } from './accounts.ts';
import { registerAccountRoutes } from './accountRoutes.ts';
import { LoginLimiter, SESSION_COOKIE, readCookie, sessionUserId, verifyUserSession } from './auth.ts';
import type { Config } from './config.ts';
import { NotFound, me, must, type Auth } from './http.ts';
import { SyncRequestSchema } from '@naklearn/core';

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

/** Ohne Anmeldung erreichbar (alles außerhalb von /api ist der Web-Client). */
const PUBLIC_ROUTES = new Set(['/api/login', '/api/logout', '/api/health', '/api/device/login', '/api/invites/:token', '/api/invites/:token/accept']);

export function buildApp(deps: {
  db: Db;
  cfg: Config;
  worker: Pick<Worker, 'wake' | 'status' | 'resume'>;
  now?: () => number;
}): FastifyInstance {
  const { db, cfg, worker } = deps;
  const now = deps.now ?? Date.now;
  // Genau ein Proxy (Nginx Proxy Manager) davor, der Container ist direkt nicht erreichbar:
  // nur dem direkten Gegenüber vertrauen, req.ip ist dann die vom Proxy angehängte Client-Adresse.
  const app = Fastify({ logger: false, bodyLimit: 16 << 20, trustProxy: (_addr: string, hop: number) => hop === 0 });
  const limiter = new LoginLimiter();
  const sessionAuth = (req: FastifyRequest): Auth | null => {
    const value = readCookie(req.headers.cookie, SESSION_COOKIE);
    const id = sessionUserId(value);
    const user = id ? getUser(db, id) : undefined;
    return user && verifyUserSession(value, cfg.sessionSecret, user.id, user.sessionEpoch, now()) ? { user, deviceId: null } : null;
  };
  const deviceAuth = (req: FastifyRequest): Auth | null => {
    const h = req.headers.authorization;
    const r = h?.startsWith('Bearer ') ? authenticateToken(db, h.slice(7), now()) : null;
    return r ? { user: r.user, deviceId: r.deviceId } : null;
  };
  app.decorateRequest('auth', null);

  app.register(multipart, { limits: { fileSize: 300 * 1024 * 1024, files: 50 } });
  if (cfg.webDir) app.register(fastifyStatic, { root: cfg.webDir, prefix: '/' });
  // iOS-App für SideStore (source.json + ipa), öffentlich; der ios-Workflow legt die Dateien in <data>/ios ab.
  app.register(fastifyStatic, { root: path.join(cfg.dataDir, 'ios'), prefix: '/ios/', decorateReply: false });

  app.addHook('onRequest', async (req, reply) => {
    // Hinter dem Proxy per http aufgerufen → auf die öffentliche https-Adresse umleiten.
    if (cfg.publicUrl?.startsWith('https://') && req.headers['x-forwarded-proto'] && req.protocol === 'http') {
      return reply.redirect(cfg.publicUrl + req.url, 301);
    }
    const device = deviceAuth(req);
    // Schreibende Browser-Requests von fremden Webseiten (CSRF) ablehnen; die App schickt ein Token, das keine fremde Seite kennt.
    const origin = req.headers.origin;
    if (!device && origin && req.method !== 'GET' && req.method !== 'HEAD' && req.routeOptions.url !== '/api/device/login') {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch {}
      if (!sameOrigin) return reply.code(403).send({ error: 'forbidden origin' });
    }
    // /api/device/login ist öffentlich und gibt kein Cookie; fremde Seite kann Antwort nicht lesen.
    req.auth = device ?? sessionAuth(req);
    const route = req.routeOptions.url;
    if (route !== undefined && (!route.startsWith('/api/') || PUBLIC_ROUTES.has(route))) return;
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    touchUser(db, req.auth.user.id, now());
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    if (err instanceof NotFound) return reply.code(404).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    console.error(err);
    return reply.code(500).send({ error: String(e.message ?? err) });
  });

  // ---- Anmeldung und Konten ----
  app.get('/api/health', async () => ({ ok: true }));
  registerAccountRoutes(app, { db, cfg, now, limiter });

  // ---- Übersicht und Module ----
  app.get('/api/overview', async (req) => getOverview(db, me(req).id, now()));

  app.get('/api/modules/all', async (req) => repo.listAllModules(db, me(req).id));

  app.post('/api/modules', async (req) => {
    const input = ModuleInput.parse(req.body);
    const uid = me(req).id;
    const m = repo.createModule(db, { ...input, createdBy: uid }, now());
    return repo.getMyModule(db, uid, m.id)!;
  });

  app.get('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const uid = me(req).id;
    const shared = must(repo.getModule(db, id), 'Modul');
    const mine = repo.getMyModule(db, uid, id);
    const decks = repo.listDecks(db, id).map((d) => ({ ...d, noteCount: repo.countNotes(db, d.id) }));
    return { module: mine ?? shared, decks, mine: !!mine, memberCount: repo.memberIds(db, id).length };
  });

  app.patch('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const uid = me(req).id;
    must(repo.getModule(db, id), 'Modul');
    const patch = ModulePatch.parse(req.body);
    const personal = patch.examDate !== undefined || patch.newPerDay !== undefined;
    if (personal && !repo.getMyModule(db, uid, id)) {
      throw Object.assign(new Error('Erst zu deinen Modulen hinzufügen'), { statusCode: 409 });
    }
    if (patch.name !== undefined || patch.language !== undefined) {
      repo.updateModule(db, id, { ...(patch.name !== undefined && { name: patch.name }), ...(patch.language !== undefined && { language: patch.language }) }, now());
    }
    if (personal) repo.updateMembership(db, uid, id, { examDate: patch.examDate, newPerDay: patch.newPerDay }, now());
    return repo.getMyModule(db, uid, id) ?? repo.getModule(db, id)!;
  });

  app.delete('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const uid = me(req).id;
    must(repo.getModule(db, id), 'Modul');
    if (repo.memberIds(db, id).some((u) => u !== uid)) {
      throw Object.assign(new Error('Andere lernen dieses Modul – nur aus deinen Modulen entfernen'), { statusCode: 409 });
    }
    repo.leaveModule(db, uid, id);
    repo.deleteModule(db, id, now());
    return { ok: true };
  });

  app.post('/api/modules/:id/join', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getModule(db, id), 'Modul');
    repo.joinModule(db, me(req).id, id, now());
    return { ok: true };
  });

  app.post('/api/modules/:id/leave', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getModule(db, id), 'Modul');
    repo.leaveModule(db, me(req).id, id);
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

  app.post('/api/decks/:id/gaps', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getDeck(db, id), 'Foliensatz');
    enqueueGaps(db, id, now());
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
  app.get('/api/notes', async (req) => repo.listNotes(db, { ...NotesQuery.parse(req.query), userId: me(req).id }));

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
    repo.setCardFlag(db, me(req).id, id, suspended, now());
    return { ok: true };
  });

  // ---- Lernen ----
  app.get('/api/study/next', async (req) => getNext(db, me(req).id, ScopeQuery.parse(req.query), now()));

  app.post('/api/study/answer', async (req) => {
    const a = AnswerInput.parse(req.body);
    must(repo.getCard(db, a.cardId), 'Karte');
    return answer(db, { ...a, userId: me(req).id, deviceId: cfg.deviceId, now: now() });
  });

  app.post('/api/study/undo', async (req) => {
    const { revlogId } = z.object({ revlogId: z.string().min(1) }).parse(req.body);
    try {
      undo(db, me(req).id, revlogId, cfg.deviceId, now());
    } catch (e) {
      throw new NotFound((e as Error).message);
    }
    return { ok: true };
  });

  // ---- Sync ----
  app.post('/api/sync', async (req) => {
    const body = SyncRequestSchema.parse(req.body);
    applyPush(db, me(req).id, body.push);
    return pullSince(db, me(req).id, body.cursor);
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
