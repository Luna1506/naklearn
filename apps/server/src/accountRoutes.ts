import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AccountError, acceptInvite, addDevice, checkLogin, createInvite, deleteUser, getUser, inviteInfo, listDevices,
  listUsers, removeDevice, setPassword, type User,
} from './accounts.ts';
import { clearSessionCookie, createUserSession, sessionCookie, type LoginLimiter } from './auth.ts';
import { clientIp } from './clientip.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { NotFound, me, requireAdmin } from './http.ts';

const LoginInput = z.object({ name: z.string().max(100), password: z.string().max(1000) });
const DeviceLoginInput = LoginInput.extend({ deviceName: z.string().max(100).optional() });
const PasswordInput = z.object({ old: z.string().max(1000), new: z.string().max(1000) });
const AcceptInput = z.object({ name: z.string().max(100).optional(), password: z.string().max(1000) });
const TokenParam = z.object({ token: z.string().min(10).max(200) });
const IdParam = z.object({ id: z.string().min(1) });

const WRONG = 'Name oder Passwort falsch';
const TOO_MANY = 'Zu viele Fehlversuche – bitte 15 Minuten warten.';

export const publicUser = (u: User) => ({ id: u.id, name: u.name, isAdmin: u.isAdmin });

export function registerAccountRoutes(
  app: FastifyInstance,
  ctx: { db: Db; cfg: Config; now: () => number; limiter: LoginLimiter },
): void {
  const { db, cfg, now, limiter } = ctx;
  const secure = (req: FastifyRequest) => req.protocol === 'https';
  const ipOf = (req: FastifyRequest) => clientIp(req.ip, req.headers['cf-connecting-ip']);
  const setSession = (req: FastifyRequest, reply: FastifyReply, u: User) =>
    reply.header('set-cookie', sessionCookie(createUserSession(cfg.sessionSecret, u.id, u.sessionEpoch, now()), secure(req)));
  const linkFor = (req: FastifyRequest, token: string) =>
    `${cfg.publicUrl ?? `${req.protocol}://${req.headers.host}`}/#/einladung/${token}`;

  /** Login-Versuch mit Bremse; liefert die Person oder hat schon 401/429 geantwortet. */
  function attempt(req: FastifyRequest, reply: FastifyReply, name: string, password: string): User | null {
    const ip = ipOf(req);
    const t = now();
    if (limiter.blocked(ip, t)) {
      void reply.code(429).send({ error: TOO_MANY });
      return null;
    }
    const user = checkLogin(db, name, password);
    if (!user) {
      limiter.fail(ip, t);
      void reply.code(401).send({ error: WRONG });
      return null;
    }
    return user;
  }

  app.post('/api/login', async (req, reply) => {
    const { name, password } = LoginInput.parse(req.body);
    const user = attempt(req, reply, name, password);
    if (!user) return reply;
    setSession(req, reply, user);
    return publicUser(user);
  });

  app.post('/api/logout', async (req, reply) => {
    reply.header('set-cookie', clearSessionCookie(secure(req)));
    return { ok: true };
  });

  app.post('/api/device/login', async (req, reply) => {
    const { name, password, deviceName } = DeviceLoginInput.parse(req.body);
    const user = attempt(req, reply, name, password);
    if (!user) return reply;
    const { token } = addDevice(db, user.id, deviceName ?? 'Handy', now());
    return { token, user: { id: user.id, name: user.name } };
  });

  app.get('/api/me', async (req) => publicUser(me(req)));

  app.post('/api/me/password', async (req, reply) => {
    const u = me(req);
    const body = PasswordInput.parse(req.body);
    if (!checkLogin(db, u.name, body.old)) throw new AccountError('Altes Passwort stimmt nicht');
    const updated = setPassword(db, u.id, body.new);
    setSession(req, reply, updated);
    return { ok: true };
  });

  app.get('/api/me/devices', async (req) => listDevices(db, me(req).id));

  app.delete('/api/me/devices/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    if (!removeDevice(db, me(req).id, id)) throw new NotFound('Gerät nicht gefunden');
    return { ok: true };
  });

  app.post('/api/invites', async (req) => {
    requireAdmin(req);
    return { url: linkFor(req, createInvite(db, { now: now() })) };
  });

  app.get('/api/invites/:token', async (req) => {
    const { token } = TokenParam.parse(req.params);
    const info = inviteInfo(db, token, now());
    if (!info) throw new NotFound('Link ist ungültig, abgelaufen oder schon benutzt');
    return info;
  });

  app.post('/api/invites/:token/accept', async (req, reply) => {
    const { token } = TokenParam.parse(req.params);
    const body = AcceptInput.parse(req.body);
    const ip = ipOf(req);
    if (limiter.blocked(ip, now())) return reply.code(429).send({ error: TOO_MANY });
    let user: User;
    try {
      user = acceptInvite(db, token, { name: body.name, password: body.password, now: now() });
    } catch (e) {
      if (e instanceof AccountError && e.statusCode === 404) limiter.fail(ip, now());
      throw e;
    }
    setSession(req, reply, user);
    return publicUser(user);
  });

  app.get('/api/users', async (req) => {
    requireAdmin(req);
    return listUsers(db);
  });

  app.post('/api/users/:id/reset', async (req) => {
    requireAdmin(req);
    const { id } = IdParam.parse(req.params);
    if (!getUser(db, id)) throw new NotFound('Person nicht gefunden');
    return { url: linkFor(req, createInvite(db, { userId: id, now: now() })) };
  });

  app.delete('/api/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const { id } = IdParam.parse(req.params);
    if (id === admin.id) throw new AccountError('Du kannst dich nicht selbst löschen');
    if (!getUser(db, id)) throw new NotFound('Person nicht gefunden');
    deleteUser(db, id);
    return { ok: true };
  });
}
