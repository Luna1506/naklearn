import type { Transport } from '@naklearn/store';

export function parsePairing(text: string): { url: string; token: string } | null {
  try {
    const j = JSON.parse(text);
    if (typeof j?.url !== 'string' || typeof j?.token !== 'string' || !/^https?:\/\//.test(j.url) || !j.token) return null;
    return { url: j.url.replace(/\/+$/, ''), token: j.token };
  } catch {
    return null;
  }
}

export function httpTransport(url: string, token: string, fetchImpl: typeof fetch = fetch): Transport {
  return async (req) => {
    const res = await fetchImpl(`${url}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(req),
    });
    if (res.status === 401) throw new Error('Token ungültig – bitte neu koppeln');
    if (!res.ok) throw new Error(`Sync fehlgeschlagen (HTTP ${res.status})`);
    return res.json();
  };
}
