import { mkdtemp } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import * as repo from '../src/repo.ts';
import { memDb } from './helpers.ts';
import { makePdf } from './makePdf.ts';

async function setup() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'kartei-app-'));
  for (const d of ['pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });
  const cfg: Config = {
    dataDir, port: 0, host: '127.0.0.1', token: 'secret', deviceId: 'laptop',
    claudePath: '/bin/false', claudeModel: null, webDir: null,
  };
  const db = memDb();
  let woke = 0;
  const worker = { wake: () => void woke++, resume: () => {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
  const app = buildApp({ db, cfg, worker });
  return { app, db, cfg, woke: () => woke };
}

function multipart(files: { name: string; data: Buffer }[]) {
  const b = '----kartei' + Date.now();
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

  it('verlangt außerhalb von Loopback ein Token', async () => {
    const { app } = await setup();
    const remote = { remoteAddress: '100.64.1.2' };
    expect((await app.inject({ method: 'GET', url: '/api/overview', ...remote })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/api/overview', headers: { authorization: 'Bearer secret' }, ...remote });
    expect(ok.statusCode).toBe(200);
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
    expect((await app.inject({ method: 'GET', url: `/api/slides/${deck.id}/..%2F..%2Fkartei.db` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/slides/${deck.id}/2.jpg` })).statusCode).toBe(404);
  });
});
