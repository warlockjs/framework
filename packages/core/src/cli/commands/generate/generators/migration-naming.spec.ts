import { describe, expect, it } from "vitest";
import { migrationTimestamp } from "../../../../generations/features/shared/migration-timestamp";

describe("migration naming", () => {
  it("stamps migrations in the shared MM-DD-YYYY_HH-MM-SS shape", () => {
    expect(migrationTimestamp()).toMatch(/^\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2}$/);
  });
});
