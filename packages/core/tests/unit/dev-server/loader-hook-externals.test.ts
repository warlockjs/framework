import { build } from "esbuild";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveExternalsFromCore } from "../../../src/dev-server/loader/register-loader";

/**
 * Regression cover for the phantom-dependency bug reported from kafr-yasef on
 * 2026-08-09 (`plans/2026-08-09-dev-loader-hook-phantom-deps-under-pnpm.md`).
 *
 * `registerLoader` bundles the ESM loader hook and writes it into the
 * *consuming app's* `.warlock/loader-hook.mjs`. Any bare npm import left in
 * that bundle resolves from the app, walking the app's `node_modules` — but
 * `esbuild` and `get-tsconfig` are **core's** dependencies. npm and yarn hoist
 * everything flat so it works by accident; pnpm's strict layout does not, and
 * the dev server dies with `ERR_MODULE_NOT_FOUND` for a package the app never
 * imported.
 *
 * The invariant this file guards: **the generated bundle contains no bare npm
 * specifier**. Asserting on the bundle rather than on a hard-coded list means
 * a future import added anywhere in the hook's module graph is covered too.
 */

const hookEntry = path.join(
  process.cwd(),
  "src",
  "dev-server",
  "loader",
  "hook-thread.ts",
);

/** Build the hook exactly as `registerLoader` does. */
async function bundleHook(withPlugin: boolean) {
  const result = await build({
    entryPoints: [hookEntry],
    bundle: true,
    format: "esm",
    write: false,
    platform: "node",
    target: "node20",
    packages: "external",
    plugins: withPlugin ? [resolveExternalsFromCore] : [],
  });

  return result.outputFiles[0].text;
}

/** Every import specifier in the bundle that isn't a Node built-in. */
function npmImports(code: string): string[] {
  return [...code.matchAll(/from\s+"([^"]+)"/g)]
    .map(match => match[1])
    .filter(specifier => !specifier.startsWith("node:"));
}

const isBareSpecifier = (specifier: string) =>
  !specifier.startsWith("file://") && !specifier.startsWith(".") && !path.isAbsolute(specifier);

describe("loader-hook bundle externals", () => {
  it("leaves no bare npm import for the consuming app to resolve", async () => {
    const bare = npmImports(await bundleHook(true)).filter(isBareSpecifier);

    expect(bare).toEqual([]);
  });

  it("points every npm import at a real file", async () => {
    const imports = npmImports(await bundleHook(true));

    // The hook genuinely needs esbuild + get-tsconfig, so this must not be
    // vacuously true — if the list is empty the assertion above proves nothing.
    expect(imports.length).toBeGreaterThan(0);

    for (const specifier of imports) {
      expect(specifier.startsWith("file://")).toBe(true);
    }
  });

  it("would fail without the plugin — the bug being guarded", async () => {
    const bare = npmImports(await bundleHook(false)).filter(isBareSpecifier);

    // Documents the defect: unpatched, the bundle ships bare `esbuild` and
    // `get-tsconfig` imports into the app's own directory.
    expect(bare).toContain("esbuild");
    expect(bare).toContain("get-tsconfig");
  });

  it("does not try to externalise the entry point itself", async () => {
    // On Windows the entry's absolute path ("D:\\…") also matches the plugin's
    // filter; marking it external makes esbuild fail the whole build.
    await expect(bundleHook(true)).resolves.toBeTypeOf("string");
  });
});
