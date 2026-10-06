import { describe, expect, it } from 'vitest';
import { toStudyCard } from '../src/render.ts';
import type { Card, Note } from '../src/types.ts';

const baseNote: Note = {
  id: 'n1', deckId: 'd1', kind: 'qa', front: 'Was ist HCI?', back: 'Human-Computer Interaction …',
  slideRefs: [3, 4], frontImagePage: null, tags: [], source: 'chunk', position: 0, deleted: false, updatedAt: 0,
};
const card: Card = { id: 'c1', noteId: 'n1', ordinal: 0, suspended: false, deleted: false, updatedAt: 0 };
const intervals = { 1: '<10m', 2: '1d', 3: '3d', 4: '8d' } as const;

describe('toStudyCard', () => {
  it('übernimmt Frage/Antwort unverändert', () => {
    const sc = toStudyCard({ note: baseNote, card, moduleName: 'UIUX', deckTitle: 'Ch1', intervals });
    expect(sc.front).toBe('Was ist HCI?');
    expect(sc.back).toBe('Human-Computer Interaction …');
    expect(sc.slides).toEqual([3, 4]);
    expect(sc.noteFront).toBe('Was ist HCI?');
  });
  it('rendert Lückentext mit Zusatzerklärung', () => {
    const note: Note = { ...baseNote, kind: 'cloze', front: '{{c1::Norman}} prägte {{c2::Affordances}}', back: 'Extra' };
    const sc = toStudyCard({ note, card: { ...card, ordinal: 2 }, moduleName: 'UIUX', deckTitle: 'Ch1', intervals });
    expect(sc.front).toBe('Norman prägte <span class="cloze">[…]</span>');
    expect(sc.back).toBe('Norman prägte <span class="cloze-answer">Affordances</span>\n\n---\n\nExtra');
  });
  it('lässt die Trennlinie ohne Zusatzerklärung weg', () => {
    const note: Note = { ...baseNote, kind: 'cloze', front: '{{c1::A}}', back: '' };
    const sc = toStudyCard({ note, card: { ...card, ordinal: 1 }, moduleName: 'm', deckTitle: 'd', intervals });
    expect(sc.back).toBe('<span class="cloze-answer">A</span>');
  });
});
