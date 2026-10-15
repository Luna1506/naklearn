// SideStore/AltStore-Quelle für die iOS-App (wird vom Workflow .github/workflows/ios.yml benutzt).
//   node scripts/ios-source.ts build-number 0.3.1
//       → CFBundleVersion für die Version (wie der Android-versionCode)
//   node scripts/ios-source.ts source --version 0.3.1 --size 123456 --base https://naklearn.torte-tech.de/ios [--date ISO] [--notes datei]
//       → source.json auf stdout
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { versionCode } from './release.ts';

export const BUNDLE_ID = 'de.luna.naklearn';
export const MIN_IOS = '15.0';

export interface SourceInput {
  version: string;
  size: number;
  /** öffentliche Basis-Adresse des ios-Verzeichnisses, z. B. https://naklearn.torte-tech.de/ios */
  base: string;
  date: string;
  notes?: string;
}

export function buildSource({ version, size, base, date, notes }: SourceInput) {
  const root = base.replace(/\/+$/, '');
  if (!/^https:\/\//.test(root)) throw new Error(`Basis-Adresse muss https sein: ${base}`);
  if (!Number.isInteger(size) || size <= 0) throw new Error(`Ungültige Größe: ${size}`);
  const iconURL = `${root}/icon.png`;
  return {
    name: 'NAKLearn',
    identifier: `${BUNDLE_ID}.source`,
    subtitle: 'Lernkarten aus Foliensätzen',
    iconURL,
    website: new URL(root).origin,
    tintColor: '#3478F6',
    apps: [
      {
        name: 'NAKLearn',
        bundleIdentifier: BUNDLE_ID,
        developerName: 'Luna',
        subtitle: 'Lernkarten aus Foliensätzen',
        localizedDescription: 'NAKLearn – Lernkarten aus Foliensätzen (NORDAKADEMIE), lernt offline und synchronisiert mit dem Server.',
        iconURL,
        tintColor: '#3478F6',
        category: 'education',
        screenshots: [],
        versions: [
          {
            version,
            buildVersion: String(versionCode(version)),
            date,
            localizedDescription: (notes ?? '').trim() || `NAKLearn ${version}`,
            // Versionsparameter, damit kein Cache eine alte ipa ausliefert (Datei heißt immer NAKLearn.ipa)
            downloadURL: `${root}/NAKLearn.ipa?v=${encodeURIComponent(version)}`,
            size,
            minOSVersion: MIN_IOS,
          },
        ],
        appPermissions: { entitlements: [], privacy: {} },
      },
    ],
    news: [],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'build-number') {
    console.log(versionCode(rest[0] ?? ''));
  } else if (cmd === 'source') {
    const { values } = parseArgs({
      args: rest,
      options: { version: { type: 'string' }, size: { type: 'string' }, base: { type: 'string' }, date: { type: 'string' }, notes: { type: 'string' } },
    });
    if (!values.version || !values.size || !values.base) throw new Error('--version, --size und --base angeben');
    const source = buildSource({
      version: values.version.replace(/^v/, ''),
      size: Number(values.size),
      base: values.base,
      date: values.date ?? new Date().toISOString(),
      notes: values.notes ? readFileSync(values.notes, 'utf8').slice(0, 4000) : undefined,
    });
    console.log(JSON.stringify(source, null, 2));
  } else {
    throw new Error('Aufruf: node scripts/ios-source.ts build-number <version> | source --version … --size … --base …');
  }
}
