import { useEffect, useState } from 'react';

export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label={alt} onClick={onClose}>
      <img
        src={src}
        alt={alt}
        className={zoom ? 'zoomed' : ''}
        onClick={(e) => {
          e.stopPropagation();
          setZoom((z) => !z);
        }}
      />
      <button className="lightbox-close" onClick={onClose} aria-label="Schließen">×</button>
    </div>
  );
}
