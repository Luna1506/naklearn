import { useEffect, useState } from 'react';
import { api } from '../api.ts';

export function InvitePage({ token }: { token: string }) {
  const [info, setInfo] = useState<{ kind: 'invite' | 'reset'; name: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.inviteInfo(token).then(setInfo, () => setError('Dieser Link ist ungültig, abgelaufen oder wurde schon benutzt.'));
  }, [token]);
  if (error && !info) return <main className="page login"><h1>NAKLearn</h1><p className="error">{error}</p></main>;
  if (!info) return <main className="page login">Lade …</main>;
  const invite = info.kind === 'invite';
  return (
    <main className="page login">
      <h1>NAKLearn</h1>
      <p>{invite ? 'Du wurdest eingeladen. Wähle deinen Namen und ein Passwort.' : `Neues Passwort für ${info.name}.`}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) return setError('Die Passwörter stimmen nicht überein.');
          setBusy(true);
          setError(null);
          try {
            await api.acceptInvite(token, invite ? { name, password: pw } : { password: pw });
            location.hash = invite ? '#/alle' : '#/';
            location.reload();
          } catch (err) {
            setError(String((err as Error).message));
            setBusy(false);
          }
        }}
      >
        {invite && <label>Name <input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>}
        <label>Passwort (mind. 8 Zeichen) <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Passwort wiederholen <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <button className="primary" disabled={busy || (invite && !name) || pw.length < 8}>{invite ? 'Konto anlegen' : 'Passwort speichern'}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
