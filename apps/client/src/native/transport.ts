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

export function httpTransport(url: string, token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 60_000): Transport {
  return async (req) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Zeitüberschreitung – Laptop nicht erreichbar')), timeoutMs);
    });
    try {
      const res = await Promise.race([
        fetchImpl(`${url}/api/sync`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(req),
        }),
        timeout,
      ]);
      if (res.status === 401) throw new Error('Token ungültig – bitte neu koppeln');
      if (!res.ok) throw new Error(`Sync fehlgeschlagen (HTTP ${res.status})`);
      return await Promise.race([res.json(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
