import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDevice, createUser } from '../src/accounts.ts';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { memDb } from './helpers.ts';

function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'naklearn-acc-'));
  for (const d of ['pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });
  const cfg: Config = {
    dataDir, port: 0, host: '127.0.0.1', token: 'legacy', deviceId: 'server', password: null, adminName: 'luna',
    sessionSecret: 'session-secret', publicUrl: 'https://naklearn.example', claudePath: '/bin/false',
    summaryModel: null, cardsModel: null, webDir: null,
  };
  const db = memDb();
  let t = new Date('2026-10-21T10:00:00+09:00').getTime();
  const worker = { wake: () => {}, resume: () => {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
  const app = buildApp({ db, cfg, worker, now: () => t });
  const luna = createUser(db, { name: 'Luna', password: 'luna-pass-1', isAdmin: true, now: t });
  const mia = createUser(db, { name: 'Mia', password: 'mia-pass-1', now: t });
  return { app, db, luna, mia, advance: (ms: number) => void (t += ms), now: () => t };
}

type App = ReturnType<typeof setup>['app'];
async function login(app: App, name: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { name, password } });
  return { r, cookie: r.statusCode === 200 ? String(r.headers['set-cookie']).split(';')[0]! : '' };
}

describe('Login im Browser', () => {
  it('meldet mit Name+Passwort an, /api/me kennt die Person', async () => {
    const { app } = setup();
    const { r, cookie } = await login(app, 'luna', 'luna-pass-1');
    expect(r.json()).toMatchObject({ name: 'Luna', isAdmin: true });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json()).toMatchObject({ name: 'Luna' });
  });
  it('gleiche Meldung für falsches Passwort und unbekannten Namen', async () => {
    const { app } = setup();
    const a = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'falsch-123' } });
    const b = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Niemand', password: 'falsch-123' } });
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
    expect(a.json()).toEqual({ error: 'Name oder Passwort falsch' });
    expect(b.json()).toEqual(a.json());
  });
  it('Bremse gilt für Browser- und App-Login gemeinsam', async () => {
    const { app } = setup();
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'x' } });
    for (let i = 0; i < 2; i++) await app.inject({ method: 'POST', url: '/api/device/login', payload: { name: 'Luna', password: 'x' } });
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'luna-pass-1' } })).statusCode).toBe(429);
  });
  it('erfolgreicher Login einer anderen Person setzt die Bremse nicht zurück', async () => {
    const { app } = setup();
    for (let i = 0; i < 4; i++) await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'x' } });
    expect((await login(app, 'Mia', 'mia-pass-1')).r.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'x' } });
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'luna-pass-1' } })).statusCode).toBe(429);
  });
  it('Passwort ändern beendet alte Sitzungen, die aktuelle bekommt ein neues Cookie', async () => {
    const { app } = setup();
    const first = (await login(app, 'Mia', 'mia-pass-1')).cookie;
    const second = (await login(app, 'Mia', 'mia-pass-1')).cookie;
    const bad = await app.inject({ method: 'POST', url: '/api/me/password', headers: { cookie: second }, payload: { old: 'falsch-123', new: 'neues-pass-1' } });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/api/me/password', headers: { cookie: second }, payload: { old: 'mia-pass-1', new: 'neues-pass-1' } });
    expect(r.statusCode).toBe(200);
    const fresh = String(r.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: first } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: fresh } })).statusCode).toBe(200);
  });
});

