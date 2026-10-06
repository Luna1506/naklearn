import type { Grade, QueueCounts, Scope, StudyCard } from '@naklearn/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown.tsx';
import { NoteEditor } from './NoteEditor.tsx';
import { RatingBar } from './RatingBar.tsx';
import { SlideStrip } from './SlideStrip.tsx';
import type { StudyDataSource } from './source.ts';
import { Lightbox } from './Lightbox.tsx';

export function StudyView({
  source,
  scope,
  title,
  onExit,
}: {
  source: StudyDataSource;
  scope: Scope;
  title: string;
  onExit: () => void;
}) {
  const [card, setCard] = useState<StudyCard | null>(null);
  const [counts, setCounts] = useState<QueueCounts>({ learning: 0, review: 0, new: 0 });
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastRevlog, setLastRevlog] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [bigFront, setBigFront] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const { moduleId, deckId } = scope;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await source.next({ moduleId, deckId });
      setCard(r.card);
      setCounts(r.counts);
      setRevealed(false);
      shownAt.current = Date.now();
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [source, moduleId, deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        setError(String((e as Error).message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const rate = useCallback(
    (g: Grade) => {
      if (!card || !revealed) return;
      void run(async () => {
        const duration = Math.min(Date.now() - shownAt.current, 60_000);
        const { revlogId } = await source.answer(card.cardId, g, duration);
        setLastRevlog(revlogId);
        await load();
      });
    },
    [card, revealed, run, source, load],
  );

  const undoLast = useCallback(() => {
    if (!lastRevlog) return;
    void run(async () => {
      await source.undo(lastRevlog);
      setLastRevlog(null);
      await load();
    });
  }, [lastRevlog, run, source, load]);

  const suspend = useCallback(() => {
    if (!card) return;
    void run(async () => {
      await source.setSuspended(card.cardId, true);
      await load();
    });
  }, [card, run, source, load]);

  const remove = useCallback(() => {
    if (!card) return;
    const extra = card.kind === 'cloze' ? ' Alle Lücken dieses Lückentexts werden mitgelöscht.' : '';
    if (!window.confirm(`Diese Karte wirklich löschen?${extra}`)) return;
    void run(async () => {
      await source.deleteNote(card.noteId);
      await load();
    });
  }, [card, run, source, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || bigFront) return;
      // Browser-Kürzel (Strg+P …) und gedrückt gehaltene Tasten nie als Lernaktion werten.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!card) return;
        if (!revealed) setRevealed(true);
        else rate(3);
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        rate(Number(e.key) as Grade);
      } else if (e.key === 'z') {
        undoLast();
      } else if (e.key === 'e' && card) {
        setEditing(true);
      } else if (e.key === 'p') {
        suspend();
      } else if (e.key === 'Delete') {
        remove();
      } else if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, rate, undoLast, suspend, remove, editing, bigFront, onExit]);

  return (
    <div className="study">
      <header className="study-header">
        <button className="link" onClick={onExit}>← Zurück</button>
        <span className="study-title">{title}</span>
        <span className="counts" aria-label="Verbleibend">
          <span className="count-new">{counts.new}</span>
          <span className="count-learning">{counts.learning}</span>
          <span className="count-review">{counts.review}</span>
        </span>
      </header>

      {error && <p className="error">{error}</p>}

      {!loading && !card && (
        <div className="study-done">
          <h2>Geschafft! 🎉</h2>
          <p>Für heute ist hier nichts mehr fällig.</p>
          <div className="study-actions">
            {lastRevlog && <button onClick={undoLast}>Rückgängig</button>}
            <button className="primary" onClick={onExit}>Zurück zur Übersicht</button>
          </div>
        </div>
      )}

      {card && (
        <>
          <div className="study-meta">
            {card.moduleName} · {card.deckTitle}
          </div>
          <article className={`study-card kind-${card.kind}`}>
            {card.frontImagePage !== null && (
              <button className="front-image" onClick={() => setBigFront(true)}>
                <img src={source.slideUrl(card.deckId, card.frontImagePage)} alt={`Folie ${card.frontImagePage} (Vorderseite)`} />
              </button>
            )}
            <Markdown text={card.front} className="front" />
            {revealed && (
              <>
                <hr />
                <Markdown text={card.back} className="back" />
                <SlideStrip deckId={card.deckId} pages={card.slides} slideUrl={source.slideUrl} />
              </>
            )}
          </article>

          <footer className="study-footer">
            {!revealed ? (
              <button className="primary reveal" onClick={() => setRevealed(true)}>
                Antwort zeigen <kbd>Leertaste</kbd>
              </button>
            ) : (
              <RatingBar intervals={card.intervals} onRate={rate} disabled={busy} />
            )}
            <div className="study-tools">
              <button onClick={undoLast} disabled={!lastRevlog || busy}>Rückgängig <kbd>z</kbd></button>
              <button onClick={() => setEditing(true)}>Bearbeiten <kbd>e</kbd></button>
              <button onClick={suspend} disabled={busy}>Pausieren <kbd>p</kbd></button>
              <button className="danger" onClick={remove} disabled={busy}>Löschen <kbd>Entf</kbd></button>
            </div>
          </footer>

          {bigFront && card.frontImagePage !== null && (
            <Lightbox
              src={source.slideUrl(card.deckId, card.frontImagePage)}
              alt={`Folie ${card.frontImagePage} groß`}
              onClose={() => setBigFront(false)}
            />
          )}
          {editing && (
            <NoteEditor
              front={card.noteFront}
              back={card.noteBack}
              onCancel={() => setEditing(false)}
              onSave={async (front, back) => {
                await source.updateNote(card.noteId, { front, back });
                setEditing(false);
                await load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
