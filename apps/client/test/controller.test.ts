import type { SyncRequest, SyncResponse } from '@naklearn/core';
import { LocalStore, type SqlAdapter } from '@naklearn/store';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SyncController, type ImageStore } from '../src/native/controller.ts';

function nodeAdapter(): SqlAdapter {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    async execute(sql) { db.exec(sql); },
    async run(sql, p = []) { db.prepare(sql).run(...(p as SQLInputValue[])); },
    async all(sql, p = []) { return db.prepare(sql).all(...(p as SQLInputValue[])) as never; },
    async transaction(fn) {
      if (depth) return fn();
      depth++; db.exec('BEGIN');
      try { const r = await fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth--; }
    },
  };
}

function pullWithSlides(n: number): SyncResponse {
  return {
    cursor: 5, hasMore: false,
    pull: {
      modules: [{ id: 'm', name: 'M', language: 'en', examDate: null, newPerDay: 20, deleted: false, updatedAt: 1 }],
      decks: [{ id: 'd', moduleId: 'm', title: 'D', pdfSha256: 's', pageCount: n, status: 'ready', error: null, summary: null, position: 1, deleted: false, updatedAt: 1 }],
      slides: Array.from({ length: n }, (_, i) => ({ deckId: 'd', page: i + 1, image: `${i + 1}.jpg` })),
      notes: [], cards: [], revlog: [],
    },
  };
}

function fakeImages(failPages: number[] = []): ImageStore & { stored: Set<string> } {
  const stored = new Set<string>();
  return {
    stored,
    async has(d, p) { return stored.has(`${d}/${p}`); },
    async download(_u, _t, d, p) {
      if (failPages.includes(p)) throw new Error('abgebrochen');
      stored.add(`${d}/${p}`);
    },
    src: (d, p) => `file://${d}/${p}.jpg`,
  };
}

describe('SyncController', () => {
  it('ist ohne Kopplung im Zustand unpaired und wirft nicht', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const c = new SyncController(store, fakeImages());
    await c.sync();
    expect(c.state.phase).toBe('unpaired');
  });

  it('meldet Netzfehler als Status statt Absturz', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const c = new SyncController(store, fakeImages(), () => async () => { throw new Error('Server nicht erreichbar'); });
    await c.pair('http://h:1', 't');
    expect(c.state).toMatchObject({ phase: 'error', message: 'Server nicht erreichbar' });
  });

  it('lädt nach dem Sync nur fehlende Bilder und holt abgebrochene beim nächsten Mal nach', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const images = fakeImages([2]);
    let call = 0;
    const transport = async (_r: SyncRequest): Promise<SyncResponse> => (call++ === 0 ? pullWithSlides(3) : { ...pullWithSlides(0), pull: { ...pullWithSlides(0).pull, modules: [], decks: [] } });
    const c = new SyncController(store, images, () => transport);
    await c.pair('http://h:1', 't');
    // nach dem ersten Fehler wird nicht weiter geladen (Server vermutlich weg) – Rest kommt beim nächsten Sync
    expect(images.stored.size).toBe(1);
    expect(c.state).toMatchObject({ phase: 'idle', imagesMissing: 2 });
    expect(c.state.lastSync).not.toBeNull();
    const retry = new SyncController(store, fakeImages(), () => transport);
    (retry as unknown as { images: ImageStore }).images = { ...images, download: async (_u, _t, d, p) => void images.stored.add(`${d}/${p}`) };
    await retry.sync();
    expect(images.stored.size).toBe(3);
    expect(retry.state.imagesMissing).toBe(0);
  });

  it('merkt sich die Kopplung', async () => {
    const store = await LocalStore.open(nodeAdapter());
    const c = new SyncController(store, fakeImages(), () => async () => pullWithSlides(0));
    await c.pair('http://h:1/', 'tok');
    expect(await c.pairing()).toEqual({ url: 'http://h:1', token: 'tok' });
  });
});
