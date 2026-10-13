import { newId } from '@naklearn/core';
import { createHash, randomBytes } from 'node:crypto';
import { tx, type Db } from './db.ts';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.ts';

type Row = Record<string, any>;

export interface User {
  id: string;
  name: string;
  isAdmin: boolean;
  sessionEpoch: number;
  createdAt: number;
  lastSeenAt: number | null;
}

/** Fehler mit HTTP-Status für die API (400 ungültig, 404 unbekannt, 409 Konflikt). */
export class AccountError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const INVITE_TTL_MS = 7 * 24 * 3600_000;
const TOUCH_MS = 60_000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');
const newToken = () => randomBytes(32).toString('base64url');
const nameKey = (name: string) => name.trim().toLowerCase();

const toUser = (r: Row): User => ({
  id: r.id, name: r.name, isAdmin: !!r.is_admin, sessionEpoch: r.session_epoch, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? null,
});

function checkName(name: string): string {
  const n = name.trim();
  if (n.length < 2 || n.length > 30) throw new AccountError('Name muss 2–30 Zeichen lang sein');
  return n;
}

function checkPassword(pw: string): void {
  if (pw.length < 8) throw new AccountError('Passwort muss mindestens 8 Zeichen lang sein');
  if (pw.length > 200) throw new AccountError('Passwort ist zu lang');
}

// ---------- Personen ----------

export function getUser(db: Db, id: string): User | undefined {
  const r = db.prepare('SELECT * FROM user WHERE id = ?').get(id) as Row | undefined;
  return r && toUser(r);
}

export function createUser(db: Db, i: { name: string; password: string; isAdmin?: boolean; now: number }): User {
  const name = checkName(i.name);
  checkPassword(i.password);
  if (db.prepare('SELECT 1 FROM user WHERE name_key = ?').get(nameKey(name))) throw new AccountError('Name ist schon vergeben', 409);
  const id = newId();
  db.prepare('INSERT INTO user (id, name, name_key, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, nameKey(name), hashPassword(i.password), i.isAdmin ? 1 : 0, i.now);
  return getUser(db, id)!;
}

export function checkLogin(db: Db, name: string, password: string): User | null {
  const r = db.prepare('SELECT * FROM user WHERE name_key = ?').get(nameKey(name)) as Row | undefined;
  const ok = verifyPassword(password, r?.password_hash ?? DUMMY_HASH);
  return r && ok ? toUser(r) : null;
}

export function setPassword(db: Db, userId: string, password: string): User {
  checkPassword(password);
  db.prepare('UPDATE user SET password_hash = ?, session_epoch = session_epoch + 1 WHERE id = ?').run(hashPassword(password), userId);
  const u = getUser(db, userId);
  if (!u) throw new AccountError('Person nicht gefunden', 404);
  return u;
}

export function touchUser(db: Db, userId: string, now: number): void {
  db.prepare('UPDATE user SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at <= ?)').run(now, userId, now - TOUCH_MS);
}

export interface UserListItem extends User {
  moduleCount: number;
  deviceCount: number;
}

export function listUsers(db: Db): UserListItem[] {
  return (db.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM membership m WHERE m.user_id = u.id) AS module_count,
            (SELECT COUNT(*) FROM device d WHERE d.user_id = u.id) AS device_count
     FROM user u ORDER BY u.name_key`,
  ).all() as Row[]).map((r) => ({ ...toUser(r), moduleCount: r.module_count, deviceCount: r.device_count }));
}

/** Entfernt die Person und alles Persönliche; gemeinsame Inhalte bleiben. */
export function deleteUser(db: Db, userId: string): void {
  tx(db, () => {
    for (const t of ['membership', 'card_flag', 'user_card_state', 'device', 'revlog', 'invite']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    }
    db.prepare('DELETE FROM user WHERE id = ?').run(userId);
  });
}

// ---------- Geräte ----------

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
}

const toDevice = (r: Row): Device => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? null });

export function addDevice(db: Db, userId: string, name: string, now: number, token = newToken()): { device: Device; token: string } {
  const id = newId();
  const label = name.trim().slice(0, 60) || 'Handy';
  db.prepare('INSERT INTO device (id, user_id, token_hash, name, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, hashToken(token), label, now);
  return { device: toDevice(db.prepare('SELECT * FROM device WHERE id = ?').get(id) as Row), token };
}

export function authenticateToken(db: Db, token: string, now: number): { user: User; deviceId: string } | null {
  const r = db.prepare(
    'SELECT d.id AS device_id, d.last_seen_at AS device_seen, u.* FROM device d JOIN user u ON u.id = d.user_id WHERE d.token_hash = ?',
  ).get(hashToken(token)) as Row | undefined;
  if (!r) return null;
  if (r.device_seen === null || r.device_seen <= now - TOUCH_MS) {
    db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').run(now, r.device_id);
  }
  return { user: toUser(r), deviceId: r.device_id };
}

export function listDevices(db: Db, userId: string): Device[] {
  return (db.prepare('SELECT * FROM device WHERE user_id = ? ORDER BY created_at').all(userId) as Row[]).map(toDevice);
}

export function removeDevice(db: Db, userId: string, deviceId: string): boolean {
  const r = db.prepare('DELETE FROM device WHERE id = ? AND user_id = ? RETURNING id').get(deviceId, userId);
  return !!r;
}

// ---------- Einladungen und Zurücksetzen ----------

export function createInvite(db: Db, i: { userId?: string | null; now: number }): string {
  const token = newToken();
  db.prepare('INSERT INTO invite (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), i.userId ?? null, i.now, i.now + INVITE_TTL_MS);
  return token;
}

function openInvite(db: Db, token: string, now: number): Row | undefined {
  return db.prepare('SELECT * FROM invite WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(hashToken(token), now) as Row | undefined;
}

export function inviteInfo(db: Db, token: string, now: number): { kind: 'invite' | 'reset'; name: string | null } | null {
  const inv = openInvite(db, token, now);
  if (!inv) return null;
  if (!inv.user_id) return { kind: 'invite', name: null };
  const u = getUser(db, inv.user_id);
  return u ? { kind: 'reset', name: u.name } : null;
}

export function acceptInvite(db: Db, token: string, i: { name?: string; password: string; now: number }): User {
  return tx(db, () => {
    const inv = openInvite(db, token, i.now);
    if (!inv || (inv.user_id && !getUser(db, inv.user_id))) {
      throw new AccountError('Link ist ungültig, abgelaufen oder schon benutzt', 404);
    }
    const user = inv.user_id
      ? setPassword(db, inv.user_id, i.password)
      : createUser(db, { name: i.name ?? '', password: i.password, now: i.now });
    db.prepare('UPDATE invite SET used_at = ? WHERE token_hash = ?').run(i.now, inv.token_hash);
    if (inv.user_id) {
      // Reset heißt: Passwort vergessen oder kompromittiert → auch App-Zugänge und weitere offene Links der Person enden.
      db.prepare('DELETE FROM device WHERE user_id = ?').run(inv.user_id);
      db.prepare('UPDATE invite SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(i.now, inv.user_id);
    }
    return user;
  });
}
