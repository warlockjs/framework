import { describe, expect, it } from "vitest";
import { defineConfig } from "../../../src/warlock-config/define-config";
import { defaultWarlockConfigurations } from "../../../src/warlock-config/default-configurations";

/**
 * Unit coverage for `defineConfig` — the resolver users call in
 * `warlock.config.ts`. It deep-merges their options over the framework
 * defaults (via `@mongez/reinforcements` `merge`). The contract: user values
 * win, untouched defaults survive, nested objects merge key-by-key, and the
 * shared `defaultWarlockConfigurations` singleton is never mutated between
 * calls.
 */
describe("defineConfig", () => {
  it("fills in the default build configuration when none is supplied", () => {
    const resolved = defineConfig({});

    expect(resolved.build).toEqual({
      outDirectory: process.cwd() + "/dist",
      outFile: "app.js",
      sourcemap: true,
      minify: true,
    });
  });

  it("lets a user value override a single default key", () => {
    const resolved = defineConfig({ build: { minify: false } });

    expect(resolved.build?.minify).toBe(false);
    // sibling defaults survive the partial override
    expect(resolved.build?.outFile).toBe("app.js");
    expect(resolved.build?.sourcemap).toBe(true);
  });

  it("merges user-only sections alongside the defaults", () => {
    const resolved = defineConfig({
      server: { port: 4000, host: "0.0.0.0" },
    });

    expect(resolved.server).toEqual({ port: 4000, host: "0.0.0.0" });
    // build defaults remain intact
    expect(resolved.build?.outFile).toBe("app.js");
  });

  it("deep-merges nested devServer.watch without dropping the other branch", () => {
    const resolved = defineConfig({
      devServer: {
        generateTypings: false,
        watch: { include: ["src/**/*.ts"] },
      },
    });

    expect(resolved.devServer?.generateTypings).toBe(false);
    expect(resolved.devServer?.watch?.include).toEqual(["src/**/*.ts"]);
  });

  it("replaces arrays rather than concatenating them", () => {
    const resolved = defineConfig({
      database: { migrations: [] },
    });

    expect(resolved.database?.migrations).toEqual([]);
  });

  it("does not mutate the shared default configuration across calls", () => {
    const before = JSON.parse(JSON.stringify(defaultWarlockConfigurations));

    defineConfig({ build: { minify: false, outFile: "bundle.js" } });

    expect(defaultWarlockConfigurations).toEqual(before);
    // a fresh call still sees pristine defaults
    expect(defineConfig({}).build?.minify).toBe(true);
  });

  it("returns a new object distinct from the defaults reference", () => {
    const resolved = defineConfig({});

    expect(resolved).not.toBe(defaultWarlockConfigurations);
  });
});
