import { colors } from "@mongez/copper";
import {
  ensureDirectoryAsync as fsEnsureDirectoryAsync,
  putFileAsync as fsPutFileAsync,
} from "@warlock.js/fs";
import path from "node:path";

/**
 * Dry-run state for the `generate.*` command family.
 *
 * When enabled (via `--dry-run`), every generator write becomes a no-op
 * that instead reports the file it *would* have created — letting a
 * developer preview a scaffold (especially `generate.module --crud`,
 * which writes ~25 files) before anything touches disk.
 *
 * The flag is process-wide module state: the CLI runs one command per
 * process, and a top-level generator (e.g. `generateModule`) sets it
 * once, so nested helpers (`createMigrationFile`, `ensureComponentDirectory`)
 * inherit it without threading a parameter through every signature.
 */
let dryRun = false;

/**
 * Toggle dry-run mode. Call once at the start of a generator action,
 * e.g. `setDryRun(Boolean(data.options.dryRun))`.
 */
export function setDryRun(value: boolean): void {
  dryRun = value;

  if (value) {
    console.log(
      colors.yellowBright("\n○ Dry run — previewing planned files. Nothing will be written.\n"),
    );
  }
}

export function isDryRun(): boolean {
  return dryRun;
}

/** Render an absolute path relative to the cwd for tidy logs. */
function relativePath(target: string): string {
  return path.relative(process.cwd(), target) || target;
}

/**
 * Write a generated file — or, in dry-run, report what *would* be
 * written. Owns the per-file log so call sites stay a single line.
 *
 * @example
 * await putFileAsync(controllerPath, controllerContent);
 * // normal:  ✓ created src/app/users/controllers/create-user.controller.ts
 * // dry-run: ○ would create src/app/users/controllers/create-user.controller.ts
 */
export async function putFileAsync(target: string, content: string): Promise<void> {
  if (dryRun) {
    console.log(`${colors.cyan("○")} would create ${colors.gray(relativePath(target))}`);
    return;
  }

  await fsPutFileAsync(target, content);
  console.log(`${colors.green("✓")} created ${colors.gray(relativePath(target))}`);
}

/**
 * Ensure a directory exists. Silent no-op in dry-run so a preview never
 * leaves empty folders behind.
 */
export async function ensureDirectoryAsync(target: string): Promise<void> {
  if (dryRun) return;

  await fsEnsureDirectoryAsync(target);
}
