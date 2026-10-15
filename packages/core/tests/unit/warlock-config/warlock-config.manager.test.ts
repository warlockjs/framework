import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isUnknownTsExtensionError,
  WarlockConfigManager,
} from "../../../src/warlock-config/warlock-config.manager";

describe("isUnknownTsExtensionError", () => {
  it("matches Node's ERR_UNKNOWN_FILE_EXTENSION code", () => {
    const error = Object.assign(new TypeError("boom"), {
      code: "ERR_UNKNOWN_FILE_EXTENSION",
    });

    expect(isUnknownTsExtensionError(error)).toBe(true);
  });

  it('matches the "Unknown file extension .ts" message', () => {
    const error = new TypeError('Unknown file extension ".ts" for /x/warlock.config.ts');

    expect(isUnknownTsExtensionError(error)).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isUnknownTsExtensionError(new Error("network down"))).toBe(false);
    expect(isUnknownTsExtensionError(undefined)).toBe(false);
  });
});

describe("WarlockConfigManager — esbuild config fallback (Node without native TS)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "warlock-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("transpiles a .ts config with esbuild, loads its default export, and removes the temp file", async () => {
    const configPath = join(dir, "warlock.config.ts");
    // TS-only syntax (`satisfies`, type annotation) — proves esbuild actually
    // stripped types rather than the runtime importing the .ts directly.
    writeFileSync(
      configPath,
      `type Cfg = { cli: { commands: string[] } };\n` +
        `const config: Cfg = { cli: { commands: [] } } satisfies Cfg;\n` +
        `export default config;\n`,
      "utf8",
    );

    const manager = new WarlockConfigManager();
    // loadViaEsbuild is private — exercise it directly for the fallback path,
    // since this test runner (modern Node) would otherwise import .ts natively.
    const config = await (
      manager as unknown as {
        loadViaEsbuild(p: string): Promise<{ cli: { commands: string[] } }>;
      }
    ).loadViaEsbuild(configPath);

    expect(config).toEqual({ cli: { commands: [] } });

    // The temporary compiled sibling must be cleaned up.
    const leftovers = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
    expect(leftovers).toEqual([]);
  });
});
