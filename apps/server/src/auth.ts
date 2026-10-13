import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'naklearn_session';
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

const mac = (secret: string, exp: string) => createHmac('sha256', secret).update(exp).digest('base64url');

/** Zustandsloses Sitzungstoken: Ablaufzeit + HMAC darüber. */
export function createSession(secret: string, now: number): string {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifySession(value: string | undefined, secret: string, now: number): boolean {
  if (!value) return false;
  const [exp, sig, ...rest] = value.split('.');
  if (!exp || !sig || rest.length || !/^\d+$/.test(exp)) return false;
  const want = Buffer.from(mac(secret, exp));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want) && Number(exp) > now;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

const attrs = (maxAge: number, secure: boolean) =>
  `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export function sessionCookie(value: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; ${attrs(SESSION_TTL_MS / 1000, secure)}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; ${attrs(0, secure)}`;
}

/** Bremse gegen Passwort-Durchprobieren, im Speicher pro IP. */
export class LoginLimiter {
  private entries = new Map<string, { first: number; count: number; until: number }>();
  private max: number;
  private lockMs: number;
  constructor(max = 5, lockMs = 15 * 60_000) {
    this.max = max;
    this.lockMs = lockMs;
  }

  blocked(ip: string, now: number): boolean {
    const e = this.entries.get(ip);
    if (!e) return false;
    if (e.until > now) return true;
    if (e.until || now - e.first >= this.lockMs) this.entries.delete(ip);
    return false;
  }

  fail(ip: string, now: number): void {
    let e = this.entries.get(ip);
    if (!e || now - e.first >= this.lockMs) {
      e = { first: now, count: 0, until: 0 };
      this.entries.set(ip, e);
    }
    e.count++;
    if (e.count >= this.max) e.until = now + this.lockMs;
  }

  reset(ip: string): void {
    this.entries.delete(ip);
  }
}

const userKey = (secret: string, userId: string, epoch: number) => `${secret}\0${userId}\0${epoch}`;

/** Sitzung einer Person: `<userId>.<ablauf>.<hmac>`; die Epoche steckt im Schlüssel (neues Passwort → ungültig). */
export function createUserSession(secret: string, userId: string, epoch: number, now: number): string {
  return `${userId}.${createSession(userKey(secret, userId, epoch), now)}`;
}

export function sessionUserId(value: string | undefined): string | null {
  const i = value ? value.indexOf('.') : -1;
  return i > 0 ? value!.slice(0, i) : null;
}

export function verifyUserSession(value: string | undefined, secret: string, userId: string, epoch: number, now: number): boolean {
  if (!value || sessionUserId(value) !== userId) return false;
  return verifySession(value.slice(userId.length + 1), userKey(secret, userId, epoch), now);
}
