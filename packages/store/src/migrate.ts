import { CORE_MIGRATIONS } from '@naklearn/core';
import type { SqlAdapter } from './adapter.ts';

export async function migrate(db: SqlAdapter): Promise<void> {
  const rows = await db.all<{ user_version: number }>('PRAGMA user_version');
  for (let v = rows[0]?.user_version ?? 0; v < CORE_MIGRATIONS.length; v++) {
    await db.transaction(async () => {
      await db.execute(CORE_MIGRATIONS[v]!);
      await db.execute(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
