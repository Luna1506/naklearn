export interface DownloadOps {
  download(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** Lädt nach `${target}.part` und benennt erst nach Erfolg um – abgebrochene Downloads hinterlassen keine Zieldatei. */
export async function atomicDownload(target: string, ops: DownloadOps): Promise<void> {
  const part = `${target}.part`;
  try {
    await ops.download(part);
  } catch (e) {
    await ops.remove(part).catch(() => {});
    throw e;
  }
  await ops.rename(part, target);
}
