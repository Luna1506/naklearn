import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SERVER, TokenRejected, deviceLogin, httpTransport } from '../src/native/transport.ts';

describe('httpTransport', () => {
  it('sendet das Token', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}', { status: 401 }));
    const t = httpTransport('http://h:1', 'tok', f as unknown as typeof fetch);
    await expect(t({ deviceId: 'd', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } })).rejects.toBeInstanceOf(TokenRejected);
    expect(f.mock.calls[0]![0]).toBe('http://h:1/api/sync');
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('bricht hängende Anfragen nach dem Timeout ab', async () => {
    const t = httpTransport('http://h:1', 'tok', (() => new Promise(() => {})) as unknown as typeof fetch, 50);
    await expect(t({ deviceId: 'd', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } })).rejects.toThrow(/Zeitüberschreitung/);
  });
});

describe('deviceLogin', () => {
  it('schickt Name, Passwort und Gerätename und liefert das Token', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ token: 'tok', user: { id: 'u', name: 'Mia' } })));
    const r = await deviceLogin('https://h/', 'Mia', 'pw', 'Android-Handy', f as unknown as typeof fetch);
    expect(r).toEqual({ token: 'tok', user: { id: 'u', name: 'Mia' } });
    expect(f).toHaveBeenCalledWith('https://h/api/device/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Mia', password: 'pw', deviceName: 'Android-Handy' }) }));
  });
  it('meldet die Server-Fehlermeldung', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'Name oder Passwort falsch' }), { status: 401 }));
    await expect(deviceLogin(DEFAULT_SERVER, 'Mia', 'x', 'A', f as unknown as typeof fetch)).rejects.toThrow('Name oder Passwort falsch');
  });
});

describe('httpTransport 401', () => {
  it('wirft TokenRejected', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(httpTransport('https://h', 't', f as unknown as typeof fetch)({ deviceId: 'd', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } }))
      .rejects.toBeInstanceOf(TokenRejected);
  });
});