describe('App-Login und Geräte', () => {
  it('liefert ein Gerätetoken; Entfernen macht es ungültig', async () => {
    const { app } = setup();
    const r = await app.inject({ method: 'POST', url: '/api/device/login', payload: { name: 'mia', password: 'mia-pass-1', deviceName: 'Pixel' } });
    expect(r.statusCode).toBe(200);
    const { token, user } = r.json();
    expect(user).toMatchObject({ name: 'Mia' });
    const auth = { authorization: `Bearer ${token}` };
    const devices = (await app.inject({ method: 'GET', url: '/api/me/devices', headers: auth })).json();
    expect(devices).toMatchObject([{ name: 'Pixel' }]);
    expect((await app.inject({ method: 'DELETE', url: `/api/me/devices/${devices[0].id}`, headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth })).statusCode).toBe(401);
  });
  it('App-Login funktioniert mit fremder Origin (Capacitor WebView)', async () => {
    const { app } = setup();
    const r = await app.inject({
      method: 'POST',
      url: '/api/device/login',
      headers: { origin: 'https://localhost', host: 'naklearn.example' },
      payload: { name: 'mia', password: 'mia-pass-1', deviceName: 'Pixel' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty('token');
    // Browser-Login muss weiterhin gegen CSRF geschützt sein
    const browserLogin = await app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin: 'https://localhost', host: 'naklearn.example' },
      payload: { name: 'mia', password: 'mia-pass-1' },
    });
    expect(browserLogin.statusCode).toBe(403);
  });
  it.each(['capacitor://localhost', 'ionic://localhost'])('iOS-App mit Origin %s: Login und schreibende Requests mit Token', async (origin) => {
    const { app } = setup();
    const headers = { origin, host: 'naklearn.example' };
    const r = await app.inject({ method: 'POST', url: '/api/device/login', headers, payload: { name: 'mia', password: 'mia-pass-1', deviceName: 'iPhone' } });
    expect(r.statusCode).toBe(200);
    const auth = { ...headers, authorization: `Bearer ${r.json().token}` };
    const created = await app.inject({ method: 'POST', url: '/api/modules', headers: auth, payload: { name: 'Mathe', language: 'de' } });
    expect(created.statusCode).toBe(200);
    // ohne Token (Cookie-Sitzung) bleibt die fremde Origin gesperrt
    expect((await app.inject({ method: 'POST', url: '/api/login', headers, payload: { name: 'mia', password: 'mia-pass-1' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/modules', headers, payload: { name: 'X', language: 'de' } })).statusCode).toBe(403);
  });
  it('fremde Geräte lassen sich nicht entfernen', async () => {
    const { app, db, luna, mia } = setup();
    const { device } = addDevice(db, luna.id, 'Lunas Handy', 0);
    const { token } = addDevice(db, mia.id, 'Mias Handy', 0);
    const r = await app.inject({ method: 'DELETE', url: `/api/me/devices/${device.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(404);
  });
});

describe('Einladungen und Personen', () => {
  it('nur der Admin lädt ein; der Link legt ein Konto an und meldet an', async () => {
    const { app } = setup();
    const mia = (await login(app, 'Mia', 'mia-pass-1')).cookie;
    expect((await app.inject({ method: 'POST', url: '/api/invites', headers: { cookie: mia } })).statusCode).toBe(403);
    const luna = (await login(app, 'Luna', 'luna-pass-1')).cookie;
    const { url } = (await app.inject({ method: 'POST', url: '/api/invites', headers: { cookie: luna } })).json();
    expect(url).toMatch(/^https:\/\/naklearn\.example\/#\/einladung\/[A-Za-z0-9_-]{43}$/);
    const token = url.split('/').pop();
    expect((await app.inject({ method: 'GET', url: `/api/invites/${token}` })).json()).toEqual({ kind: 'invite', name: null });
    const acc = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, payload: { name: 'Ben', password: 'ben-pass-1' } });
    expect(acc.statusCode).toBe(200);
    const ben = String(acc.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: ben } })).json()).toMatchObject({ name: 'Ben', isAdmin: false });
    expect((await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, payload: { name: 'Ben2', password: 'ben-pass-1' } })).statusCode).toBe(404);
  });
  it('ungültige Einladungslinks zählen für die Bremse', async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: `/api/invites/${'x'.repeat(43)}/accept`, payload: { name: 'Ben', password: 'ben-pass-1' } });
    }
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Luna', password: 'luna-pass-1' } })).statusCode).toBe(429);
  });
  it('Reset-Link und Personen-Liste, Löschen nicht von sich selbst', async () => {
    const { app, db, mia, luna } = setup();
    const admin = (await login(app, 'Luna', 'luna-pass-1')).cookie;
    const list = (await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: admin } })).json();
    expect(list.map((u: { name: string }) => u.name)).toEqual(['Luna', 'Mia']);
    const { url } = (await app.inject({ method: 'POST', url: `/api/users/${mia.id}/reset`, headers: { cookie: admin } })).json();
    const token = url.split('/').pop();
    expect((await app.inject({ method: 'GET', url: `/api/invites/${token}` })).json()).toEqual({ kind: 'reset', name: 'Mia' });
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${luna.id}`, headers: { cookie: admin } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${mia.id}`, headers: { cookie: admin } })).statusCode).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user').get()).toEqual({ n: 1 });
  });
});
