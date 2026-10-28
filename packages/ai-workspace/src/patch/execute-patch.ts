import { fs } from "@warlock.js/fs";
import { WorkspaceEditError } from "../errors";
import type { ApplyPatchFileResult, ApplyPatchInput, ApplyPatchResult } from "../contracts";
import { applyHunks } from "./apply-hunks";
import { parsePatch } from "./parse-patch";

/** Largest file, in UTF-8 bytes, `applyPatch` will read and rewrite. */
const MAX_PATCH_FILE_BYTES = 10 * 1024 * 1024;

/** The file operations the patch engine runs on; the workspace ops layer and the generic fallback each provide one. */
export interface PatchIO {
  /** Turn a patch path into a stable key plus a display path (and refuse a path outside the workspace). */
  resolve(inputPath: string): Promise<{ absolutePath: string; relativePath: string }>;
  exists(key: string): Promise<boolean>;
  stat?(key: string): Promise<{ type: string; size: number }>;
  /** Raw file content. */
  read(key: string): Promise<string>;
  /** Write content, creating parent directories. */
  write(key: string, content: string): Promise<void>;
  remove(key: string): Promise<void>;
  withLock<T>(key: string, task: () => Promise<T>): Promise<T>;
  display(key: string): string;
}

export async function executePatch(input: ApplyPatchInput, io: PatchIO): Promise<ApplyPatchResult> {
  {
    const filePatches = parsePatch(input.patch);

    // Resolve every path through the jail first (symlinks, `..`, deny globs).
    const targets = await Promise.all(
      filePatches.map(async (filePatch) => ({
        filePatch,
        from: filePatch.oldPath === null ? null : await io.resolve(filePatch.oldPath),
        to: filePatch.newPath === null ? null : await io.resolve(filePatch.newPath),
      })),
    );

    const lockPaths = [
      ...new Set(
        targets.flatMap((target) =>
          [target.from?.absolutePath, target.to?.absolutePath].filter(
            (value): value is string => value !== undefined,
          ),
        ),
      ),
    ].sort();

    const run = async (): Promise<ApplyPatchResult> => {
      // Virtual tree: absolute path -> content (null = removed). Later file
      // patches see the result of earlier ones.
      const staged = new Map<string, string | null>();
      const original = new Map<string, string | null>();
      const results: ApplyPatchFileResult[] = [];

      const load = async (absolutePath: string, shown: string): Promise<string | null> => {
        if (staged.has(absolutePath)) {
          return staged.get(absolutePath) ?? null;
        }

        if (!(await io.exists(absolutePath))) {
          original.set(absolutePath, null);

          return null;
        }

        const stat = io.stat ? await io.stat(absolutePath) : undefined;

        if (stat !== undefined && stat.type !== "file") {
          throw new WorkspaceEditError(`"${shown}" is not a regular file; it cannot be patched.`, {
            type: "file-missing",
            path: shown,
          });
        }

        if (stat !== undefined && stat.size > MAX_PATCH_FILE_BYTES) {
          throw new WorkspaceEditError(
            `"${shown}" is larger than ${MAX_PATCH_FILE_BYTES} bytes; it cannot be patched.`,
            { type: "patch-invalid", path: shown },
          );
        }

        const content = await io.read(absolutePath);

        if (content.includes("\0")) {
          throw new WorkspaceEditError(
            `"${shown}" is a binary file; binary files cannot be patched.`,
            {
              type: "binary-file",
              path: shown,
            },
          );
        }

        original.set(absolutePath, content);

        return content;
      };

      for (const { filePatch, from, to } of targets) {
        const shownFrom = from?.relativePath || filePatch.oldPath || "";
        const shownTo = to?.relativePath || filePatch.newPath || "";

        if (filePatch.kind === "create") {
          const absolutePath = (to as NonNullable<typeof to>).absolutePath;

          if ((await load(absolutePath, shownTo)) !== null) {
            throw new WorkspaceEditError(
              `"${shownTo}" already exists; the patch cannot create it.`,
              {
                type: "file-exists",
                path: shownTo,
              },
            );
          }

          const content = applyHunks("", filePatch.hunks, shownTo);

          staged.set(absolutePath, content);
          results.push({
            path: shownTo,
            action: "created",
            hunks: filePatch.hunks.length,
            hash: fs.hash.string(content),
          });

          continue;
        }

        const source = (from as NonNullable<typeof from>).absolutePath;
        const current = await load(source, shownFrom);

        if (current === null) {
          throw new WorkspaceEditError(
            `"${shownFrom}" does not exist; the patch cannot change it.`,
            {
              type: "file-missing",
              path: shownFrom,
            },
          );
        }

        const updated = applyHunks(current, filePatch.hunks, shownFrom);

        if (filePatch.kind === "delete") {
          if (updated !== "") {
            throw new WorkspaceEditError(
              `The patch deletes "${shownFrom}" but its hunks do not remove all of the file's content.`,
              {
                type: "hunk-failed",
                path: shownFrom,
                hunkIndex: Math.max(filePatch.hunks.length - 1, 0),
              },
            );
          }

          staged.set(source, null);
          results.push({ path: shownFrom, action: "deleted", hunks: filePatch.hunks.length });

          continue;
        }

        if (filePatch.kind === "rename") {
          const destination = (to as NonNullable<typeof to>).absolutePath;

          if (destination !== source && (await load(destination, shownTo)) !== null) {
            throw new WorkspaceEditError(
              `"${shownTo}" already exists; the patch cannot rename "${shownFrom}" onto it.`,
              { type: "file-exists", path: shownTo },
            );
          }

          staged.set(source, null);
          staged.set(destination, updated);
          results.push({
            path: shownTo,
            action: "renamed",
            oldPath: shownFrom,
            hunks: filePatch.hunks.length,
            hash: fs.hash.string(updated),
          });

          continue;
        }

        staged.set(source, updated);
        results.push({
          path: shownFrom,
          action: "modified",
          hunks: filePatch.hunks.length,
          hash: fs.hash.string(updated),
        });
      }

      if (input.dryRun === true) {
        return { files: results, dryRun: true };
      }

      // Commit. Anything that fails part-way is rolled back to the original state.
      const touched: string[] = [];

      try {
        for (const [absolutePath, content] of staged) {
          if (content !== null && content !== (original.get(absolutePath) ?? null)) {
            await io.write(absolutePath, content);
            touched.push(absolutePath);
          }
        }

        for (const [absolutePath, content] of staged) {
          if (
            content === null &&
            original.get(absolutePath) !== null &&
            original.has(absolutePath)
          ) {
            await io.remove(absolutePath);
            touched.push(absolutePath);
          }
        }
      } catch (error) {
        const failures: string[] = [];

        for (const absolutePath of touched.reverse()) {
          try {
            const before = original.get(absolutePath) ?? null;

            if (before === null) {
              if (await io.exists(absolutePath)) {
                await io.remove(absolutePath);
              }
            } else {
              await io.write(absolutePath, before);
            }
          } catch {
            failures.push(io.display(absolutePath));
          }
        }

        const reason = error instanceof Error ? error.message : String(error);

        throw new WorkspaceEditError(
          `Writing the patch failed (${reason}); ${failures.length === 0 ? "every change was rolled back" : `could not restore: ${failures.join(", ")}`}.`,
          { type: "patch-invalid", path: "" },
        );
      }

      return { files: results, dryRun: false };
    };

    // Hold every touched path's lock (sorted, so concurrent patches cannot deadlock).
    const locked = lockPaths.reduceRight<() => Promise<ApplyPatchResult>>(
      (inner, lockPath) => () => io.withLock(lockPath, inner),
      run,
    );

    return locked();
  }
}
