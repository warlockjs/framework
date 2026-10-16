import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as errorsSubpath from "@warlock.js/core/errors";
import * as rootHttpErrors from "../../../src/http/errors";
import * as errorsEntry from "../../../src/errors";

/**
 * `@warlock.js/core/errors` is a published subpath (pkgist builds
 * `src/errors/index.ts` as its own entry). Core declares no `exports` map, so
 * inside this repository the specifier resolves by path to the root
 * `errors/index.ts` shim. This test lives under `tests/` on purpose: the
 * release strictness gate compiles `tsconfig.json` (`rootDir: "src"`), and a
 * `src/` spec importing the shim would put a file outside `rootDir` into
 * that program (TS6059).
 */
describe("@warlock.js/core/errors inside the workspace", () => {
  it("resolves to the same entry as src/errors", () => {
    expect(Object.keys(errorsSubpath).sort()).toEqual(Object.keys(errorsEntry).sort());
    expect(errorsSubpath.HttpError).toBe(rootHttpErrors.HttpError);
    expect(new errorsSubpath.BadRequestError("x")).toBeInstanceOf(rootHttpErrors.HttpError);
  });

  it("keeps the workspace shim a single re-export", () => {
    const shim = transformSync(
      readFileSync(path.resolve(__dirname, "../../../errors/index.ts"), "utf8"),
      { loader: "ts", format: "esm" },
    ).code;

    expect(shim.trim()).toBe('export * from "../src/errors";');
  });
});
