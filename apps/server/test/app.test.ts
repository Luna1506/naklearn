import { mkdtemp } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import * as repo from '../src/repo.ts';
import { memDb } from './helpers.ts';
import { makePdf } from './makePdf.ts';

async function setup(opts: { webDir?: boolean } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'naklearn-app-'));
  for (const d of ['pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });
  let webDir: string | null = null;
  if (opts.webDir) {
    webDir = path.join(dataDir, 'web');
    mkdirSync(webDir);
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>NAKLearn</title>');
  }
  const cfg: Config = {
    dataDir, port: 0, host: '127.0.0.1', token: 'secret', deviceId: 'laptop',
    password: 'pw', adminName: 'luna', sessionSecret: 'session-secret', publicUrl: 'https://naklearn.example',
    claudePath: '/bin/false', summaryModel: null, cardsModel: null, webDir,
  };
  const db = memDb();
  let woke = 0;
  let t = new Date('2026-10-13T10:00:00+09:00').getTime();
  const worker = { wake: () => void woke++, resume: () => {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
  const raw = buildApp({ db, cfg, worker, now: () => t });
  // Standardmäßig wie die App mit Token; Auth-Tests verwenden `raw`.
  const app = { inject: (o: InjectOptions) => raw.inject({ ...o, headers: { authorization: 'Bearer secret', ...o.headers } }) };
  return { app, raw, db, cfg, woke: () => woke, advance: (ms: number) => void (t += ms) };
}

/** Meldet sich an und liefert den Cookie-Header für Folgeanfragen. */
async function login(raw: Awaited<ReturnType<typeof setup>>['raw'], password = 'pw') {
  const r = await raw.inject({ method: 'POST', url: '/api/login', payload: { password } });
  expect(r.statusCode).toBe(200);
  return String(r.headers['set-cookie']).split(';')[0]!;
}

function multipart(files: { name: string; data: Buffer }[]) {
  const b = '----naklearn' + Date.now();
  const parts = files.map((f) =>
    Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      f.data,
      Buffer.from('\r\n'),
    ]),
  );
  return { payload: Buffer.concat([...parts, Buffer.from(`--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

describe('HTTP-API', () => {
  it('legt Module an, ändert und listet sie in der Übersicht', async () => {
    const { app } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/modules', payload: { name: 'UI/UX', language: 'en' } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    const patched = await app.inject({ method: 'PATCH', url: `/api/modules/${id}`, payload: { examDate: '2026-10-30' } });
    expect(patched.json().examDate).toBe('2026-10-30');
    const ov = await app.inject({ method: 'GET', url: '/api/overview' });
    expect(ov.json().modules[0]).toMatchObject({ name: 'UI/UX', examDate: '2026-10-30' });
  });

  it('validiert Eingaben', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/modules', payload: { name: '', language: 'fr' } });
    expect(r.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/modules/nope' })).statusCode).toBe(404);
  });

  it('nimmt PDFs an, überspringt Duplikate und Nicht-PDFs', async () => {
    const { app, db, cfg, woke } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const pdf = makePdf(['One']);
    const first = await app.inject({ method: 'POST', url: `/api/modules/${mod.id}/upload`, ...multipart([{ name: 'Ch1.pdf', data: pdf }, { name: 'notes.txt', data: Buffer.from('x') }]) });
    expect(first.statusCode).toBe(200);
    expect(first.json().created).toHaveLength(1);
    expect(first.json().created[0]).toMatchObject({ title: 'Ch1', status: 'pending' });
    expect(first.json().skipped).toEqual([{ file: 'notes.txt', reason: 'keine PDF' }]);
    expect(woke()).toBe(1);
    const again = await app.inject({ method: 'POST', url: `/api/modules/${mod.id}/upload`, ...multipart([{ name: 'Kopie.pdf', data: pdf }]) });
    expect(again.json()).toEqual({ created: [], skipped: [{ file: 'Kopie.pdf', reason: 'bereits hochgeladen (Ch1)' }] });
    const deck = first.json().created[0];
    const detail = await app.inject({ method: 'GET', url: `/api/decks/${deck.id}` });
    expect(detail.json().jobs[0]).toMatchObject({ kind: 'render', status: 'queued' });
    expect(cfg.dataDir).toBeTruthy();
  });

  it('Neu erzeugen mit includeReviewed löscht auch gelernte Karten', async () => {
    const { app, db } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' });
    repo.updateDeck(db, deck.id, { pageCount: 3, summary: 'alt' });
    const { cards } = repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 });
    repo.insertRevlog(db, { id: 'r', cardId: cards[0]!.id, rating: 3, reviewedAt: 1, durationMs: 1, deviceId: 'x', revokes: null });
    const r = await app.inject({ method: 'POST', url: `/api/decks/${deck.id}/regenerate`, payload: { includeReviewed: true } });
    expect(r.statusCode).toBe(200);
    expect(repo.listNotes(db, { deckId: deck.id })).toHaveLength(0);
    const detail = (await app.inject({ method: 'GET', url: `/api/decks/${deck.id}` })).json();
    expect(detail.deck.summary).toBeNull();
    expect(detail.jobs.map((j: { kind: string }) => j.kind)).toEqual(['summary', 'cards']);
  });

  it('POST /api/sync validiert und liefert Pull-Daten', async () => {
    const { app, db } = await setup();
    repo.createModule(db, { name: 'M', language: 'en' });
    const bad = await app.inject({ method: 'POST', url: '/api/sync', payload: { deviceId: '', cursor: 0, push: {} } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST', url: '/api/sync',
      payload: { deviceId: 'phone', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pull.modules[0].name).toBe('M');
  });

  it('Lernablauf: nächste Karte, bewerten, rückgängig', async () => {
    const { app, db } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' });
    repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 });
    const next = (await app.inject({ method: 'GET', url: `/api/study/next?moduleId=${mod.id}` })).json();
    expect(next.card.front).toBe('Q');
    const ans = await app.inject({ method: 'POST', url: '/api/study/answer', payload: { cardId: next.card.cardId, rating: 3, durationMs: 1200 } });
    expect(ans.json().revlogId).toBeTruthy();
    const bad = await app.inject({ method: 'POST', url: '/api/study/answer', payload: { cardId: next.card.cardId, rating: 7, durationMs: 1 } });
    expect(bad.statusCode).toBe(400);
    const und = await app.inject({ method: 'POST', url: '/api/study/undo', payload: { revlogId: ans.json().revlogId } });
    expect(und.json()).toEqual({ ok: true });
  });

  it('bearbeitet Notes und pausiert Karten', async () => {
    const { app, db } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' });
    const { note, cards } = repo.insertNote(db, { deckId: deck.id, kind: 'cloze', front: '{{c1::A}}', back: '', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 });
    const upd = await app.inject({ method: 'PATCH', url: `/api/notes/${note.id}`, payload: { front: '{{c1::A}} {{c2::B}}' } });
    expect(upd.json().cards.filter((c: { deleted: boolean }) => !c.deleted)).toHaveLength(2);
    await app.inject({ method: 'POST', url: `/api/cards/${cards[0]!.id}/suspend`, payload: { suspended: true } });
    expect(repo.getCard(db, cards[0]!.id)!.suspended).toBe(true);
    const list = await app.inject({ method: 'GET', url: `/api/notes?moduleId=${mod.id}&q=B` });
    expect(list.json()).toHaveLength(1);
  });

  it('liefert Folienbilder und lehnt ungültige Dateinamen ab', async () => {
    const { app, db, cfg } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' });
    mkdirSync(path.join(cfg.dataDir, 'slides', deck.id), { recursive: true });
    writeFileSync(path.join(cfg.dataDir, 'slides', deck.id, '1.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    const img = await app.inject({ method: 'GET', url: `/api/slides/${deck.id}/1.jpg` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect((await app.inject({ method: 'GET', url: `/api/slides/${deck.id}/..%2F..%2Fnaklearn.db` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/slides/${deck.id}/2.jpg` })).statusCode).toBe(404);
  });
});

