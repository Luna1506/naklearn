import { describe, expect, it } from 'vitest';
import { clozeOrdinals, limitClozeGaps, renderCloze } from '../src/cloze.ts';

describe('clozeOrdinals', () => {
  it('liefert sortierte, eindeutige Lücken-Nummern', () => {
    expect(clozeOrdinals('A {{c2::y}} B {{c1::x}} C {{c1::z}}')).toEqual([1, 2]);
  });
  it('liefert [] ohne Lücken', () => {
    expect(clozeOrdinals('kein Lückentext')).toEqual([]);
  });
});

describe('renderCloze', () => {
  const text = 'A {{c1::x}} B {{c2::y}} C {{c1::z}}';
  it('verdeckt auf der Vorderseite alle Stellen der aktiven Lücke', () => {
    expect(renderCloze(text, 1, 'front')).toBe(
      'A <span class="cloze">[…]</span> B y C <span class="cloze">[…]</span>',
    );
  });
  it('hebt auf der Rückseite nur die aktive Lücke hervor', () => {
    expect(renderCloze(text, 2, 'back')).toBe('A x B <span class="cloze-answer">y</span> C z');
  });
  it('zeigt einen Hinweis statt …', () => {
    expect(renderCloze('{{c1::Norman::Person}} schrieb das Buch', 1, 'front')).toBe(
      '<span class="cloze">[Person]</span> schrieb das Buch',
    );
  });
});

describe('limitClozeGaps', () => {
  it('behält die zwei kleinsten Lücken-Nummern und macht den Rest zu Klartext', () => {
    expect(limitClozeGaps('{{c1::a}} {{c2::b::hint}} {{c3::c}} {{c1::d}}', 2)).toBe('{{c1::a}} {{c2::b::hint}} c {{c1::d}}');
    expect(clozeOrdinals(limitClozeGaps('{{c4::x}} {{c2::y}} {{c9::z}}', 2))).toEqual([2, 4]);
  });
  it('lässt Texte mit wenigen Lücken unverändert', () => {
    expect(limitClozeGaps('{{c1::a}} b', 2)).toBe('{{c1::a}} b');
  });
});
