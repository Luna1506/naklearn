import { describe, expect, it } from 'vitest';
import { buildChunkPrompt, buildSynthesisPrompt, chunkJsonSchema, outlineOf, synthesisJsonSchema } from '../src/prompt.ts';

const slides = [
  { page: 3, text: 'Norman\'s Gulfs\nExecution and evaluation', imagePath: '/data/slides/d/3.jpg' },
  { page: 4, text: 'Affordances', imagePath: '/data/slides/d/4.jpg' },
];

describe('prompts', () => {
  it('Gliederung nutzt die erste nichtleere Zeile', () => {
    expect(outlineOf([{ page: 1, text: '\n  Intro  \nmore' }, { page: 2, text: '' }])).toBe('p. 1: Intro\np. 2: (leer)');
  });
  it('Chunk-Prompt enthält Folien, Bildpfade und Sprachregel', () => {
    const p = buildChunkPrompt({ language: 'en', deckTitle: 'Ch3', outline: 'p. 1: Intro', slides });
    expect(p).toContain('=== Slide 3 ===');
    expect(p).toContain('/data/slides/d/4.jpg');
    expect(p).toContain('Write every card in English');
    expect(p).toContain('p. 1: Intro');
  });
  it('deutsche Module verlangen deutsche Karten mit englischen Fachbegriffen', () => {
    const p = buildChunkPrompt({ language: 'de', deckTitle: 'X', outline: '', slides });
    expect(p).toContain('German');
  });
  it('Synthese-Prompt listet bestehende Karten mit IDs', () => {
    const p = buildSynthesisPrompt({ language: 'en', deckTitle: 'Ch3', slides, existing: [{ id: 'n-1', front: 'What is a gulf?' }] });
    expect(p).toContain('[n-1] What is a gulf?');
    expect(p).toContain('removeNoteIds');
  });
  it('JSON-Schemas beschreiben notes', () => {
    expect(JSON.stringify(chunkJsonSchema)).toContain('"notes"');
    expect(JSON.stringify(synthesisJsonSchema)).toContain('"removeNoteIds"');
  });
  it('JSON-Schemas enthalten kein $schema (claude lehnt draft 2020-12 ab)', () => {
    expect(chunkJsonSchema).not.toHaveProperty('$schema');
    expect(synthesisJsonSchema).not.toHaveProperty('$schema');
  });
});
