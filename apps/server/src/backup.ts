import { studyDay } from '@naklearn/core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db.ts';

const BACKUP_RE = /^naklearn-\d{4}-\d{2}-\d{2}\.db$/;

export function backupIfDue(db: Db, backupDir: string, now: number, keep = 7): string | null {
  mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `naklearn-${studyDay(now)}.db`);
  if (existsSync(file)) return null;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = readdirSync(backupDir).filter((f) => BACKUP_RE.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(path.join(backupDir, f));
  return file;
}
