import { colors } from "@mongez/copper";
import {
  ensureDirectoryAsync as fsEnsureDirectoryAsync,
  putFileAsync as fsPutFileAsync,
} from "@warlock.js/fs";
import { existsSync, readFileSync } from "node:fs";
import {
  isGenerationDryRun,
  pendingGeneratedContent,
  recordGeneratedFile,
  recordSkippedFile,
  setPendingGeneratedContent,
  toReportPath,
} from "../../../../generations/generation-run";

/**
 * Dry-run state for the `generate.*` command family.
 *
 * When enabled (via `--dry-run`), every generator write becomes a no-op
 * that instead reports the file it *would* have created, overwritten or
 * skipped — letting a developer preview a scaffold (especially
 * `generate.module`, which writes ~25 files) before anything touches disk.
 *
 * The flag is process-wide module state: the CLI runs one command per
 * process, and a top-level generator (e.g. `generateModule`) sets it
 * once, so nested helpers (`createMigrationFile`, `ensureComponentDirectory`)
 * inherit it without threading a parameter through every signature.
 * A generation run started by `runGenerationCommand` (`--json`) is honoured
 * too, and records every file for the report.
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

/**
 * When true, a file that already exists and differs from the generated
 * content is left untouched (and reported) instead of overwritten.
 * Model/module generators enable it unless `--force --overwrite` is given.
 */
let skipExisting = false;
const skippedFiles: string[] = [];

export function setSkipExisting(value: boolean): void {
  skipExisting = value;
  skippedFiles.length = 0;
}

/** Print the files skipped because they exist and differ. No-op when none. */
export function reportSkippedFiles(): void {
  if (skippedFiles.length === 0) return;

  console.log(
    colors.yellow(
      `
! Skipped ${skippedFiles.length} existing file(s) that differ from the generated output (pass --force --overwrite to replace them):`,
    ),
  );

  for (const file of skippedFiles) {
    console.log(`  ${colors.gray(file)}`);
  }

  skippedFiles.length = 0;
}

export function isDryRun(): boolean {
  return dryRun || isGenerationDryRun();
}

/** Render an absolute path relative to the cwd for tidy logs. */
function relativePath(target: string): string {
  return toReportPath(target);
}

/** The content at `target`: what this dry run already "wrote", else the disk. */
function existingContent(target: string): string | undefined {
  const pending = pendingGeneratedContent(target);

  if (pending !== undefined) return pending;

  return existsSync(target) ? readFileSync(target, "utf8") : undefined;
}

/**
 * Write a generated file — or, in dry-run, report what *would* be
 * written. Owns the per-file log so call sites stay a single line.
 *
 * A file that already holds exactly the generated content is left alone.
 * With `setSkipExisting(true)` an existing file that differs is skipped and
 * listed; otherwise it is overwritten (generators refuse to reach this point
 * for an existing file unless `--force` was given).
 *
 * @example
 * await putFileAsync(controllerPath, controllerContent);
 * // normal:  ✓ created src/app/users/controllers/create-user.controller.ts
 * // dry-run: ○ would create src/app/users/controllers/create-user.controller.ts
 */
export async function putFileAsync(target: string, content: string): Promise<void> {
  const current = existingContent(target);

  if (current !== undefined && current === content) {
    recordGeneratedFile(target, "unchanged");
    return;
  }

  if (current !== undefined && skipExisting) {
    skippedFiles.push(relativePath(target));
    recordSkippedFile(target, "exists and differs from the generated output");
    return;
  }

  const type = current === undefined ? "create" : "overwrite";

  recordGeneratedFile(target, type);

  if (isDryRun()) {
    setPendingGeneratedContent(target, content);
    console.log(`${colors.cyan("○")} would ${type} ${colors.gray(relativePath(target))}`);
    return;
  }

  await fsPutFileAsync(target, content);
  console.log(
    `${colors.green("✓")} ${type === "create" ? "created" : "overwrote"} ${colors.gray(relativePath(target))}`,
  );
}

/**
 * Ensure a directory exists. Silent no-op in dry-run so a preview never
 * leaves empty folders behind.
 */
export async function ensureDirectoryAsync(target: string): Promise<void> {
  if (isDryRun()) return;

  await fsEnsureDirectoryAsync(target);
}
