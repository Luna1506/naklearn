import { newId } from '@naklearn/core';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function defaultWebDir(): string | null {
  const dir = fileURLToPath(new URL('../../client/dist', import.meta.url));
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

export interface Config {
  dataDir: string;
  port: number;
  host: string;
  token: string;
  deviceId: string;
  /** Login-Passwort fürs Studio (Pflicht). */
  password: string;
  /** Schlüssel für die Sitzungs-Cookies, bleibt über Neustarts gleich. */
  sessionSecret: string;
  /** Adresse, unter der die App den Server erreicht (für den QR-Code). */
  publicUrl: string | null;
  claudePath: string;
  /** Modell für Zusammenfassungen (günstig), Standard "sonnet". */
  summaryModel: string | null;
  /** Modell für die Kartenerzeugung (Qualität), Standard "opus". */
  cardsModel: string | null;
  webDir: string | null;
}

interface Stored { token?: string; deviceId?: string; sessionSecret?: string }

const configFile = (dataDir: string) => path.join(dataDir, 'config.json');
const secret = () => randomBytes(32).toString('base64url');

function writeStored(dataDir: string, stored: Stored) {
  writeFileSync(configFile(dataDir), JSON.stringify(stored, null, 2), { mode: 0o600 });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const password = env.NAKLEARN_PASSWORD ?? '';
  if (!password) throw new Error('NAKLEARN_PASSWORD ist nicht gesetzt – ohne Passwort startet der Server nicht.');

  const dataDir = path.resolve(env.NAKLEARN_DATA_DIR ?? path.join(os.homedir(), '.local/share/naklearn'));
  for (const d of ['', 'pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });

  const file = configFile(dataDir);
  const stored: Stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let changed = false;
  if (!stored.token) { stored.token = secret(); changed = true; }
  if (!stored.deviceId) { stored.deviceId = newId(); changed = true; }
  if (!stored.sessionSecret) { stored.sessionSecret = secret(); changed = true; }
  if (changed) writeStored(dataDir, stored);

  return {
    dataDir,
    port: Number(env.NAKLEARN_PORT ?? 8742),
    host: env.NAKLEARN_HOST ?? '0.0.0.0',
    token: stored.token,
    deviceId: stored.deviceId,
    password,
    sessionSecret: stored.sessionSecret,
    publicUrl: env.NAKLEARN_PUBLIC_URL ? env.NAKLEARN_PUBLIC_URL.replace(/\/+$/, '') : null,
    claudePath: env.NAKLEARN_CLAUDE ?? path.join(os.homedir(), '.local/bin/claude'),
    summaryModel: env.NAKLEARN_SUMMARY_MODEL || 'sonnet',
    cardsModel: env.NAKLEARN_CARDS_MODEL || 'opus',
    webDir: env.NAKLEARN_WEB_DIR ?? defaultWebDir(),
  };
}

/** Neues App-Token; bereits gekoppelte Geräte müssen neu koppeln. */
export function rotateToken(cfg: Config): string {
  const file = configFile(cfg.dataDir);
  const stored: Stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  stored.token = secret();
  writeStored(cfg.dataDir, stored);
  cfg.token = stored.token;
  return stored.token;
}
