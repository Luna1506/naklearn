import { describe, expect, it, vi } from 'vitest';
import { httpTransport, parsePairing } from '../src/native/transport.ts';

describe('parsePairing', () => {
  it('liest den QR-Inhalt', () => {
    expect(parsePairing('{"v":1,"url":"http://nixos.tail1.ts.net:8742/","token":"abc"}')).toEqual({ url: 'http://nixos.tail1.ts.net:8742', token: 'abc' });
  });
  it.each(['kein json', '{"v":1,"url":"ftp://x","token":"a"}', '{"v":1,"url":"http://x"}'])('lehnt %s ab', (t) => {
    expect(parsePairing(t)).toBeNull();
  });
});

describe('httpTransport', () => {
  it('sendet das Token und meldet 401 verständlich', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}', { status: 401 }));
    const t = httpTransport('http://h:1', 'tok', f as unknown as typeof fetch);
    await expect(t({ deviceId: 'd', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } })).rejects.toThrow('Token ungültig');
    expect(f.mock.calls[0]![0]).toBe('http://h:1/api/sync');
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });
});
