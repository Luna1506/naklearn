import type { Grade } from '@naklearn/core';

const LABELS: Record<Grade, string> = { 1: 'Nochmal', 2: 'Schwer', 3: 'Gut', 4: 'Einfach' };

export function RatingBar({ intervals, onRate, disabled }: { intervals: Record<Grade, string>; onRate: (g: Grade) => void; disabled?: boolean }) {
  return (
    <div className="rating-bar">
      {([1, 2, 3, 4] as const).map((g) => (
        <button key={g} className={`rate rate-${g}`} disabled={disabled} onClick={() => onRate(g)}>
          <span className="rate-interval">{intervals[g]}</span>
          <span className="rate-label">{LABELS[g]}</span>
        </button>
      ))}
    </div>
  );
}
