import { newId } from '@naklearn/core';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  dataDir: string;
  port: number;
  host: string;
  token: string;
  deviceId: string;
  claudePath: string;
  claudeModel: string | null;
  webDir: string | null;
}

function defaultWebDir(): string | null {
  const dir = fileURLToPath(new URL('../../client/dist', import.meta.url));
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.NAKLEARN_DATA_DIR ?? path.join(os.homedir(), '.local/share/naklearn'));
  for (const d of ['', 'pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });

  const file = path.join(dataDir, 'config.json');
  const stored: { token?: string; deviceId?: string } = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let changed = false;
  if (!stored.token) { stored.token = randomBytes(32).toString('base64url'); changed = true; }
  if (!stored.deviceId) { stored.deviceId = newId(); changed = true; }
  if (changed) writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });

  return {
    dataDir,
    port: Number(env.NAKLEARN_PORT ?? 8742),
    host: env.NAKLEARN_HOST ?? '0.0.0.0',
    token: stored.token,
    deviceId: stored.deviceId,
    claudePath: env.NAKLEARN_CLAUDE ?? path.join(os.homedir(), '.local/bin/claude'),
    claudeModel: env.NAKLEARN_MODEL || null,
    webDir: env.NAKLEARN_WEB_DIR ?? defaultWebDir(),
  };
}
