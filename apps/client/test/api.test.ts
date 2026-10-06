import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpDataSource, api } from '../src/api.ts';

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
