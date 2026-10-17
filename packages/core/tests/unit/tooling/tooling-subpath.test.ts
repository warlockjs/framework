import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as toolingSubpath from "@warlock.js/core/tooling";
import * as rootEntry from "../../../src";
import * as toolingEntry from "../../../src/tooling";

/**
 * `@warlock.js/core/tooling` is a published subpath (pkgist builds
 * `src/tooling/index.ts` as its own entry). Inside the repository it resolves
 * by path to the root `tooling/index.ts` shim. Lives under `tests/` for the
 * same rootDir reason as the errors subpath test.
 */
describe("@warlock.js/core/tooling inside the workspace", () => {
  it("resolves to the same entry as src/tooling and exposes the documented API", () => {
    expect(Object.keys(toolingSubpath).sort()).toEqual(Object.keys(toolingEntry).sort());
    expect(toolingSubpath.inspectApp).toBeTypeOf("function");
    expect(toolingSubpath.runCheck).toBeTypeOf("function");
    expect(toolingSubpath.runTypecheck).toBeTypeOf("function");
    expect(toolingSubpath.INSPECT_SCHEMA_VERSION).toBe(1);
    expect(toolingSubpath.CHECK_EXIT_CODES).toEqual({ ok: 0, code: 1, environment: 2 });
  });

  it("stays off the root barrel, which only carries the error codes", () => {
    expect("inspectApp" in rootEntry).toBe(false);
    expect("runCheck" in rootEntry).toBe(false);
    expect(rootEntry.explainErrorCode("WL3001")?.code).toBe("WL3001");
    expect(rootEntry.WarlockError).toBeTypeOf("function");
  });

  it("keeps the workspace shim a single re-export", () => {
    const shim = transformSync(
      readFileSync(path.resolve(__dirname, "../../../tooling/index.ts"), "utf8"),
      { loader: "ts", format: "esm" },
    ).code;

    expect(shim.trim()).toBe('export * from "../src/tooling";');
  });
});
