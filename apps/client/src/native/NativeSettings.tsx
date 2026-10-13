import type { LocalStore } from '@naklearn/store';
import { useEffect, useState } from 'react';
import { href } from '../router.ts';
import { syncLabel } from './NativeHome.tsx';
import type { SyncController, SyncState } from './controller.ts';
import { DEFAULT_SERVER } from './transport.ts';

export function NativeSettings({ store, sync, state }: { store: LocalStore; sync: SyncController; state: SyncState }) {
  const [account, setAccount] = useState<{ name: string | null } | null>(null);
  const [url, setUrl] = useState(DEFAULT_SERVER);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => void sync.account().then((a) => {
    setAccount(a);
    if (a) setUrl(a.url);
  });
  useEffect(refresh, [sync, state.phase]);

  return (
    <main className="page native">
      <header className="topbar">
        <a href={href('home')}>←</a>
        <h1>Einstellungen</h1>
      </header>
      <p className={`sync-status ${state.phase}`}>{syncLabel(state)}</p>
      {account ? (
        <section className="card-form">
          <h2>Angemeldet als {account.name ?? '–'}</h2>
          <button className="full" onClick={() => void sync.sync()} disabled={state.phase === 'syncing'}>Jetzt synchronisieren</button>
          <button
            className="full danger"
            onClick={async () => {
              setBusy(true);
              let r = await sync.logout();
              if (r.unsynced > 0 && confirm(`${r.unsynced} Änderungen sind noch nicht synchronisiert und gehen verloren. Trotzdem abmelden?`)) {
                r = await sync.logout(true);
              }
              setBusy(false);
              setMsg(r.unsynced > 0 ? 'Nicht abgemeldet.' : 'Abgemeldet, lokale Daten gelöscht.');
              refresh();
            }}
            disabled={busy}
          >
            Abmelden
          </button>
        </section>
      ) : (
        <section className="card-form">
          <h2>Anmelden</h2>
          <p className="muted small">Mit deinem NAKLearn-Namen und Passwort (Einladung von Luna).</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMsg(null);
              try {
                await sync.login(url, name, password);
                setPassword('');
                refresh();
              } catch (err) {
                setMsg(String((err as Error).message ?? err));
              }
              setBusy(false);
            }}
          >
            <label>Name <input autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Passwort <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {advanced
              ? <label>Server-Adresse <input value={url} onChange={(e) => setUrl(e.target.value)} /></label>
              : <button type="button" className="link" onClick={() => setAdvanced(true)}>Erweitert</button>}
            <button className="primary full" disabled={busy || !name || !password || !/^https?:\/\//.test(url)}>Anmelden</button>
          </form>
        </section>
      )}
      {msg && <p className="info small">{msg}</p>}
      <p className="muted small">Geräte-ID: {store.deviceId}</p>
    </main>
  );
}
