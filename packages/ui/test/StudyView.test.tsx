import { act, fireEvent, render, screen } from '@testing-library/react';
import type { StudyCard } from '@naklearn/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudyDataSource } from '../src/source.ts';
import { StudyView } from '../src/StudyView.tsx';

function card(id: string): StudyCard {
  return {
    cardId: id, noteId: `n${id}`, deckId: 'd', kind: 'qa', front: `Frage ${id}`, back: `Antwort ${id}`,
    frontImagePage: null, slides: [2], moduleName: 'UIUX', deckTitle: 'Ch1',
    intervals: { 1: '1m', 2: '6m', 3: '10m', 4: '3d' }, noteFront: `Frage ${id}`, noteBack: `Antwort ${id}`,
    frontDe: null, backDe: null,
  };
}

function deCard(id: string): StudyCard {
  return { ...card(id), frontDe: `Deutsche Frage ${id}`, backDe: `Deutsche Antwort ${id}` };
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
    deleteNote: vi.fn(async () => {
      queue.shift();
    }),
    slideUrl: (deckId, page) => `/slides/${deckId}/${page}.jpg`,
    ask: vi.fn(async (_cardId, messages) => `Antwort auf: ${messages.at(-1)!.content}`),
  };
}

beforeEach(() => window.localStorage.clear());

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

  it('löscht die Karte nach Rückfrage und zeigt die nächste', async () => {
    const src = fakeSource([card('1'), card('2')]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Löschen/ })); });
    expect(src.deleteNote).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(window, { key: 'Delete' }); });
    expect(src.deleteNote).toHaveBeenCalledWith('n1');
    expect(await screen.findByText('Frage 2')).toBeTruthy();
    confirm.mockRestore();
  });

  it('funktioniert mit Datenquellen, deren slideUrl `this` nutzt (Klassenmethoden)', async () => {
    class ClassSource {
      private base = '/img';
      private inner = fakeSource([card('1')]);
      next = this.inner.next; answer = this.inner.answer; undo = this.inner.undo;
      setSuspended = this.inner.setSuspended; updateNote = this.inner.updateNote; deleteNote = this.inner.deleteNote; ask = this.inner.ask;
      slideUrl(deckId: string, page: number) { return `${this.base}/${deckId}/${page}.jpg`; }
    }
    render(<StudyView source={new ClassSource()} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    fireEvent.click(screen.getByRole('button', { name: /Antwort zeigen/ }));
    expect(screen.getByRole('img', { name: 'Folie 2' }).getAttribute('src')).toBe('/img/d/2.jpg');
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

  it('schaltet auf Deutsch um (Knopf und Taste t) und merkt sich die Wahl', async () => {
    const src = fakeSource([deCard('1'), deCard('2')]);
    const { unmount } = render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    fireEvent.click(screen.getByRole('button', { name: /Deutsch/ }));
    expect(screen.getByText('Deutsche Frage 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Antwort zeigen/ }));
    expect(screen.getByText('Deutsche Antwort 1')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(window, { key: 't' }); });
    expect(screen.getByText('Frage 1')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(window, { key: 't' }); });
    unmount();
    render(<StudyView source={fakeSource([deCard('1')])} scope={{}} title="Heute" onExit={() => {}} />);
    expect(await screen.findByText('Deutsche Frage 1')).toBeTruthy();
  });

  it('ohne Übersetzung bleibt das Original und der Knopf ist gesperrt', async () => {
    window.localStorage.setItem('naklearn.lang', 'de');
    render(<StudyView source={fakeSource([card('1')])} scope={{}} title="Heute" onExit={() => {}} />);
    expect(await screen.findByText('Frage 1')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /Deutsch|Englisch/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/Übersetzung folgt/);
  });

  it('Frage stellen: schickt den Verlauf, zeigt die Antwort, neue Karte = neuer Chat', async () => {
    const src = fakeSource([card('1'), card('2')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    await act(async () => { fireEvent.keyDown(window, { key: 'f' }); });
    const box = screen.getByRole('textbox', { name: /Frage an Claude/ });
    fireEvent.change(box, { target: { value: 'Warum?' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Senden/ })); });
    expect(await screen.findByText('Antwort auf: Warum?')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: /Frage an Claude/ }), { target: { value: 'Und dann?' } });
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: /Frage an Claude/ }), { key: 'Enter' }); });
    expect(await screen.findByText('Antwort auf: Und dann?')).toBeTruthy();
    expect(src.ask).toHaveBeenLastCalledWith('1', [
      { role: 'user', content: 'Warum?' },
      { role: 'assistant', content: 'Antwort auf: Warum?' },
      { role: 'user', content: 'Und dann?' },
    ]);
    // Tippen im Chat löst keine Lernaktionen aus
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: /Frage an Claude/ }), { key: '3' }); });
    expect(src.answered).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /Antwort zeigen/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Gut/ })); });
    await screen.findByText('Frage 2');
    expect(screen.queryByText('Antwort auf: Warum?')).toBeNull();
  });

  it('zeigt Fehler beim Fragen im Chat', async () => {
    const src = fakeSource([card('1')]);
    (src.ask as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Claude-Limit erreicht'));
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    fireEvent.click(screen.getByRole('button', { name: /Frage stellen/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /Frage an Claude/ }), { target: { value: 'Hallo' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Senden/ })); });
    expect(await screen.findByText(/Claude-Limit erreicht/)).toBeTruthy();
  });

  it('blendet die Antwort per Knopf und Taste a wieder aus', async () => {
    const src = fakeSource([card('1')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    expect(screen.queryByRole('button', { name: /Antwort ausblenden/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Antwort zeigen/ }));
    expect(screen.getByText('Antwort 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Antwort ausblenden/ }));
    expect(screen.queryByText('Antwort 1')).toBeNull();
    expect(screen.queryByRole('button', { name: /Gut/ })).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: '3' });
    });
    expect(src.answered).toEqual([]);

    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.getByText('Antwort 1')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.queryByText('Antwort 1')).toBeNull();
    expect(screen.getByRole('button', { name: /Antwort zeigen/ })).toBeTruthy();
  });
});

