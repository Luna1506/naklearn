import { describe, expect, it } from 'vitest';
import {
  AccountError, INVITE_TTL_MS, acceptInvite, addDevice, authenticateToken, checkLogin, createInvite, createUser,
  deleteUser, getUser, inviteInfo, listDevices, listUsers, removeDevice, setPassword, touchUser,
} from '../src/accounts.ts';
import { memDb } from './helpers.ts';

const NOW = 1_800_000_000_000;

describe('Konten', () => {
  it('legt Personen an, Namen sind ohne Groß/Klein eindeutig', () => {
    const db = memDb();
    const u = createUser(db, { name: '  Luna ', password: 'geheim123', isAdmin: true, now: NOW });
    expect(u).toMatchObject({ name: 'Luna', isAdmin: true, sessionEpoch: 0, createdAt: NOW });
    expect(() => createUser(db, { name: 'luna', password: 'geheim123', now: NOW })).toThrow(/vergeben/);
    expect(() => createUser(db, { name: 'L', password: 'geheim123', now: NOW })).toThrow(/2–30/);
    expect(() => createUser(db, { name: 'Mia', password: 'kurz', now: NOW })).toThrow(/8 Zeichen/);
    try { createUser(db, { name: 'LUNA', password: 'geheim123', now: NOW }); } catch (e) { expect((e as AccountError).statusCode).toBe(409); }
  });

  it('Login: richtig, falsch, unbekannt; Name ohne Groß/Klein', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    expect(checkLogin(db, 'luna', 'geheim123')?.id).toBe(u.id);
    expect(checkLogin(db, 'Luna', 'falsch123')).toBeNull();
    expect(checkLogin(db, 'Niemand', 'geheim123')).toBeNull();
  });

  it('neues Passwort erhöht die Sitzungs-Epoche', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    const after = setPassword(db, u.id, 'neuesPasswort');
    expect(after.sessionEpoch).toBe(1);
    expect(checkLogin(db, 'Luna', 'neuesPasswort')).not.toBeNull();
    expect(checkLogin(db, 'Luna', 'geheim123')).toBeNull();
    expect(() => setPassword(db, u.id, 'kurz')).toThrow(/8 Zeichen/);
  });

  it('zuletzt aktiv wird höchstens einmal pro Minute geschrieben', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    touchUser(db, u.id, NOW);
    touchUser(db, u.id, NOW + 30_000);
    expect(getUser(db, u.id)!.lastSeenAt).toBe(NOW);
    touchUser(db, u.id, NOW + 61_000);
    expect(getUser(db, u.id)!.lastSeenAt).toBe(NOW + 61_000);
  });

  it('Personen-Liste zählt Module und Geräte; Löschen entfernt Persönliches', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Mia', password: 'geheim123', now: NOW });
    addDevice(db, u.id, 'Pixel', NOW);
    db.prepare("INSERT INTO membership (user_id, module_id, updated_at) VALUES (?, 'm1', 0)").run(u.id);
    db.prepare("INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, user_id) VALUES ('r1', 'c1', 3, 1, 1, 'd', ?)").run(u.id);
    expect(listUsers(db)).toMatchObject([{ name: 'Mia', moduleCount: 1, deviceCount: 1 }]);
    deleteUser(db, u.id);
    expect(getUser(db, u.id)).toBeUndefined();
    for (const t of ['membership', 'device', 'revlog']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(0);
    }
  });
});

describe('Geräte', () => {
  it('Token meldet die Person an, gespeichert wird nur der Hash; Entfernen macht es ungültig', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    const { device, token } = addDevice(db, u.id, '  Pixel 8 ', NOW);
    expect(device.name).toBe('Pixel 8');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(db.prepare('SELECT * FROM device').all())).not.toContain(token);
    expect(authenticateToken(db, token, NOW)).toMatchObject({ user: { id: u.id }, deviceId: device.id });
    expect(listDevices(db, u.id)[0]!.lastSeenAt).toBe(NOW);
    expect(authenticateToken(db, 'falsch', NOW)).toBeNull();
    expect(removeDevice(db, 'jemand-anders', device.id)).toBe(false);
    expect(removeDevice(db, u.id, device.id)).toBe(true);
    expect(authenticateToken(db, token, NOW)).toBeNull();
  });
  it('übernimmt ein vorhandenes Token (Altbestand)', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    addDevice(db, u.id, 'Bisheriges Handy', NOW, 'altes-token');
    expect(authenticateToken(db, 'altes-token', NOW)?.user.id).toBe(u.id);
  });
});

describe('Einladungen', () => {
  it('Einladung: Info, Annahme legt Konto an, Link nur einmal', () => {
    const db = memDb();
    const token = createInvite(db, { now: NOW });
    expect(inviteInfo(db, token, NOW)).toEqual({ kind: 'invite', name: null });
    const u = acceptInvite(db, token, { name: 'Mia', password: 'geheim123', now: NOW + 1 });
    expect(u.name).toBe('Mia');
    expect(inviteInfo(db, token, NOW + 2)).toBeNull();
    expect(() => acceptInvite(db, token, { name: 'Ben', password: 'geheim123', now: NOW + 2 })).toThrow(/ungültig/);
  });
  it('abgelaufen nach 7 Tagen', () => {
    const db = memDb();
    const token = createInvite(db, { now: NOW });
    expect(inviteInfo(db, token, NOW + INVITE_TTL_MS)).toBeNull();
  });
  it('fehlerhafte Eingabe lässt den Link gültig', () => {
    const db = memDb();
    createUser(db, { name: 'Luna', password: 'geheim123', now: NOW });
    const token = createInvite(db, { now: NOW });
    expect(() => acceptInvite(db, token, { name: 'luna', password: 'geheim123', now: NOW })).toThrow(/vergeben/);
    expect(() => acceptInvite(db, token, { name: 'Mia', password: 'kurz', now: NOW })).toThrow(/8 Zeichen/);
    expect(inviteInfo(db, token, NOW)).not.toBeNull();
  });
  it('Reset-Link setzt das Passwort der Person und beendet ihre Sitzungen', () => {
    const db = memDb();
    const u = createUser(db, { name: 'Mia', password: 'geheim123', now: NOW });
    const token = createInvite(db, { userId: u.id, now: NOW });
    expect(inviteInfo(db, token, NOW)).toEqual({ kind: 'reset', name: 'Mia' });
    const after = acceptInvite(db, token, { password: 'neuesPasswort', now: NOW });
    expect(after.sessionEpoch).toBe(1);
    expect(checkLogin(db, 'Mia', 'neuesPasswort')).not.toBeNull();
  });
});
