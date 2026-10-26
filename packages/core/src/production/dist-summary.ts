import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type DistSummary = {
  /** Number of files under the output directory */
  files: number;
  /** Total size of those files, in bytes */
  bytes: number;
};

/** Count the files under `directory` and add up their sizes. */
export async function summarizeDist(directory: string): Promise<DistSummary> {
  let files = 0;
  let bytes = 0;

  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files++;
        bytes += (await stat(full)).size;
      }
    }
  };

  await walk(directory).catch(() => undefined);

  return { files, bytes };
}

/** `1234567` -> `1.18 MB` */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** The line the build prints last. */
export function formatDistSummary(summary: DistSummary): string {
  return `dist: ${summary.files} file${summary.files === 1 ? "" : "s"}, ${formatBytes(summary.bytes)}`;
}
