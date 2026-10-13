import { useCallback, useEffect, useState } from 'react';
import { api, type DeviceInfo } from '../api.ts';
import { TopNav, useMe } from '../me.tsx';

const when = (t: number | null) => (t ? new Date(t).toLocaleString('de-DE') : 'noch nie');

export function AccountPage() {
  const me = useMe();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  const load = useCallback(() => {
    api.devices().then(setDevices, (e) => setMsg(String(e.message)));
  }, []);
  useEffect(load, [load]);
  return (
    <main className="page">
      <TopNav />
      <header className="topbar"><h1>Konto {me ? `· ${me.name}` : ''}</h1></header>
      {msg && <p className="info">{msg}</p>}
      <section className="card-form">
        <h2>Passwort ändern</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.changePassword(old, pw);
              setOld('');
              setPw('');
              setMsg('Passwort geändert. Andere Browser sind jetzt abgemeldet.');
            } catch (err) {
              setMsg(String((err as Error).message));
            }
          }}
        >
          <label>Altes Passwort <input type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} /></label>
          <label>Neues Passwort (mind. 8 Zeichen) <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <button className="primary" disabled={!old || pw.length < 8}>Speichern</button>
        </form>
      </section>
      <section>
        <h2>Meine Handys</h2>
        <table className="table">
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td className="muted small">zuletzt synchronisiert: {when(d.lastSeenAt)}</td>
                <td>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (!confirm(`„${d.name}“ entfernen? Die App dort muss sich neu anmelden.`)) return;
                      await api.removeDevice(d.id);
                      load();
                    }}
                  >
                    Entfernen
                  </button>
                </td>
              </tr>
            ))}
            {devices.length === 0 && <tr><td className="muted">Noch kein Handy angemeldet.</td></tr>}
          </tbody>
        </table>
        <p className="muted small">
          Android: App „NAKLearn“ aus den GitHub-Releases (z. B. über Obtainium) installieren und dort mit Name und Passwort anmelden –
          dann geht Lernen auch offline. iPhone: einfach diese Website im Browser nutzen.
        </p>
      </section>
    </main>
  );
}
