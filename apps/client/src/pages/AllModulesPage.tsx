import type { Language } from '@naklearn/core';
import { useCallback, useEffect, useState } from 'react';
import { api, type ModuleListItem } from '../api.ts';
import { TopNav } from '../me.tsx';
import { href, navigate } from '../router.ts';

export function AllModulesPage() {
  const [mods, setMods] = useState<ModuleListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const load = useCallback(() => {
    api.allModules().then(setMods, (e) => setError(String(e.message)));
  }, []);
  useEffect(load, [load]);
  const toggle = async (m: ModuleListItem) => {
    try {
      await (m.mine ? api.leaveModule(m.id) : api.joinModule(m.id));
      load();
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  return (
    <main className="page">
      <TopNav />
      <header className="topbar"><h1>Alle Module</h1></header>
      <p className="muted">Wähle die Module, die du lernst. Nur sie erscheinen in deiner Übersicht und auf deinem Handy.</p>
      {error && <p className="error">{error}</p>}
      <table className="table">
        <tbody>
          {mods?.map((m) => (
            <tr key={m.id}>
              <td><a href={href('module', { id: m.id })}>{m.name}</a> <span className="badge">{m.language.toUpperCase()}</span></td>
              <td className="muted small">{m.memberCount === 1 ? '1 lernt das' : `${m.memberCount} lernen das`}</td>
              <td><button className={m.mine ? '' : 'primary'} onClick={() => void toggle(m)}>{m.mine ? 'Entfernen' : 'Hinzufügen'}</button></td>
            </tr>
          ))}
          {mods?.length === 0 && <tr><td className="muted">Noch keine Module – leg das erste an.</td></tr>}
        </tbody>
      </table>
      <section className="card-form">
        <h2>Neues Modul</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const m = await api.createModule({ name, language });
              navigate('module', { id: m.id });
            } catch (err) {
              setError(String((err as Error).message));
            }
          }}
        >
          <input placeholder="Name, z. B. UI/UX Design" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="en">Karten auf Englisch</option>
            <option value="de">Karten auf Deutsch</option>
          </select>
          <button className="primary" type="submit">Anlegen</button>
        </form>
      </section>
    </main>
  );
}
