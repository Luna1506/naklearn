import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupIfDue } from '../src/backup.ts';
import { openDb } from '../src/db.ts';

describe('backupIfDue', () => {
  it('sichert einmal pro Tag und behält die letzten 7', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kartei-bak-'));
    const db = openDb(path.join(dir, 'k.db'));
    const backups = path.join(dir, 'backups');
    const now = new Date('2026-10-06T10:00:00+09:00').getTime();
    const file = backupIfDue(db, backups, now)!;
    expect(existsSync(file)).toBe(true);
    expect(backupIfDue(db, backups, now)).toBeNull();
    for (let d = 1; d <= 8; d++) backupIfDue(db, backups, now + d * 86_400_000);
    expect(readdirSync(backups)).toHaveLength(7);
    expect(readdirSync(backups).sort().at(-1)).toBe('kartei-2026-10-14.db');
  });
});
