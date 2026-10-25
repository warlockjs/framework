import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function template(file: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../templates/warlock/${file}`, import.meta.url)),
    "utf8",
  );
}

describe("starter test runtime defaults", () => {
  it("boots once per worker and resets the database between files", () => {
    const config = template("src/config/tests.ts");

    expect(config).toContain('process.env.WARLOCK_TEST_LIFETIME !== "file"');
    expect(config).toContain('lifetime: workerLifetime ? "worker" : "file"');
    expect(config).toContain("resetDatabase: workerLifetime");
    expect(config).toContain('setupTest({ importModule, lifetime: "file" })');
  });

  it.each(["src/config/database.ts", "src/config/database.postgres.ts"])(
    "%s gives each Vitest worker its own database",
    (file) => {
      const config = template(file);

      expect(config).toContain("process.env.VITEST");
      expect(config).toContain("VITEST_POOL_ID");
      expect(config).not.toMatch(/database: env\("DB_NAME"\)/);
    },
  );
});
