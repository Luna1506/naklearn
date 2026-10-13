import { useCallback, useEffect, useState } from 'react';
import { api, type Person } from '../api.ts';
import { TopNav, useMe } from '../me.tsx';

export function PeoplePage() {
  const me = useMe();
  const [people, setPeople] = useState<Person[]>([]);
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    api.people().then(setPeople, (e) => setMsg(String(e.message)));
  }, []);
  useEffect(load, [load]);
  const show = (label: string, url: string) => {
    setLink({ label, url });
    void navigator.clipboard?.writeText(url).then(() => setMsg('Link kopiert.'), () => {});
  };
  return (
    <main className="page">
      <TopNav />
      <header className="topbar">
        <h1>Personen</h1>
        <button className="primary" onClick={async () => show('Einladungslink (7 Tage, einmal benutzbar)', (await api.invite()).url)}>Person einladen</button>
      </header>
      {msg && <p className="info">{msg}</p>}
      {link && <p className="card-form">{link.label}:<br /><code className="token">{link.url}</code></p>}
      <table className="table">
        <thead><tr><th>Name</th><th>Module</th><th>Handys</th><th>Zuletzt aktiv</th><th /></tr></thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <td>{p.name}{p.isAdmin ? ' (Admin)' : ''}</td>
              <td>{p.moduleCount}</td>
              <td>{p.deviceCount}</td>
              <td className="muted small">{p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString('de-DE') : 'noch nie'}</td>
              <td>
                <button onClick={async () => show(`Link zum Zurücksetzen für ${p.name}`, (await api.resetLink(p.id)).url)}>Link zum Zurücksetzen</button>{' '}
                {p.id !== me?.id && (
                  <button
                    className="danger"
                    onClick={async () => {
                      if (!confirm(`Konto „${p.name}“ löschen? Lernstand und Handys dieser Person gehen verloren.`)) return;
                      await api.deletePerson(p.id);
                      load();
                    }}
                  >
                    Konto löschen
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
