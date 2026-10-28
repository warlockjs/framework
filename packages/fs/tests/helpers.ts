import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function withTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  // The canonical path: on Windows the temp folder is often an 8.3 short name (`RUNNER~1`) and on
  // macOS `/tmp` is a link, and the library reports canonical paths that tests compare against.
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "warlock-fs-")));
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
