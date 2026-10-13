import type { Language } from '@naklearn/core';
import { useCallback, useEffect, useState } from 'react';
import { api, type Overview } from '../api.ts';
import { href, navigate } from '../router.ts';

export function Home() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>('en');

  const load = useCallback(() => {
    api.overview().then(setOv, (e) => setError(String(e.message)));
  }, []);
  useEffect(load, [load]);

  const totalDue = ov?.modules.reduce((s, m) => s + m.dueToday, 0) ?? 0;

  return (
    <main className="page">
      <header className="topbar">
        <h1>NAKLearn</h1>
        {ov && <span className="muted">Heute gelernt: {ov.studiedToday} · Serie: {ov.streak} {ov.streak === 1 ? 'Tag' : 'Tage'}</span>}
      </header>
      {error && <p className="error">{error}</p>}

      <section className="hero">
        <button className="primary big" disabled={totalDue === 0} onClick={() => navigate('study', { title: 'Heute' })}>
          Heute lernen · {totalDue} Karten
        </button>
        <a href={href('browse')}>Alle Karten durchsuchen</a>
        <a href={href('pair')}>Handy koppeln</a>
        <button className="link" onClick={async () => { await api.logout(); location.reload(); }}>Abmelden</button>
      </section>

      <section className="grid">
        {ov?.modules.map((m) => (
          <a key={m.moduleId} className="tile" href={href('module', { id: m.moduleId })}>
            <div className="tile-head">
              <strong>{m.name}</strong>
              <span className="badge">{m.language.toUpperCase()}</span>
            </div>
            <div className="counts">
              <span className="count-new">{m.new} neu</span>
              <span className="count-learning">{m.learning} lernend</span>
              <span className="count-review">{m.review} wdh.</span>
            </div>
            <div className="progress"><div style={{ width: `${m.seenPct}%` }} /></div>
            <div className="muted small">
              {m.seenPct}% gesehen · heute {m.dueToday} fällig
              {m.daysToExam !== null && <> · Prüfung in {m.daysToExam} {m.daysToExam === 1 ? 'Tag' : 'Tagen'}</>}
            </div>
            {m.warn && <div className="warn small">⚠ {m.newTarget} neue Karten/Tag nötig, um bis 3 Tage vor der Prüfung alles zu sehen</div>}
          </a>
        ))}
      </section>

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
