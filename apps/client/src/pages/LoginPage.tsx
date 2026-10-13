import { useState } from 'react';
import { api } from '../api.ts';

export function LoginPage() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="page login">
      <h1>NAKLearn</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.login(name, password);
            location.reload();
          } catch (err) {
            setError(String((err as Error).message));
            setBusy(false);
          }
        }}
      >
        <label>
          Name
          <input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Passwort
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !name || !password}>Anmelden</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
