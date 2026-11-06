import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function template(file: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../templates/warlock/${file}`, import.meta.url)),
    "utf8",
  );
}

describe("starter storage config", () => {
  it("chooses the driver from STORAGE_DRIVER and falls back to local", () => {
    const config = template("src/config/storage.ts");

    expect(config).toContain('default: env("STORAGE_DRIVER", "local"),');
    expect(config).not.toMatch(/default: "local"/);
  });

  it("reads the R2 key prefix from R2_PREFIX, defaulting to the app name", () => {
    const config = template("src/config/storage.ts");

    expect(config).toContain('prefix: env("R2_PREFIX", env("APP_NAME", "warlock.js")),');
    expect(config).not.toMatch(/prefix: "warlock\.js"/);
  });

  it("documents STORAGE_DRIVER and R2_PREFIX in the example env file", () => {
    const example = template(".env.example");

    expect(example).toMatch(/^STORAGE_DRIVER=local$/m);
    expect(example).toMatch(/^#R2_PREFIX=$/m);
    // The scaffolder replaces this placeholder with the app name, which is
    // what the R2_PREFIX default reads.
    expect(example).toMatch(/^APP_NAME="appName"$/m);
  });
});
