import { act, fireEvent, render, screen } from '@testing-library/react';
import type { StudyCard } from '@kartei/core';
import { describe, expect, it, vi } from 'vitest';
import type { StudyDataSource } from '../src/source.ts';
import { StudyView } from '../src/StudyView.tsx';

function card(id: string): StudyCard {
  return {
    cardId: id, noteId: `n${id}`, deckId: 'd', kind: 'qa', front: `Frage ${id}`, back: `Antwort ${id}`,
    frontImagePage: null, slides: [2], moduleName: 'UIUX', deckTitle: 'Ch1',
    intervals: { 1: '1m', 2: '6m', 3: '10m', 4: '3d' }, noteFront: `Frage ${id}`, noteBack: `Antwort ${id}`,
  };
}

function fakeSource(cards: StudyCard[]): StudyDataSource & { answered: unknown[] } {
  const queue = [...cards];
  const answered: unknown[] = [];
  return {
    answered,
    next: vi.fn(async () => ({ card: queue[0] ?? null, counts: { learning: 0, review: 0, new: queue.length } })),
    answer: vi.fn(async (cardId, rating) => {
      answered.push([cardId, rating]);
      queue.shift();
      return { revlogId: `r-${cardId}` };
    }),
    undo: vi.fn(async () => {}),
    setSuspended: vi.fn(async () => {}),
    updateNote: vi.fn(async () => {}),
    slideUrl: (deckId, page) => `/slides/${deckId}/${page}.jpg`,
  };
}

describe('StudyView', () => {
  it('zeigt Vorderseite, deckt per Knopf auf und bewertet per Taste', async () => {
    const src = fakeSource([card('1'), card('2')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    expect(await screen.findByText('Frage 1')).toBeTruthy();
    expect(screen.queryByText('Antwort 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Antwort zeigen/ }));
    expect(screen.getByText('Antwort 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /10m.*Gut/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Folie 2' })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { key: '3' });
    });
    expect(src.answered).toEqual([['1', 3]]);
    expect(await screen.findByText('Frage 2')).toBeTruthy();
  });

  it('Leertaste: erst aufdecken, dann „Gut“', async () => {
    const src = fakeSource([card('1')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    await act(async () => { fireEvent.keyDown(window, { key: ' ' }); });
    expect(screen.getByText('Antwort 1')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(window, { key: ' ' }); });
    expect(src.answered).toEqual([['1', 3]]);
  });

  it('ignoriert Bewertungstasten vor dem Aufdecken', async () => {
    const src = fakeSource([card('1')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    await act(async () => { fireEvent.keyDown(window, { key: '1' }); });
    expect(src.answered).toEqual([]);
  });

  it('ignoriert Tastenkürzel mit Strg/Alt/Meta (z. B. Strg+P zum Drucken)', async () => {
    const src = fakeSource([card('1')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    fireEvent.click(screen.getByRole('button', { name: /Antwort zeigen/ }));
    await act(async () => { fireEvent.keyDown(window, { key: 'p', ctrlKey: true }); });
    await act(async () => { fireEvent.keyDown(window, { key: '3', altKey: true }); });
    expect(src.setSuspended).not.toHaveBeenCalled();
    expect(src.answered).toEqual([]);
  });

  it('ignoriert automatisch wiederholte Tasten (gedrückt gehaltene Leertaste)', async () => {
    const src = fakeSource([card('1'), card('2')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    await act(async () => { fireEvent.keyDown(window, { key: ' ' }); });
    await act(async () => { fireEvent.keyDown(window, { key: ' ', repeat: true }); });
    expect(src.answered).toEqual([]);
  });

  it('zeigt den Fertig-Zustand und erlaubt Rückgängig', async () => {
    const src = fakeSource([card('1')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    fireEvent.click(screen.getByRole('button', { name: /Antwort zeigen/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Einfach/ })); });
    expect(await screen.findByText(/Geschafft/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Rückgängig/ })); });
    expect(src.undo).toHaveBeenCalledWith('r-1');
  });
});
