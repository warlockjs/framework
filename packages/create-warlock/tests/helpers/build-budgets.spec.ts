import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("template client performance budgets", () => {
  it("ships explicit gzip limits and error enforcement", () => {
    const config = readFileSync(
      new URL("../../templates/warlock/warlock.config.ts", import.meta.url),
      "utf8",
    );
    expect(config).toMatch(/budgets:\s*\{/);
    expect(config).toMatch(/js:\s*"150kb"/);
    expect(config).toMatch(/css:\s*"50kb"/);
    expect(config).toMatch(/mode:\s*"error"/);
  });
});
