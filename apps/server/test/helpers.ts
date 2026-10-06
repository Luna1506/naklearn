import { CORE_MIGRATIONS } from '@kartei/core';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type Db } from '../src/db.ts';

export function memDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, CORE_MIGRATIONS);
  return db;
}
