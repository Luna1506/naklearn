import type { Deck, Module } from '@naklearn/core';
import type { LocalStore } from '@naklearn/store';
import { useEffect, useState } from 'react';
import { href, navigate } from '../router.ts';

export function NativeModule({ store, id }: { store: LocalStore; id: string }) {
  const [data, setData] = useState<{ module: Module; decks: (Deck & { noteCount: number })[] } | null>(null);
  const [examDate, setExamDate] = useState('');
  const [newPerDay, setNewPerDay] = useState(20);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void store.moduleDetail(id).then((d) => {
      setData(d);
      if (d) {
        setExamDate(d.module.examDate ?? '');
        setNewPerDay(d.module.newPerDay);
      }
    });
  }, [store, id]);
  if (!data) return <main className="page native"><a href={href('home')}>← Übersicht</a></main>;
  return (
    <main className="page native">
      <header className="topbar">
        <a href={href('home')}>←</a>
        <h1>{data.module.name}</h1>
      </header>
      <button className="primary big full" onClick={() => navigate('study', { moduleId: id, title: data.module.name })}>Modul lernen</button>
      <section>
        <h2>Foliensätze</h2>
        {data.decks.map((d) => (
          <button key={d.id} className="deck-row" disabled={d.noteCount === 0} onClick={() => navigate('study', { moduleId: id, deckId: d.id, title: d.title })}>
            <span>{d.title}</span>
            <span className="muted small">{d.noteCount} Karten</span>
          </button>
        ))}
      </section>
      <section className="card-form">
        <h2>Einstellungen</h2>
        <label>Prüfungsdatum <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} /></label>
        <label>Neue Karten pro Tag <input type="number" min={0} max={500} value={newPerDay} onChange={(e) => setNewPerDay(Number(e.target.value))} /></label>
        <button
          className="primary"
          onClick={async () => {
            await store.updateModule(id, { examDate: examDate || null, newPerDay });
            setMsg('Gespeichert – wird beim nächsten Sync übertragen.');
          }}
        >
          Speichern
        </button>
        {msg && <p className="info small">{msg}</p>}
      </section>
    </main>
  );
}
