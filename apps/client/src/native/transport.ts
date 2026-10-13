import type { Transport } from '@naklearn/store';

export const DEFAULT_SERVER = 'https://naklearn.torte-tech.de';

/** Der Server kennt das Gerätetoken nicht (mehr) – neu anmelden. */
export class TokenRejected extends Error {
  constructor() {
    super('Abgemeldet – bitte in den Einstellungen neu anmelden');
  }
}

export async function deviceLogin(
  url: string, name: string, password: string, deviceName: string, fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; user: { id: string; name: string } }> {
  const res = await fetchImpl(`${url.replace(/\/+$/, '')}/api/device/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password, deviceName }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Anmeldung fehlgeschlagen (HTTP ${res.status})`);
  return body;
}

export function httpTransport(url: string, token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 60_000): Transport {
  return async (req) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Zeitüberschreitung – Server nicht erreichbar')), timeoutMs);
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
      if (res.status === 401) throw new TokenRejected();
      if (!res.ok) throw new Error(`Sync fehlgeschlagen (HTTP ${res.status})`);
      return await Promise.race([res.json(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
