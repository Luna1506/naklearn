import { describe, expect, it } from 'vitest';
import { atomicDownload } from '../src/native/atomicDownload.ts';

function fakeFs(failWrite = false) {
  const files = new Map<string, string>();
  return {
    files,
    ops: {
      download: async (path: string) => {
        files.set(path, 'teil');
        if (failWrite) throw new Error('abgebrochen');
        files.set(path, 'ganz');
      },
      rename: async (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
      remove: async (path: string) => void files.delete(path),
    },
  };
}

describe('atomicDownload', () => {
  it('schreibt erst in eine .part-Datei und benennt dann um', async () => {
    const fs = fakeFs();
    await atomicDownload('slides/d/1.jpg', fs.ops);
    expect([...fs.files.entries()]).toEqual([['slides/d/1.jpg', 'ganz']]);
  });
  it('hinterlässt bei Abbruch keine Zieldatei und räumt die .part-Datei auf', async () => {
    const fs = fakeFs(true);
    await expect(atomicDownload('slides/d/1.jpg', fs.ops)).rejects.toThrow('abgebrochen');
    expect(fs.files.size).toBe(0);
  });
});
