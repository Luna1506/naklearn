import type { InjectOptions } from 'fastify';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDevice, createUser } from '../src/accounts.ts';
import { buildApp } from '../src/app.ts';
import { createChat } from '../src/chat.ts';
import type { ClaudeRequest, ClaudeResult } from '../src/claude.ts';
import type { Config } from '../src/config.ts';
import * as repo from '../src/repo.ts';
import { memDb } from './helpers.ts';

const NOW = new Date('2026-10-15T18:00:00+09:00').getTime();

async function setup(reply: (req: ClaudeRequest) => Promise<ClaudeResult> = async () => ({ ok: true, output: 'Weil **IaaS** …', usage: null })) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'naklearn-chat-'));
  const cfg: Config = {
    dataDir, port: 0, host: '127.0.0.1', token: 'secret', deviceId: 'laptop', password: null, adminName: 'luna',
    sessionSecret: 's', publicUrl: null, claudePath: '/bin/false', summaryModel: 'sonnet', cardsModel: 'opus', webDir: null,
  };
  const db = memDb();
  const calls: ClaudeRequest[] = [];
  const chat = createChat({ db, dataDir, model: 'sonnet', runClaude: (req) => { calls.push(req); return reply(req); } });
  const worker = { wake() {}, resume() {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
  const raw = buildApp({ db, cfg, worker, chat, now: () => NOW });
  const user = createUser(db, { name: 'riyq', password: 'pw-riyq-123', isAdmin: false, now: NOW });
  const { token } = addDevice(db, user.id, 'Handy', NOW);
  const mod = repo.createModule(db, { name: 'Cloud Security', language: 'en', createdBy: user.id }, NOW);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'week3-1', pdfSha256: 's' }, NOW);
  repo.replaceSlides(db, deck.id, [
    { deckId: deck.id, page: 1, text: 'Titelfolie', image: '1.jpg' },
    { deckId: deck.id, page: 2, text: 'IaaS: provider manages hardware', image: '2.jpg' },
  ]);
  const { note, cards } = repo.insertNote(db, {
    deckId: deck.id, kind: 'qa', front: 'What is IaaS?', back: 'Infrastructure as a Service', slideRefs: [2],
    frontImagePage: null, tags: [], source: 'chunk', position: 0,
  }, NOW);
  repo.setNoteTranslation(db, note.id, note, { frontDe: 'Was ist IaaS?', backDe: 'Infrastruktur als Dienst' });
  const app = { inject: (o: InjectOptions) => raw.inject({ ...o, headers: { authorization: `Bearer ${token}`, ...o.headers } }) };
  return { app, raw, calls, cardId: cards[0]!.id, dataDir, deckId: deck.id };
}

const ask = (cardId: string, messages: { role: 'user' | 'assistant'; content: string }[]) =>
  ({ method: 'POST' as const, url: `/api/cards/${cardId}/ask`, payload: { messages } });

describe('KI-Chat zu einer Karte', () => {
  it('antwortet über Claude mit Karte, Übersetzung, Folientext und Verlauf im Prompt', async () => {
    const { app, calls, cardId, dataDir, deckId } = await setup();
    const r = await app.inject(ask(cardId, [
      { role: 'user', content: 'Was macht der Anbieter?' },
      { role: 'assistant', content: 'Er verwaltet die Hardware.' },
      { role: 'user', content: 'Und der Kunde?' },
    ]));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ answer: 'Weil **IaaS** …' });
    const req = calls[0]!;
    expect(req.jsonSchema).toBeUndefined();
    expect(req.model).toBe('sonnet');
    expect(req.addDirs).toEqual([path.join(dataDir, 'slides', deckId)]);
    for (const part of ['Cloud Security', 'week3-1', 'What is IaaS?', 'Infrastructure as a Service', 'Was ist IaaS?',
      'IaaS: provider manages hardware', 'Was macht der Anbieter?', 'Er verwaltet die Hardware.', 'Und der Kunde?', '2.jpg']) {
      expect(req.prompt).toContain(part);
    }
    expect(req.prompt).not.toContain('Titelfolie');
    expect(req.prompt).toMatch(/German/);
  });

  it('nur für Angemeldete', async () => {
    const { raw, cardId } = await setup();
    expect((await raw.inject(ask(cardId, [{ role: 'user', content: 'Hallo?' }]))).statusCode).toBe(401);
  });

  it('prüft Länge, Anzahl und Reihenfolge der Nachrichten; unbekannte Karte → 404', async () => {
    const { app, calls, cardId } = await setup();
    expect((await app.inject(ask(cardId, [{ role: 'user', content: 'x'.repeat(2001) }]))).statusCode).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: 'a' }));
    expect((await app.inject(ask(cardId, many))).statusCode).toBe(400);
    expect((await app.inject(ask(cardId, [{ role: 'assistant', content: 'a' }]))).statusCode).toBe(400);
    expect((await app.inject(ask(cardId, []))).statusCode).toBe(400);
    expect((await app.inject(ask('nope', [{ role: 'user', content: 'a' }]))).statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('höchstens 2 Fragen gleichzeitig, die dritte bekommt 429', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, cardId } = await setup(async () => { await gate; return { ok: true, output: 'ok', usage: null }; });
    const one = app.inject(ask(cardId, [{ role: 'user', content: '1' }]));
    const two = app.inject(ask(cardId, [{ role: 'user', content: '2' }]));
    await new Promise((r) => setTimeout(r, 20));
    const three = await app.inject(ask(cardId, [{ role: 'user', content: '3' }]));
    expect(three.statusCode).toBe(429);
    expect(three.json().error).toMatch(/beschäftigt/);
    release();
    expect((await one).statusCode).toBe(200);
    expect((await two).statusCode).toBe(200);
    expect((await app.inject(ask(cardId, [{ role: 'user', content: '4' }]))).statusCode).toBe(200);
  });

  it('übersetzt Claude-Fehler in verständliche Meldungen', async () => {
    const cases: [ClaudeResult, number, RegExp][] = [
      [{ ok: false, kind: 'auth', message: 'Not logged in' }, 503, /Token/],
      [{ ok: false, kind: 'rate_limit', message: 'usage limit' }, 429, /Limit/],
      [{ ok: false, kind: 'failed', message: 'crash' }, 502, /fehlgeschlagen/],
      [{ ok: true, output: '   ', usage: null }, 502, /fehlgeschlagen/],
    ];
    for (const [result, status, msg] of cases) {
      const { app, cardId } = await setup(async () => result);
      const r = await app.inject(ask(cardId, [{ role: 'user', content: 'Frage' }]));
      expect(r.statusCode).toBe(status);
      expect(r.json().error).toMatch(msg);
    }
  });
});
