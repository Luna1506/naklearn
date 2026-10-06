import { describe, expect, it } from 'vitest';
import { SyncRequestSchema, emptyPush } from '../src/sync.ts';

const req = {
  deviceId: 'phone',
  cursor: 0,
  push: {
    ...emptyPush(),
    revlog: [{ id: 'r1', cardId: 'c1', rating: 3, reviewedAt: 1, durationMs: 5, deviceId: 'phone', revokes: null }],
    modules: [{ id: 'm', name: 'M', language: 'en', examDate: '2026-10-30', newPerDay: 20, deleted: false, updatedAt: 2 }],
  },
};

describe('SyncRequestSchema', () => {
  it('akzeptiert eine gültige Anfrage', () => {
    expect(SyncRequestSchema.parse(req)).toEqual(req);
  });
  it('lehnt ungültige Bewertungen ab', () => {
    const bad = structuredClone(req);
    (bad.push.revlog[0] as { rating: number }).rating = 7;
    expect(SyncRequestSchema.safeParse(bad).success).toBe(false);
  });
  it('verlangt eine Geräte-ID und einen nicht-negativen Cursor', () => {
    expect(SyncRequestSchema.safeParse({ ...req, deviceId: '' }).success).toBe(false);
    expect(SyncRequestSchema.safeParse({ ...req, cursor: -1 }).success).toBe(false);
  });
});
