import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeText, pageFromImageName, renderPdf } from '../src/pdf.ts';
import { makePdf } from './makePdf.ts';

async function tmp() {
  return mkdtemp(path.join(tmpdir(), 'kartei-pdf-'));
}

describe('renderPdf', () => {
  it('rendert jede Seite als JPEG und liest den Text', async () => {
    const dir = await tmp();
    const pdf = path.join(dir, 'a.pdf');
    await writeFile(pdf, makePdf(['Slide One', 'Slide Two', 'Slide Three']));
    const slides = await renderPdf(pdf, path.join(dir, 'out'));
    expect(slides.map((s) => s.page)).toEqual([1, 2, 3]);
    expect(slides[1]!.text).toContain('Slide Two');
    for (const s of slides) expect(existsSync(path.join(dir, 'out', s.image))).toBe(true);
    expect(slides[0]!.image).toBe('1.jpg');
  });

  it('normalisiert zweistellige Dateinamen (p-01.jpg)', async () => {
    const dir = await tmp();
    const pdf = path.join(dir, 'b.pdf');
    await writeFile(pdf, makePdf(Array.from({ length: 12 }, (_, i) => `Page ${i + 1}`)));
    const slides = await renderPdf(pdf, path.join(dir, 'out'));
    expect(slides).toHaveLength(12);
    expect(existsSync(path.join(dir, 'out', '12.jpg'))).toBe(true);
    expect(existsSync(path.join(dir, 'out', '1.jpg'))).toBe(true);
  });

  it('lehnt eine Nicht-PDF ab', async () => {
    const dir = await tmp();
    const bad = path.join(dir, 'x.pdf');
    await writeFile(bad, 'kein pdf');
    await expect(renderPdf(bad, path.join(dir, 'out'))).rejects.toThrow();
  });
});

describe('Hilfsfunktionen', () => {
  it('pageFromImageName', () => {
    expect(pageFromImageName('p-1.jpg')).toBe(1);
    expect(pageFromImageName('p-07.jpg')).toBe(7);
    expect(pageFromImageName('p-120.jpg')).toBe(120);
    expect(pageFromImageName('x.jpg')).toBeNull();
  });
  it('normalizeText entfernt Seitenumbrüche und Leerzeilen-Ketten', () => {
    expect(normalizeText('A   \n\n\n\nB    C\f')).toBe('A\n\nB  C');
  });
});
