import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as netSubpath from "@warlock.js/core/net";
import * as netEntry from "../../../src/net";
import { isPrivateOrReservedIp } from "../../../src/storage/utils/classify-ip-address";

/**
 * `@warlock.js/core/net` is a published subpath (pkgist builds
 * `src/net/index.ts` as its own entry). Core declares no `exports` map, so
 * inside this repository the specifier resolves by path to the root
 * `net/index.ts` shim. This test lives under `tests/` for the same reason
 * as the `errors` subpath test: a `src/` spec importing the shim would put
 * a file outside `rootDir` into the strictness gate's program.
 */
describe("@warlock.js/core/net inside the workspace", () => {
  it("resolves to the same entry as src/net", () => {
    expect(Object.keys(netSubpath).sort()).toEqual(Object.keys(netEntry).sort());
    expect(netSubpath.isPrivateOrReservedIp).toBe(isPrivateOrReservedIp);
    expect(netSubpath.isPrivateOrReservedIp("169.254.169.254")).toBe(true);
  });

  it("keeps the workspace shim a single re-export", () => {
    const shim = transformSync(
      readFileSync(path.resolve(__dirname, "../../../net/index.ts"), "utf8"),
      { loader: "ts", format: "esm" },
    ).code;

    expect(shim.trim()).toBe('export * from "../src/net";');
  });
});
