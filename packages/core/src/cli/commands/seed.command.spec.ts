import { describe, expect, it } from "vitest";
import { seedCommand } from "./seed.command";

/**
 * `warlock seed` preloads connectors before running seeders. A seeder that
 * calls `storage.put(...)` (a plausible, dogfooded operation — see the blog
 * seed data) crashed with `TypeError: Cannot read properties of null
 * (reading 'name')` because the "storage" connector was never in this list,
 * so `Storage.init()` never ran and `activeDriver` stayed `null`.
 */
describe("seed command connectors", () => {
  it("preloads the storage connector so seeders can call storage.put()", () => {
    expect(seedCommand.commandPreload?.connectors).toContain("storage");
  });
});
