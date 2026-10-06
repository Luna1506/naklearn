import { execFile } from 'node:child_process';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface RenderedSlide {
  page: number;
  text: string;
  image: string;
}

export function normalizeText(s: string): string {
  return s
    .replace(/\f/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, '  ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** pdftoppm benennt je nach Seitenzahl p-1.jpg, p-01.jpg oder p-001.jpg. */
export function pageFromImageName(file: string): number | null {
  const m = /^p-0*(\d+)\.jpg$/.exec(file);
  return m ? Number(m[1]) : null;
}

export async function renderPdf(pdfPath: string, outDir: string): Promise<RenderedSlide[]> {
  const info = await run('pdfinfo', [pdfPath]);
  const m = /^Pages:\s+(\d+)/m.exec(info.stdout);
  if (!m) throw new Error('pdfinfo: Seitenzahl nicht gefunden');
  const pages = Number(m[1]);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await run('pdftoppm', ['-jpeg', '-jpegopt', 'quality=80', '-scale-to', '1280', pdfPath, path.join(outDir, 'p')], {
    maxBuffer: 1 << 26,
  });
  for (const f of await readdir(outDir)) {
    const page = pageFromImageName(f);
    if (page !== null) await rename(path.join(outDir, f), path.join(outDir, `${page}.jpg`));
  }

  const slides: RenderedSlide[] = [];
  for (let p = 1; p <= pages; p++) {
    const t = await run('pdftotext', ['-layout', '-f', String(p), '-l', String(p), pdfPath, '-'], { maxBuffer: 1 << 24 });
    slides.push({ page: p, text: normalizeText(t.stdout), image: `${p}.jpg` });
  }
  return slides;
}
