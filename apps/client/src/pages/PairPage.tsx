import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { href } from '../router.ts';

export function PairPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.pair>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  useEffect(() => {
    api.pair().then(setData, (e) => setError(String(e.message)));
  }, []);
  return (
    <main className="page">
      <header className="topbar">
        <a href={href('home')}>← Übersicht</a>
        <h1>Handy koppeln</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {data && !data.url && (
        <p className="warn">
          Tailscale-Adresse nicht gefunden. Läuft Tailscale (<code>tailscale status</code>)? Alternativ
          <code> NAKLEARN_PUBLIC_URL</code> setzen.
        </p>
      )}
      {data?.qrSvg && <div className="qr" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />}
      {data && (
        <ol className="steps">
          <li>Tailscale-App auf dem Handy installieren und mit demselben Account anmelden.</li>
          <li>NAKLearn-App öffnen → Einstellungen → „QR-Code scannen“.</li>
          <li>
            Oder manuell eintragen: Adresse <code>{data.url ?? '–'}</code>, Token{' '}
            {showToken ? <code className="token">{data.token}</code> : <button onClick={() => setShowToken(true)}>anzeigen</button>}
          </li>
        </ol>
      )}
    </main>
  );
}
