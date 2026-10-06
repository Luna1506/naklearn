import { Capacitor } from '@capacitor/core';
import { FileTransfer } from '@capacitor/file-transfer';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { ImageStore } from './controller.ts';

const rel = (deckId: string, page: number) => `slides/${deckId}/${page}.jpg`;

export async function createImageStore(): Promise<ImageStore> {
  const base = (await Filesystem.getUri({ path: '', directory: Directory.Data })).uri.replace(/\/+$/, '');
  return {
    async has(deckId, page) {
      try {
        await Filesystem.stat({ path: rel(deckId, page), directory: Directory.Data });
        return true;
      } catch {
        return false;
      }
    },
    async download(url, token, deckId, page, image) {
      await Filesystem.mkdir({ path: `slides/${deckId}`, directory: Directory.Data, recursive: true }).catch(() => {});
      await FileTransfer.downloadFile({
        url: `${url}/api/slides/${deckId}/${image}`,
        path: `${base}/${rel(deckId, page)}`,
        headers: { authorization: `Bearer ${token}` },
      });
    },
    src: (deckId, page) => Capacitor.convertFileSrc(`${base}/${rel(deckId, page)}`),
  };
}
