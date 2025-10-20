import { opendir } from "fs/promises";
import { join } from "path";

const MAX_CONCURRENCY = 32;

export async function globFiles(
  root: string,
  { extensions }: { extensions?: string[] } = {}, // optional extensions like ['.ts', '.tsx']
): Promise<string[]> {
  const results: string[] = [];
  const queue: string[] = [root];
  let active = 0;

  const normalizedExts = extensions?.map(e =>
    e.startsWith(".") ? e : `.${e}`,
  );

  return new Promise(resolve => {
    const processNext = async () => {
      if (queue.length === 0 && active === 0) {
        resolve(results);
        return;
      }
      if (active >= MAX_CONCURRENCY || queue.length === 0) return;

      const dir = queue.shift();
      if (!dir) return;

      active++;
      try {
        const dirHandle = await opendir(dir);
        for await (const dirent of dirHandle) {
          const fullPath = join(dir, dirent.name);
          if (dirent.isDirectory()) {
            queue.push(fullPath);
          } else if (dirent.isFile()) {
            if (
              !normalizedExts ||
              normalizedExts.some(ext => fullPath.endsWith(ext))
            ) {
              results.push(fullPath);
            }
          }
        }
      } catch (err: any) {
        if (err.code !== "EACCES" && err.code !== "ENOENT") {
          console.error(`Error reading ${dir}:`, err);
        }
      } finally {
        active--;
        processNext(); // continue the queue
      }

      // Keep concurrency flowing
      while (active < MAX_CONCURRENCY && queue.length > 0) {
        processNext();
      }
    };

    // Kick off initial batch
    while (active < MAX_CONCURRENCY && queue.length > 0) {
      processNext();
    }
  });
}
