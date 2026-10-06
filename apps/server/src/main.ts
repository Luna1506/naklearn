import path from 'node:path';
import { buildApp } from './app.ts';
import { backupIfDue } from './backup.ts';
import { createClaudeRunner } from './claude.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createWorker, resetRunningJobs } from './generation.ts';

const cfg = loadConfig();
const db = openDb(path.join(cfg.dataDir, 'naklearn.db'));
resetRunningJobs(db);

const worker = createWorker({
  db,
  dataDir: cfg.dataDir,
  runClaude: createClaudeRunner({ claudePath: cfg.claudePath }),
  summaryModel: cfg.summaryModel,
  cardsModel: cfg.cardsModel,
});
worker.start();

const backup = () => {
  try {
    const f = backupIfDue(db, path.join(cfg.dataDir, 'backups'), Date.now());
    if (f) console.log(`[naklearn] Sicherung: ${f}`);
  } catch (e) {
    console.error('[naklearn] Sicherung fehlgeschlagen', e);
  }
};
backup();
setInterval(backup, 3_600_000).unref();

const app = buildApp({ db, cfg, worker });
await app.listen({ port: cfg.port, host: cfg.host });
console.log(`[naklearn] läuft auf http://localhost:${cfg.port} (Daten: ${cfg.dataDir}, Web: ${cfg.webDir ?? 'kein Build'})`);

const shutdown = async () => {
  await worker.stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
