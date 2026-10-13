import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrate-to-torte.sh');

/** Führt das Skript mit Attrappen für ssh/systemctl/tar aus; jeder Aufruf landet in calls.log. */
function run(opts: { unitActiveAfterStop: boolean }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'naklearn-migrate-'));
  const log = path.join(dir, 'calls.log');
  const stub = (name: string, body: string) => {
    writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(path.join(dir, name), 0o755);
  };
  // ssh: Prüfungen ok, "test -e naklearn.db" → keine DB vorhanden (Exit 1)
  stub('ssh', 'case "$*" in *"test -e /data/naklearn.db"*) exit 1;; esac; exit 0');
  stub('systemctl', `case "$*" in *is-active*) exit ${opts.unitActiveAfterStop ? 0 : 3};; esac; exit 0`);
  stub('tar', 'exit 0');
  const r = spawnSync('bash', [SCRIPT], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, NAKLEARN_DATA_DIR: dir },
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout + r.stderr, calls: readFileSync(log, 'utf8') };
}

test('Umzug: deaktiviert den Laptop-Dienst dauerhaft', () => {
  const r = run({ unitActiveAfterStop: true });
  assert.match(r.calls, /systemctl --user disable --now naklearn/);
});

test('Umzug bricht ab, wenn der Laptop-Dienst danach noch läuft – vor jeder Übertragung', () => {
  const r = run({ unitActiveAfterStop: true });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /läuft noch/);
  assert.doesNotMatch(r.calls, /^tar /m);
});
