import type { LocalStore, StoreOverview } from '@naklearn/store';
import { useEffect, useState } from 'react';
import { href, navigate } from '../router.ts';
import type { SyncController, SyncState } from './controller.ts';

export function syncLabel(s: SyncState, now = Date.now()): string {
  if (s.phase === 'syncing') return 'Synchronisiere …';
  if (s.phase === 'unpaired') return 'Nicht gekoppelt – Einstellungen öffnen';
  const ago = s.lastSync ? Math.round((now - s.lastSync) / 60_000) : null;
  const when = ago === null ? 'noch nie' : ago < 1 ? 'gerade eben' : ago < 60 ? `vor ${ago} min` : `vor ${Math.round(ago / 60)} h`;
  const base = `Zuletzt synchronisiert: ${when}`;
  if (s.phase === 'error') return `${base} · ${s.message}`;
  return s.imagesMissing ? `${base} · ${s.imagesMissing} Folienbilder fehlen noch` : base;
}

export function NativeHome({ store, sync, state }: { store: LocalStore; sync: SyncController; state: SyncState }) {
  const [ov, setOv] = useState<StoreOverview | null>(null);
  useEffect(() => {
    void store.overview().then(setOv);
  }, [store]);
  const due = ov?.modules.reduce((s, m) => s + m.dueToday, 0) ?? 0;
  return (
    <main className="page native">
      <header className="topbar">
        <h1>NAKLearn</h1>
        <a href={href('settings')} aria-label="Einstellungen">⚙</a>
      </header>
      <button className={`sync-status ${state.phase}`} onClick={() => (state.phase === 'unpaired' ? navigate('settings') : void sync.sync())}>
        {syncLabel(state)}
      </button>
      {ov && <p className="muted">Heute gelernt: {ov.studiedToday} · Serie: {ov.streak} {ov.streak === 1 ? 'Tag' : 'Tage'}</p>}
      <button className="primary big full" disabled={due === 0} onClick={() => navigate('study', { title: 'Heute' })}>
        Heute lernen · {due} Karten
      </button>
      <section className="grid">
        {ov?.modules.map((m) => (
          <a key={m.moduleId} className="tile" href={href('module', { id: m.moduleId })}>
            <div className="tile-head"><strong>{m.name}</strong><span className="muted small">{m.dueToday} fällig</span></div>
            <div className="counts">
              <span className="count-new">{m.new} neu</span>
              <span className="count-learning">{m.learning} lernend</span>
              <span className="count-review">{m.review} wdh.</span>
            </div>
            <div className="progress"><div style={{ width: `${m.seenPct}%` }} /></div>
            <div className="muted small">
              {m.seenPct}% gesehen{m.daysToExam !== null && <> · Prüfung in {m.daysToExam} {m.daysToExam === 1 ? 'Tag' : 'Tagen'}</>}
            </div>
            {m.warn && <div className="warn small">⚠ {m.newTarget} neue Karten/Tag nötig</div>}
          </a>
        ))}
      </section>
      {ov && ov.modules.length === 0 && <p className="muted">Noch keine Karten. Koppeln und synchronisieren, um loszulegen.</p>}
    </main>
  );
}
