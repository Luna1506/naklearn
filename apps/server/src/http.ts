import type { FastifyRequest } from 'fastify';
import { AccountError, type User } from './accounts.ts';

export interface Auth {
  user: User;
  /** Gerät bei Anmeldung per App-Token, sonst null (Browser-Sitzung). */
  deviceId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null;
  }
}

export class NotFound extends Error {}

export function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new NotFound(`${what} nicht gefunden`);
  return v;
}

/** Die angemeldete Person (der Auth-Hook garantiert sie für alle nicht öffentlichen Routen). */
export function me(req: FastifyRequest): User {
  if (!req.auth) throw new AccountError('Nicht angemeldet', 401);
  return req.auth.user;
}

export function requireAdmin(req: FastifyRequest): User {
  const u = me(req);
  if (!u.isAdmin) throw new AccountError('Nur für Admins', 403);
  return u;
}
