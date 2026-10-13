import type { Language, Module } from '@naklearn/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DeckWithCount } from '../api.ts';
import { TopNav } from '../me.tsx';
import { href, navigate } from '../router.ts';

const STATUS: Record<string, string> = {
  pending: 'wartet', rendering: 'Folien werden gelesen', generating: 'Karten werden erzeugt', ready: 'fertig', error: 'Fehler',
};

export function ModulePage({ id }: { id: string }) {
  const [mod, setMod] = useState<Module | null>(null);
  const [decks, setDecks] = useState<DeckWithCount[]>([]);
  const [form, setForm] = useState({ name: '', language: 'en' as Language, examDate: '', newPerDay: 20 });
  const [mine, setMine] = useState(true);
  const [members, setMembers] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.module(id);
      setMod(r.module);
      setDecks(r.decks);
      setMine(r.mine);
      setMembers(r.memberCount);
      setForm({ name: r.module.name, language: r.module.language, examDate: r.module.examDate ?? '', newPerDay: r.module.newPerDay });
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = decks.some((d) => d.status !== 'ready' && d.status !== 'error');
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setMsg(`Lade ${files.length} Datei(en) hoch …`);
    try {
      const r = await api.upload(id, files);
      const skipped = r.skipped.map((s) => `${s.file}: ${s.reason}`).join(', ');
      setMsg(`${r.created.length} Foliensatz/-sätze hinzugefügt.${skipped ? ` Übersprungen: ${skipped}` : ''}`);
      await load();
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  }

  if (!mod) return <main className="page">{msg ?? 'Lade …'}</main>;

  return (
    <main className="page">
      <TopNav />
      <header className="topbar">
        <a href={href('home')}>← Übersicht</a>
        <h1>{mod.name}</h1>
        <button className="primary" onClick={() => navigate('study', { moduleId: id, title: mod.name })}>Modul lernen</button>
      </header>
      {msg && <p className="info">{msg}</p>}

      <section
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload([...e.dataTransfer.files]);
        }}
        onClick={() => fileInput.current?.click()}
      >
        <p><strong>Foliensätze hierher ziehen</strong> oder klicken (PDF, mehrere möglich)</p>
        <input ref={fileInput} type="file" accept="application/pdf" multiple hidden onChange={(e) => void upload([...(e.target.files ?? [])])} />
      </section>

      <section>
        <h2>Foliensätze</h2>
        <table className="table">
          <thead><tr><th>Titel</th><th>Status</th><th>Folien</th><th>Karten</th><th /></tr></thead>
          <tbody>
            {decks.map((d) => (
              <tr key={d.id}>
                <td><a href={href('deck', { id: d.id })}>{d.title}</a></td>
                <td className={`status-${d.status}`}>{STATUS[d.status]}{d.error ? ` – ${d.error}` : ''}</td>
                <td>{d.pageCount || '–'}</td>
                <td>{d.noteCount}</td>
                <td><button onClick={() => navigate('study', { moduleId: id, deckId: d.id, title: d.title })} disabled={d.noteCount === 0}>Lernen</button></td>
              </tr>
            ))}
            {decks.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Foliensätze.</td></tr>}
          </tbody>
        </table>
        <p><a href={href('browse', { moduleId: id })}>Karten dieses Moduls durchsuchen</a></p>
      </section>

      <section className="card-form">
        <h2>Einstellungen</h2>
        {!mine && (
          <p className="warn">
            Dieses Modul ist nicht in deinen Modulen.{' '}
            <button className="primary" onClick={async () => { await api.joinModule(id); await load(); }}>Hinzufügen</button>
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.updateModule(id, mine ? { name: form.name, language: form.language, examDate: form.examDate || null, newPerDay: form.newPerDay } : { name: form.name, language: form.language });
              setMsg('Gespeichert.');
              await load();
            } catch (err) {
              setMsg(String((err as Error).message));
            }
          }}
        >
          <label>Name <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>Kartensprache
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Language })}>
              <option value="en">Englisch</option>
              <option value="de">Deutsch</option>
            </select>
          </label>
          {mine && <label>Prüfungsdatum <input type="date" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })} /></label>}
          {mine && <label>Neue Karten pro Tag (mindestens) <input type="number" min={0} max={500} value={form.newPerDay} onChange={(e) => setForm({ ...form, newPerDay: Number(e.target.value) })} /></label>}
          <button className="primary" type="submit">Speichern</button>
        </form>
        <p className="muted small">Die Sprache gilt für neu erzeugte Karten. Prüfungsdatum und neue Karten pro Tag gelten nur für dich; Name und Sprache für alle. Mit Prüfungsdatum verteilt NAKLearn die neuen Karten so, dass du 3 Tage vorher alles gesehen hast.</p>
        {mine && (
          <button
            onClick={async () => {
              await api.leaveModule(id);
              navigate('home');
            }}
          >
            Aus meinen Modulen entfernen
          </button>
        )}{' '}
        {mine && members <= 1 && (
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Modul „${mod.name}“ für alle löschen?`)) return;
              await api.deleteModule(id);
              navigate('home');
            }}
          >
            Für alle löschen
          </button>
        )}
        {members > 1 && <p className="muted small">{members} Personen lernen dieses Modul – löschen geht erst, wenn nur noch du es hast.</p>}
      </section>
    </main>
  );
}
