import { useState } from 'react';
import { Markdown } from './Markdown.tsx';

export function NoteEditor({
  front,
  back,
  onSave,
  onCancel,
}: {
  front: string;
  back: string;
  onSave: (front: string, back: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState(front);
  const [b, setB] = useState(back);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-backdrop" role="dialog" aria-label="Karte bearbeiten">
      <div className="modal">
        <h3>Karte bearbeiten</h3>
        <label>
          Vorderseite (Lücken: <code>{'{{c1::Text}}'}</code>)
          <textarea value={f} onChange={(e) => setF(e.target.value)} rows={4} />
        </label>
        <label>
          Rückseite
          <textarea value={b} onChange={(e) => setB(e.target.value)} rows={8} />
        </label>
        <details>
          <summary>Vorschau</summary>
          <Markdown text={f} />
          <hr />
          <Markdown text={b} />
        </details>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onCancel} disabled={busy}>Abbrechen</button>
          <button
            className="primary"
            disabled={busy || !f.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(f, b);
              } catch (e) {
                setError(String((e as Error).message ?? e));
                setBusy(false);
              }
            }}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
