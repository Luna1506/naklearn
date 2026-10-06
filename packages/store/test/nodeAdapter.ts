import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlAdapter } from '../src/adapter.ts';

export function nodeAdapter(db: DatabaseSync = new DatabaseSync(':memory:')): SqlAdapter {
  let depth = 0;
  return {
    async execute(sql) { db.exec(sql); },
    async run(sql, params = []) { db.prepare(sql).run(...(params as SQLInputValue[])); },
    async all(sql, params = []) { return db.prepare(sql).all(...(params as SQLInputValue[])) as never; },
    async transaction(fn) {
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN');
      try {
        const r = await fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
