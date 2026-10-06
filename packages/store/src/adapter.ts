export type Row = Record<string, any>;

/** Minimale asynchrone SQL-Schnittstelle (node:sqlite in Tests, Capacitor SQLite auf dem Handy). */
export interface SqlAdapter {
  execute(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
