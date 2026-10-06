import { describe, expect, it } from 'vitest';
import { parseRoute, href } from '../src/router.ts';

describe('parseRoute', () => {
  it.each([
    ['', { name: 'home', params: {} }],
    ['#/', { name: 'home', params: {} }],
    ['#/module/abc', { name: 'module', params: { id: 'abc' } }],
    ['#/deck/d1', { name: 'deck', params: { id: 'd1' } }],
    ['#/browse?moduleId=m1&q=gulf', { name: 'browse', params: { moduleId: 'm1', q: 'gulf' } }],
    ['#/study?deckId=d1&title=Ch%201', { name: 'study', params: { deckId: 'd1', title: 'Ch 1' } }],
    ['#/pair', { name: 'pair', params: {} }],
    ['#/settings', { name: 'settings', params: {} }],
    ['#/unbekannt', { name: 'home', params: {} }],
  ])('%s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
  it('href baut Hash-URLs', () => {
    expect(href('study', { moduleId: 'm1', title: 'UI/UX' })).toBe('#/study?moduleId=m1&title=UI%2FUX');
    expect(href('module', { id: 'x' })).toBe('#/module/x');
  });
});
