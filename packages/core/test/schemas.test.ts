import { describe, expect, it } from 'vitest';
import { CardsOutputSchema, SummaryOutputSchema } from '../src/schemas.ts';

describe('Claude-Ausgabeschemas', () => {
  it('Zusammenfassung ist ein Markdown-String', () => {
    expect(SummaryOutputSchema.parse({ summary: '# Kapitel' })).toEqual({ summary: '# Kapitel' });
    expect(SummaryOutputSchema.safeParse({ summary: '' }).success).toBe(false);
  });
  it('Karten haben Typ, Seiten und Wichtigkeits-Reihenfolge implizit über die Liste', () => {
    const ok = { notes: [{ kind: 'qa', front: 'F', back: 'B', slides: [3], frontImagePage: null, tags: [] }] };
    expect(CardsOutputSchema.parse(ok)).toEqual(ok);
  });
});
