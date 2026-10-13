import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash, ...rest] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash || rest.length) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = scryptSync(pw, Buffer.from(salt, 'base64url'), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Für unbekannte Namen: genauso teuer vergleichen, damit die Antwortzeit nichts verrät. */
export const DUMMY_HASH = hashPassword('naklearn-dummy');
