/**
 * The filesystem generation commands write through.
 *
 * Same signatures as the `@warlock.js/fs` functions they wrap, so a feature
 * hook or generator only changes its import. Outside a generation run they
 * pass straight through. Inside one (see `generation-run.ts`) every write is
 * recorded for the `--json` report, and in a `--dry-run` nothing reaches the
 * disk: writes land in an in-memory overlay that later reads in the same run
 * see, so a hook that writes a file and then edits it previews correctly.
 */
import * as fs from "@warlock.js/fs";
import {
  currentGenerationRun,
  hasPendingContentUnder,
  pendingGeneratedContent,
  recordGeneratedFile,
  recordSkippedFile,
  setPendingGeneratedContent,
} from "./generation-run";

export { recordSkippedFile };

/** Whether `target` exists on disk or in the dry-run overlay. */
export async function fileExistsAsync(target: string): Promise<boolean> {
  if (pendingGeneratedContent(target) !== undefined) return true;

  return fs.fileExistsAsync(target);
}

/** Whether `directory` exists on disk or holds a file in the dry-run overlay. */
export async function directoryExistsAsync(directory: string): Promise<boolean> {
  if (hasPendingContentUnder(directory)) return true;

  return fs.directoryExistsAsync(directory);
}

/** Read `target`, preferring what this dry run already "wrote". */
export async function getFileAsync(target: string): Promise<string> {
  const pending = pendingGeneratedContent(target);

  if (pending !== undefined) return pending;

  return fs.getFileAsync(target);
}

export async function getJsonFileAsync<T = unknown>(target: string): Promise<T> {
  const pending = pendingGeneratedContent(target);

  if (pending !== undefined) return JSON.parse(pending) as T;

  return fs.getJsonFileAsync<T>(target);
}

/**
 * Write `content` to `target`, recording `create`, `update` or `unchanged`.
 * Identical content is not rewritten.
 */
export async function putFileAsync(target: string, content: string): Promise<void> {
  const run = currentGenerationRun();

  if (!run) {
    await fs.putFileAsync(target, content);
    return;
  }

  const exists = await fileExistsAsync(target);

  if (exists && (await getFileAsync(target)) === content) {
    recordGeneratedFile(target, "unchanged");
    return;
  }

  recordGeneratedFile(target, exists ? "update" : "create");

  if (run.dryRun) {
    setPendingGeneratedContent(target, content);
    return;
  }

  await fs.putFileAsync(target, content);
}

export async function putJsonFileAsync(target: string, value: unknown): Promise<void> {
  if (!currentGenerationRun()) {
    await fs.putJsonFileAsync(target, value);
    return;
  }

  await putFileAsync(target, JSON.stringify(value, null, 2));
}

/** Create `directory`; a dry run leaves no empty folders behind. */
export async function ensureDirectoryAsync(directory: string): Promise<void> {
  if (currentGenerationRun()?.dryRun) return;

  await fs.ensureDirectoryAsync(directory);
}
