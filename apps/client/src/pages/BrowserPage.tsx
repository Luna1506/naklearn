import type { NoteKind } from '@naklearn/core';
import { Markdown, NoteEditor } from '@naklearn/ui';
import { useCallback, useEffect, useState } from 'react';
import { api, type NoteListItem } from '../api.ts';
import { href } from '../router.ts';

export function BrowserPage({ params }: { params: Record<string, string> }) {
  const [q, setQ] = useState(params.q ?? '');
  const [kind, setKind] = useState<NoteKind | ''>('');
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [editing, setEditing] = useState<NoteListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes(await api.notes({ moduleId: params.moduleId, deckId: params.deckId, q: q || undefined, kind: kind || undefined }));
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [params.moduleId, params.deckId, q, kind]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const back = params.deckId ? href('deck', { id: params.deckId }) : params.moduleId ? href('module', { id: params.moduleId }) : href('home');

  return (
    <main className="page">
      <header className="topbar">
        <a href={back}>← Zurück</a>
        <h1>Karten-Browser</h1>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <input placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind | '')}>
          <option value="">Alle Typen</option>
          <option value="qa">Frage/Antwort</option>
          <option value="cloze">Lückentext</option>
          <option value="diagram">Diagramm</option>
        </select>
        <span className="muted">{notes.length} Karten</span>
      </div>
      <table className="table notes-table">
        <tbody>
          {notes.map((n) => {
            const suspended = n.cards.length > 0 && n.cards.every((c) => c.suspended);
            return (
              <tr key={n.id} className={suspended ? 'suspended' : ''}>
                <td><span className={`badge kind-${n.kind}`}>{n.kind}</span></td>
                <td>
                  <Markdown text={n.front} />
                  <details><summary className="muted small">Antwort</summary><Markdown text={n.back} /></details>
                </td>
                <td className="small muted">{n.deckTitle} · Folie {n.slideRefs.join(', ')}</td>
                <td className="actions">
                  <button onClick={() => setEditing(n)}>Bearbeiten</button>
                  <button onClick={async () => {
                    for (const c of n.cards) await api.suspend(c.id, !suspended);
                    await load();
                  }}>{suspended ? 'Fortsetzen' : 'Pausieren'}</button>
                  <button className="danger" onClick={async () => {
                    if (!confirm('Karte löschen?')) return;
                    await api.deleteNote(n.id);
                    await load();
                  }}>Löschen</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing && (
        <NoteEditor
          front={editing.front}
          back={editing.back}
          onCancel={() => setEditing(null)}
          onSave={async (front, back) => {
            await api.updateNote(editing.id, { front, back });
            setEditing(null);
            await load();
          }}
        />
      )}
    </main>
  );
}
