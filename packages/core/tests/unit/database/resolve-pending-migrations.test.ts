import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePendingMigrations } from "../../../src/database/resolve-pending-migrations";

const { listPendingMigrations } = vi.hoisted(() => ({
  listPendingMigrations: vi.fn(),
}));

vi.mock("@warlock.js/cascade", () => ({
  listPendingMigrations,
}));

/**
 * `resolvePendingMigrations` exists to keep two answers apart that both look
 * like an empty list:
 *
 *   - "nothing is pending"        → safe to proceed
 *   - "I could not work it out"   → stop and get a human
 *
 * Every test here is about that distinction. A regression that collapses them
 * would still return a plausible value, so these assert the discriminant
 * explicitly rather than checking the array.
 */
describe("resolvePendingMigrations", () => {
  beforeEach(() => {
    listPendingMigrations.mockReset();
  });

  it("returns the pending migrations, in the order the loader produced them", async () => {
    listPendingMigrations.mockResolvedValue([
      { name: "create_users", createdAt: "01-01-2026_00-00-00" },
      { name: "create_posts" },
    ]);

    const result = await resolvePendingMigrations(async () => {});

    expect(result.type).toBe("resolved");

    // Narrowed by the assertion above; TypeScript needs the guard.
    if (result.type !== "resolved") return;

    expect(result.migrations.map((migration) => migration.name)).toEqual([
      "create_users",
      "create_posts",
    ]);
  });

  it("loads BEFORE computing — the pending set is empty without registration", async () => {
    const order: string[] = [];

    listPendingMigrations.mockImplementation(async () => {
      order.push("computed");
      return [];
    });

    await resolvePendingMigrations(async () => {
      order.push("loaded");
    });

    expect(order).toEqual(["loaded", "computed"]);
  });

  it("reports an empty result as RESOLVED, not unavailable", async () => {
    listPendingMigrations.mockResolvedValue([]);

    const result = await resolvePendingMigrations(async () => {});

    // A fully-migrated database is a real answer, and the caller is entitled to
    // treat it as one.
    expect(result).toEqual({ type: "resolved", migrations: [] });
  });

  it("converts a throwing loader into 'unavailable' rather than propagating", async () => {
    const result = await resolvePendingMigrations(async () => {
      throw new Error("src/app/users/migrations/broken.ts must have a default export");
    });

    expect(result).toEqual({
      type: "unavailable",
      reason: "src/app/users/migrations/broken.ts must have a default export",
    });
  });

  it("never reports an unreadable tree as an empty pending set", async () => {
    listPendingMigrations.mockResolvedValue([]);

    const result = await resolvePendingMigrations(async () => {
      throw new Error("boom");
    });

    // The failure mode this whole module exists to prevent: a load failure
    // followed by a truthful "0 pending" from an empty registry.
    expect(result.type).not.toBe("resolved");
    expect(listPendingMigrations).not.toHaveBeenCalled();
  });

  it("converts a failure inside the computation itself, not just the loader", async () => {
    listPendingMigrations.mockRejectedValue(new Error("connection refused"));

    const result = await resolvePendingMigrations(async () => {});

    expect(result).toEqual({ type: "unavailable", reason: "connection refused" });
  });

  it("survives a thrown non-Error without losing the reason", async () => {
    const result = await resolvePendingMigrations(async () => {
      throw "migrations directory vanished";
    });

    expect(result).toEqual({ type: "unavailable", reason: "migrations directory vanished" });
  });
});
