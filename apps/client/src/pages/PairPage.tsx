import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { href } from '../router.ts';

export function PairPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.pair>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const load = useCallback(() => {
    api.pair().then(setData, (e) => setError(String(e.message)));
  }, []);
  useEffect(load, [load]);
  return (
    <main className="page">
      <header className="topbar">
        <a href={href('home')}>← Übersicht</a>
        <h1>Handy koppeln</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {data && !data.url && (
        <p className="warn">
          <code>NAKLEARN_PUBLIC_URL</code> ist auf dem Server nicht gesetzt – ohne Adresse kein QR-Code.
        </p>
      )}
      {data?.qrSvg && <div className="qr" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />}
      {data && (
        <ol className="steps">
          <li>NAKLearn-App installieren (GitHub Releases, z. B. über Obtainium).</li>
          <li>App öffnen → Einstellungen → „QR-Code scannen“.</li>
          <li>
            Oder manuell eintragen: Adresse <code>{data.url ?? '–'}</code>, Token{' '}
            {showToken ? <code className="token">{data.token}</code> : <button onClick={() => setShowToken(true)}>anzeigen</button>}
          </li>
        </ol>
      )}
      {data && (
        <p>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm('Neues Token erzeugen? Bereits gekoppelte Handys müssen danach neu gekoppelt werden.')) return;
              try {
                await api.rotateToken();
                setShowToken(false);
                load();
              } catch (e) {
                setError(String((e as Error).message));
              }
            }}
          >
            Token neu erzeugen
          </button>
        </p>
      )}
    </main>
  );
}
