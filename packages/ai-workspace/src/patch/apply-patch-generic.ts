import path from "node:path";
import { fs } from "@warlock.js/fs";
import { WorkspaceEditError } from "../errors";
import type { ApplyPatchInput, ApplyPatchResult, WorkspaceOps } from "../contracts";
import { executePatch } from "./execute-patch";

/** Most lines the generic reader asks `readFile` for. */
const MAX_READ_LINES = 1_000_000;

/**
 * Raw content of a file through `ops.readFile`, which returns numbered lines.
 * The numbering is stripped and the trailing newline restored by checking the
 * result against the file's hash, so the content is exact or the read fails.
 */
async function readRaw(ops: WorkspaceOps, filePath: string): Promise<string> {
  const result = await ops.readFile(filePath, { offset: 1, limit: MAX_READ_LINES });

  if (result.truncated || result.bytesCapped) {
    throw new WorkspaceEditError(
      `"${filePath}" is too large to read in full; it cannot be patched.`,
      { type: "patch-invalid", path: filePath },
    );
  }

  const lines =
    result.totalLines === 0
      ? []
      : result.content.split("\n").map((line) => line.replace(/^ *\d+\t/, ""));
  const joined = lines.join("\n");

  for (const candidate of [joined + "\n", joined, ""]) {
    if (fs.hash.string(candidate) === result.hash) {
      return candidate;
    }
  }

  throw new WorkspaceEditError(`Could not read "${filePath}" exactly; it cannot be patched.`, {
    type: "patch-invalid",
    path: filePath,
  });
}

/**
 * `applyPatch` for a custom {@link WorkspaceOps} that does not provide its
 * own: the same engine and the same all-or-nothing behaviour, built on the
 * ops it does have (`exists`, `readFile`, `writeFile`, `remove`). Every
 * hunk of every file is checked in memory first; the writes then run, and if
 * one fails the ones already done are put back.
 */
export function applyPatchWithOps(
  ops: WorkspaceOps,
  input: ApplyPatchInput,
): Promise<ApplyPatchResult> {
  // Keys are normalised relative paths; the ops enforce their own jail on each call.
  const chain = new Map<string, Promise<unknown>>();

  return executePatch(input, {
    resolve: async (inputPath) => {
      const key = path.posix.normalize(inputPath.replace(/\\/g, "/"));

      return { absolutePath: key, relativePath: key };
    },
    exists: (key) => ops.exists(key),
    read: (key) => readRaw(ops, key),
    write: async (key, content) => {
      await ops.writeFile(key, content);
    },
    remove: (key) => ops.remove(key),
    withLock: async (key, task) => {
      const previous = chain.get(key) ?? Promise.resolve();
      const current = previous.then(task, task);

      chain.set(
        key,
        current.catch(() => undefined),
      );

      return current;
    },
    display: (key) => key,
  });
}
