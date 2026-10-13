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
    await expect(api.login('Luna', 'x')).rejects.toThrow('Falsches Passwort');
    expect(seen).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Luna', password: 'x' }) }));
    off();
  });
});

describe('Konten-API', () => {
  it('Login schickt Name und Passwort; Einladungs-401 löst keine Login-Seite aus', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/invites') ? { error: 'x' } : { id: '1', name: 'Luna', isAdmin: true }), { status: url.startsWith('/api/invites') ? 401 : 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const seen = vi.fn();
    const off = onUnauthorized(seen);
    await api.login('Luna', 'pw');
    expect(fetchMock).toHaveBeenCalledWith('/api/login', expect.objectContaining({ body: JSON.stringify({ name: 'Luna', password: 'pw' }) }));
    await expect(api.inviteInfo('tok')).rejects.toThrow();
    expect(seen).not.toHaveBeenCalled();
    off();
  });
  it('Modulauswahl und Personen', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    await api.joinModule('m1');
    await api.leaveModule('m1');
    await api.resetLink('u2');
    await api.deletePerson('u2');
    expect(fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${u}`)).toEqual([
      'POST /api/modules/m1/join', 'POST /api/modules/m1/leave', 'POST /api/users/u2/reset', 'DELETE /api/users/u2',
    ]);
  });
});
