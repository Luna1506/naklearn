import { useState } from 'react';
import { Lightbox } from './Lightbox.tsx';

export function SlideStrip({
  deckId,
  pages,
  slideUrl,
}: {
  deckId: string;
  pages: number[];
  slideUrl: (deckId: string, page: number) => string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (pages.length === 0) return null;
  return (
    <div className="slide-strip">
      {pages.map((p) => (
        <button key={p} className="slide-thumb" onClick={() => setOpen(p)}>
          <img src={slideUrl(deckId, p)} alt={`Folie ${p}`} loading="lazy" />
          <span>Folie {p}</span>
        </button>
      ))}
      {open !== null && <Lightbox src={slideUrl(deckId, open)} alt={`Folie ${open} groß`} onClose={() => setOpen(null)} />}
    </div>
  );
}
