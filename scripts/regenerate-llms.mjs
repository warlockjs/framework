#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Project root skills and grouped indexes/topics through each package generator. */
export function regenerateLlms(packagesRoot, run = spawnSync) {
  const generated = [];
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const root = path.join(packagesRoot, entry.name);
    const script = path.join(root, "scripts/generate-llms.mjs");
    if (!existsSync(script)) continue;
    const result = run(process.execPath, [script], { cwd: root, stdio: "inherit" });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Could not regenerate ${entry.name} reference files (exit ${result.status}).`,
        { cause: result.error },
      );
    }
    generated.push(entry.name);
  }
  return generated;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  regenerateLlms(path.join(repoRoot, "packages"));
}
