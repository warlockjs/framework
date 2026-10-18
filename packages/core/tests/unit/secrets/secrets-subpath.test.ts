import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as subpath from "@warlock.js/core/secrets";
import * as source from "../../../src/secrets";

describe("secrets entry points", () => {
  it("exposes the same facade and types through the workspace subpath", () => {
    expect(subpath.secrets).toBe(source.secrets);
    expect(subpath.SecretStore).toBe(source.SecretStore);
    expect(subpath.MemorySecretBackend).toBe(source.MemorySecretBackend);
    expect(subpath.SecretStoreError).toBe(source.SecretStoreError);
  });

  it("wires both the root export and published subpath", () => {
    expect(readFileSync(path.resolve(__dirname, "../../../src/index.ts"), "utf8")).toContain(
      'export * from "./secrets"',
    );
    expect(
      readFileSync(
        path.resolve(__dirname, "../../../../../tools/release/pkgist.config.ts"),
        "utf8",
      ),
    ).toContain('"secrets/index.ts"');
  });
});
