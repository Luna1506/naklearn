import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpDataSource, Unauthorized, api, onUnauthorized } from '../src/api.ts';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('sendet JSON und wirft bei Fehlern die Servermeldung', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'kaputt' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.createModule({ name: 'x', language: 'en' })).rejects.toThrow('kaputt');
    expect(fetchMock).toHaveBeenCalledWith('/api/modules', expect.objectContaining({ method: 'POST' }));
  });
  it('HttpDataSource baut Query und Bild-URLs', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ card: null, counts: { learning: 0, review: 0, new: 0 } })));
    vi.stubGlobal('fetch', fetchMock);
    const src = new HttpDataSource();
    await src.next({ moduleId: 'm1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/study/next?moduleId=m1');
    expect(src.slideUrl('d1', 3)).toBe('/api/slides/d1/3.jpg');
  });
});

describe('Anmeldung', () => {
  it('401 meldet sich bei den Abonnenten und wirft Unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })));
    const seen = vi.fn();
    const off = onUnauthorized(seen);
    await expect(api.overview()).rejects.toBeInstanceOf(Unauthorized);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    await expect(api.overview()).rejects.toBeInstanceOf(Unauthorized);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it('falsches Passwort beim Login löst keine Login-Seite aus, sondern zeigt die Meldung', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Falsches Passwort' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const seen = vi.fn();
    const off = onUnauthorized(seen);
    await expect(api.login('x')).rejects.toThrow('Falsches Passwort');
    expect(seen).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'x' }) }));
    off();
  });
});