describe('Anmeldung', () => {
  it('ohne Token und Sitzung gibt es 401, mit Token 200', async () => {
    const { raw } = await setup();
    expect((await raw.inject({ method: 'GET', url: '/api/overview' })).statusCode).toBe(401);
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { authorization: 'Bearer falsch' } })).statusCode).toBe(401);
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { authorization: 'Bearer secret' } })).statusCode).toBe(200);
    expect((await raw.inject({ method: 'GET', url: '/api/gibtsnicht' })).statusCode).toBe(401);
  });

  it('Login setzt ein Cookie, das bis zum Ablauf gilt', async () => {
    const { raw, advance } = await setup();
    const cookie = await login(raw);
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { cookie } })).statusCode).toBe(200);
    advance(30 * 24 * 3600_000);
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { cookie } })).statusCode).toBe(401);
  });

  it('manipuliertes Cookie gilt nicht', async () => {
    const { raw } = await setup();
    const cookie = await login(raw);
    const [name, value] = cookie.split('=');
    const [exp, mac] = value!.split('.');
    const forged = `${name}=${Number(exp) + 86_400_000}.${mac}`;
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { cookie: forged } })).statusCode).toBe(401);
  });

  it('Secure nur hinter HTTPS-Proxy', async () => {
    const { raw } = await setup();
    const plain = await raw.inject({ method: 'POST', url: '/api/login', payload: { password: 'pw' } });
    expect(String(plain.headers['set-cookie'])).not.toContain('Secure');
    const https = await raw.inject({ method: 'POST', url: '/api/login', payload: { password: 'pw' }, headers: { 'x-forwarded-proto': 'https' } });
    expect(String(https.headers['set-cookie'])).toContain('Secure');
  });

  it('falsches Passwort 401, nach 5 Fehlversuchen 429 – auch mit richtigem Passwort, andere IP frei', async () => {
    const { raw, advance } = await setup();
    const from = (ip: string, password: string) =>
      raw.inject({ method: 'POST', url: '/api/login', payload: { password }, remoteAddress: '172.18.0.2', headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < 5; i++) expect((await from('9.9.9.9', 'falsch')).statusCode).toBe(401);
    expect((await from('9.9.9.9', 'pw')).statusCode).toBe(429);
    expect((await from('8.8.8.8', 'pw')).statusCode).toBe(200);
    advance(15 * 60_000);
    expect((await from('9.9.9.9', 'pw')).statusCode).toBe(200);
  });

  it('gefälschtes X-Forwarded-For umgeht die Sperre nicht', async () => {
    const { raw } = await setup();
    const from = (xff: string, password: string) =>
      raw.inject({ method: 'POST', url: '/api/login', payload: { password }, remoteAddress: '172.18.0.2', headers: { 'x-forwarded-for': xff } });
    for (let i = 0; i < 5; i++) await from(`10.0.0.${i}, 9.9.9.9`, 'falsch');
    expect((await from('1.2.3.4, 9.9.9.9', 'pw')).statusCode).toBe(429);
  });

  it('hinter Cloudflare zählt die echte Client-IP, gefälschter Header ohne Cloudflare zählt nicht', async () => {
    const { raw } = await setup();
    const via = (edge: string, client: string, password: string) =>
      raw.inject({ method: 'POST', url: '/api/login', payload: { password }, remoteAddress: '172.18.0.2', headers: { 'x-forwarded-for': `${client}, ${edge}`, 'cf-connecting-ip': client } });
    for (let i = 0; i < 5; i++) expect((await via('104.16.0.5', '9.9.9.9', 'falsch')).statusCode).toBe(401);
    expect((await via('104.16.0.5', '9.9.9.9', 'pw')).statusCode).toBe(429);
    // anderer Nutzer über denselben Cloudflare-Knoten ist nicht gesperrt
    expect((await via('104.16.0.5', '8.8.8.8', 'pw')).statusCode).toBe(200);
    // direkt (ohne Cloudflare) mit wechselndem Header: Sperre greift trotzdem
    for (let i = 0; i < 5; i++) await via('5.5.5.5', `10.0.0.${i}`, 'falsch');
    expect((await via('5.5.5.5', '10.0.0.99', 'pw')).statusCode).toBe(429);
  });

  it('leitet HTTP hinter dem Proxy auf die HTTPS-Adresse um', async () => {
    const { raw } = await setup({ webDir: true });
    const r = await raw.inject({ method: 'GET', url: '/api/health?x=1', headers: { 'x-forwarded-proto': 'http' } });
    expect(r.statusCode).toBe(301);
    expect(r.headers.location).toBe('https://naklearn.example/api/health?x=1');
    expect((await raw.inject({ method: 'GET', url: '/', headers: { 'x-forwarded-proto': 'https' } })).statusCode).toBe(200);
    expect((await raw.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
  });

  it('Logout löscht das Cookie, auch ohne gültige Sitzung', async () => {
    const { raw } = await setup();
    const r = await raw.inject({ method: 'POST', url: '/api/logout' });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('Health und Web-Client ohne Login', async () => {
    const { raw } = await setup({ webDir: true });
    expect((await raw.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
    const page = await raw.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('NAKLearn');
  });

  it('Folienbilder mit Sitzung (Browser-img), ohne 401', async () => {
    const { raw, db, cfg } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' });
    mkdirSync(path.join(cfg.dataDir, 'slides', deck.id), { recursive: true });
    writeFileSync(path.join(cfg.dataDir, 'slides', deck.id, '1.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    const url = `/api/slides/${deck.id}/1.jpg`;
    expect((await raw.inject({ method: 'GET', url })).statusCode).toBe(401);
    const cookie = await login(raw);
    expect((await raw.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(200);
  });

  it('CSRF: Sitzung mit fremder Origin wird abgelehnt, App mit Token und Origin nicht', async () => {
    const { raw } = await setup();
    const cookie = await login(raw);
    const evil = await raw.inject({ method: 'POST', url: '/api/worker/resume', headers: { cookie, host: 'naklearn.example', origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    const same = await raw.inject({ method: 'POST', url: '/api/worker/resume', headers: { cookie, host: 'naklearn.example', origin: 'https://naklearn.example' } });
    expect(same.statusCode).toBe(200);
    const app = await raw.inject({
      method: 'POST', url: '/api/sync', headers: { authorization: 'Bearer secret', host: 'naklearn.example', origin: 'https://localhost' },
      payload: { deviceId: 'phone', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } },
    });
    expect(app.statusCode).toBe(200);
  });

  it('Koppeln nur mit Sitzung, Adresse aus der Konfiguration', async () => {
    const { raw } = await setup();
    expect((await raw.inject({ method: 'GET', url: '/api/pair', headers: { authorization: 'Bearer secret' } })).statusCode).toBe(401);
    const cookie = await login(raw);
    const r = await raw.inject({ method: 'GET', url: '/api/pair', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ url: 'https://naklearn.example', token: 'secret' });
    expect(JSON.parse(r.json().payload)).toEqual({ v: 1, url: 'https://naklearn.example', token: 'secret' });
    expect(r.json().qrSvg).toContain('<svg');
  });
});

describe('Passwortwechsel', () => {
  it('beendet bestehende Sitzungen', async () => {
    const { raw, db, cfg } = await setup();
    const cookie = await login(raw);
    const worker = { wake: () => {}, resume: () => {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
    const now = () => new Date('2026-10-13T10:00:00+09:00').getTime();
    const restarted = buildApp({ db, cfg, worker, now });
    expect((await restarted.inject({ method: 'GET', url: '/api/overview', headers: { cookie } })).statusCode).toBe(200);
    const newPassword = buildApp({ db, cfg: { ...cfg, password: 'neu' }, worker, now });
    expect((await newPassword.inject({ method: 'GET', url: '/api/overview', headers: { cookie } })).statusCode).toBe(401);
  });
});
