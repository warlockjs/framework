import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { E2ESpec } from "../../e2e/types";

/** Node 22.15 does not enable TypeScript stripping by default:
 * https://nodejs.org/download/release/v22.15.0/docs/api/typescript.html#type-stripping
 * Bundle local
 * spec imports using core's existing compiler, retaining package imports so
 * the spec uses the same installed harness as the CLI. The temporary module
 * lives inside the project for normal node_modules resolution.
 */
export async function loadE2ESpec(
  file: string,
): Promise<{ spec: E2ESpec; dispose: () => Promise<void> }> {
  const directory = resolve(".warlock/e2e");
  await mkdir(directory, { recursive: true });
  const entry = join(directory, `spec-${randomUUID()}.mjs`);
  try {
    const { build } = await import("esbuild");
    const output = await build({
      entryPoints: [file],
      bundle: true,
      packages: "external",
      platform: "node",
      target: "node22",
      format: "esm",
      sourcemap: "inline",
      write: false,
      logLevel: "silent",
    });
    const compiled = output.outputFiles[0];
    if (!compiled) throw new Error(`Could not compile browser spec ${file}`);
    await writeFile(entry, compiled.contents, { mode: 0o600 });
    const module = (await import(pathToFileURL(entry).href)) as { default?: E2ESpec };
    if (!module.default) throw new Error(`${file} must default-export defineE2E({ app, run })`);
    return { spec: module.default, dispose: () => rm(entry, { force: true }) };
  } catch (error) {
    await rm(entry, { force: true });
    throw error;
  }
}
