import type { Deck } from '@kartei/core';
import { Markdown, SlideStrip } from '@kartei/ui';
import { useCallback, useEffect, useState } from 'react';
import { api, type Job, type NoteListItem, type WorkerStatus } from '../api.ts';
import { href, navigate } from '../router.ts';

const KIND: Record<Job['kind'], string> = { render: 'Folien lesen', chunk: 'Karten erzeugen', synthesis: 'Zusammenfassen & Duplikate' };
const JOB_STATUS: Record<Job['status'], string> = { queued: 'wartet', running: 'läuft …', done: 'fertig', failed: 'fehlgeschlagen' };
const slideUrl = (deckId: string, page: number) => `/api/slides/${deckId}/${page}.jpg`;

export function DeckPage({ id }: { id: string }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [moduleName, setModuleName] = useState('');
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, w, n] = await Promise.all([api.deck(id), api.worker(), api.notes({ deckId: id })]);
      setDeck(d.deck);
      setJobs(d.jobs);
      setModuleName(d.moduleName);
      setWorker(w);
      setNotes(n);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [active, load]);

  if (!deck) return <main className="page">{error ?? 'Lade …'}</main>;
  const done = jobs.filter((j) => j.kind === 'chunk' && j.status === 'done').length;
  const total = jobs.filter((j) => j.kind === 'chunk').length;

  return (
    <main className="page">
      <header className="topbar">
        <a href={href('module', { id: deck.moduleId })}>← {moduleName}</a>
        <h1>{deck.title}</h1>
        <button className="primary" disabled={notes.length === 0} onClick={() => navigate('study', { moduleId: deck.moduleId, deckId: deck.id, title: deck.title })}>Lernen</button>
      </header>
      {error && <p className="error">{error}</p>}

      {worker?.state === 'paused' && (
        <p className="warn">
          Erzeugung pausiert: {worker.pauseReason}{' '}
          <button onClick={async () => { await api.resumeWorker(); await load(); }}>Fortsetzen</button>
        </p>
      )}

      <section>
        <h2>Erzeugung {total > 0 && <span className="muted small">({done}/{total} Abschnitte)</span>}</h2>
        <table className="table">
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{KIND[j.kind]}{j.chunkFrom !== null && ` · Folien ${j.chunkFrom}–${j.chunkTo}`}</td>
                <td className={`job-${j.status}`}>{JOB_STATUS[j.status]}{j.attempts > 1 ? ` (Versuch ${j.attempts})` : ''}</td>
                <td className="small muted">{j.status !== 'done' && j.error}</td>
                <td>{j.status === 'failed' && <button onClick={async () => { await api.retryJob(j.id); await load(); }}>Erneut versuchen</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button
            disabled={active}
            onClick={async () => {
              if (!confirm('Karten neu erzeugen? Bereits bewertete Karten bleiben erhalten.')) return;
              await api.regenerate(id);
              await load();
            }}
          >
            Neu erzeugen
          </button>
          <button
            onClick={async () => {
              const t = prompt('Neuer Titel', deck.title);
              if (t && t.trim()) { await api.renameDeck(id, t.trim()); await load(); }
            }}
          >
            Umbenennen
          </button>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Foliensatz „${deck.title}“ löschen?`)) return;
              await api.deleteDeck(id);
              navigate('module', { id: deck.moduleId });
            }}
          >
            Löschen
          </button>
        </div>
      </section>

      <section>
        <h2>Karten ({notes.length})</h2>
        <p><a href={href('browse', { deckId: id })}>Im Karten-Browser bearbeiten</a></p>
        <div className="note-list">
          {notes.map((n) => (
            <details key={n.id} className="note">
              <summary>
                <span className={`badge kind-${n.kind}`}>{n.kind}</span> <Markdown text={n.front} className="inline" />
              </summary>
              <Markdown text={n.back} />
              <SlideStrip deckId={n.deckId} pages={n.frontImagePage ? [n.frontImagePage] : n.slideRefs} slideUrl={slideUrl} />
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
