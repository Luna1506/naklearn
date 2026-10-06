import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { SqlAdapter } from '@naklearn/store';

export async function openCapAdapter(name = 'naklearn'): Promise<SqlAdapter> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const exists = (await sqlite.isConnection(name, false)).result;
  const conn = exists
    ? await sqlite.retrieveConnection(name, false)
    : await sqlite.createConnection(name, false, 'no-encryption', 1, false);
  await conn.open();
  let depth = 0;
  return {
    async execute(sql) { await conn.execute(sql, false); },
    async run(sql, params = []) { await conn.run(sql, params as unknown[], false); },
    async all(sql, params = []) { return ((await conn.query(sql, params as unknown[])).values ?? []) as never; },
    async transaction(fn) {
      if (depth > 0) return fn();
      depth++;
      await conn.beginTransaction();
      try {
        const r = await fn();
        await conn.commitTransaction();
        return r;
      } catch (e) {
        await conn.rollbackTransaction();
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
