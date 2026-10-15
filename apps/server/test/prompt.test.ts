import { describe, expect, it } from 'vitest';
import { buildCardsPrompt, buildGapsPrompt, buildSummaryPrompt, cardsJsonSchema, pickFigurePages, summaryJsonSchema } from '../src/prompt.ts';

const slides = [
  { page: 1, text: 'Cloud Security\nCSE4059' },
  { page: 2, text: 'Agenda\n- intro\n- models\n- threats\n- summary of the whole lecture with many words '.repeat(3) },
  { page: 3, text: '' },
  { page: 4, text: 'Shared responsibility model' },
];

describe('prompts', () => {
  it('wählt höchstens N textarme Folien als Abbildungen', () => {
    expect(pickFigurePages(slides, 2)).toEqual([3, 4]);
    expect(pickFigurePages(slides, 5)).toEqual([3, 4]); // Titelfolie zählt nie
  });
  it('Zusammenfassungs-Prompt enthält Folientext, Abbildungspfade und Auslass-Regeln', () => {
    const p = buildSummaryPrompt({ language: 'en', deckTitle: 'Week 1', slides, figures: [{ page: 3, imagePath: '/s/3.jpg' }] });
    expect(p).toContain('=== Slide 4 ===');
    expect(p).toContain('/s/3.jpg');
    expect(p).toMatch(/skip/i);
    expect(p).toContain('English');
  });
  it('Karten-Prompt enthält Zusammenfassung, Folientext, Obergrenze und Lücken-Regel, aber kein Zielverhältnis', () => {
    const p = buildCardsPrompt({ language: 'de', deckTitle: 'Week 1', summary: '## Shared responsibility', slides, maxCards: 17, figures: [] });
    expect(p).toContain('## Shared responsibility');
    expect(p).toContain('=== Slide 4 ===\nShared responsibility model');
    expect(p).toContain('at most 17 cards');
    expect(p).toContain('at most 2 gaps');
    expect(p).toContain('German');
    expect(p).not.toMatch(/aim for/);
  });
  it('Lücken-Prompt listet vorhandene Karten und Folien, erlaubt eine leere Antwort', () => {
    const p = buildGapsPrompt({
      language: 'en', deckTitle: 'Week 1', slides, maxCards: 5, figures: [{ page: 3, imagePath: '/s/3.jpg' }],
      existing: [{ front: 'What is the\nshared responsibility model?', back: 'Provider and customer split duties.', slides: [4] }],
    });
    expect(p).toContain('1. [p. 4] What is the shared responsibility model? → Provider and customer split duties.');
    expect(p).toContain('=== Slide 4 ===');
    expect(p).toContain('at most 5 new cards');
    expect(p).toContain('/s/3.jpg');
    expect(p).toMatch(/empty list/);
  });
  it('JSON-Schemas ohne $schema', () => {
    expect(JSON.stringify(summaryJsonSchema)).toContain('"summary"');
    expect(JSON.stringify(cardsJsonSchema)).toContain('"notes"');
    expect(summaryJsonSchema).not.toHaveProperty('$schema');
    expect(cardsJsonSchema).not.toHaveProperty('$schema');
  });
});
