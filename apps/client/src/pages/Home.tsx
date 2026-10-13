import { useCallback, useEffect, useState } from 'react';
import { api, type Overview } from '../api.ts';
import { TopNav } from '../me.tsx';
import { href, navigate } from '../router.ts';

export function Home() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.overview().then((o) => {
      if (o.modules.length === 0) navigate('all');
      else setOv(o);
    }, (e) => setError(String(e.message)));
  }, []);
  useEffect(load, [load]);

  const totalDue = ov?.modules.reduce((s, m) => s + m.dueToday, 0) ?? 0;

  return (
    <main className="page">
      <TopNav />
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
    </main>
  );
}
