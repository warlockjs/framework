import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { PostgresDialect } from "../drivers/postgres/postgres-dialect";
import { Model } from "./model";

const driver = {
  dialect: new PostgresDialect(),
  on: () => undefined,
  getDirtyTracker: vi.fn(() => ({})),
  deserialize: (data: Record<string, unknown>) => data,
  serialize: (data: Record<string, unknown>) => data,
};

class Note extends Model<{ id?: number; title?: string }> {
  public static table = "notes";
  public static schema = v.object({ title: v.string() });
}

/**
 * Pins the shape of a hydrated model: which own keys it has and what it
 * serialises to. `events` and `loadedRelations` are public own fields that apps
 * read, spread and iterate, so they stay allocated on the instance.
 */
describe("hydrated model own keys and serialisation", () => {
  beforeEach(() => {
    dataSourceRegistry.clear();
    dataSourceRegistry.register(
      new DataSource({ name: "own-keys", driver: driver as never, isDefault: true }),
    );
  });

  it("owns `events` and `loadedRelations` as enumerable fields", () => {
    const note = Note.hydrate({ id: 1, title: "a" });
    const keys = Object.keys(note);

    expect(keys).toContain("events");
    expect(keys).toContain("loadedRelations");
    expect(Object.getOwnPropertyDescriptor(note, "events")?.enumerable).toBe(true);
    expect(Object.getOwnPropertyDescriptor(note, "loadedRelations")?.enumerable).toBe(true);
    expect(Object.keys({ ...note })).toEqual(keys);
    expect(note.loadedRelations).toBeInstanceOf(Map);
    expect(note.loadedRelations.size).toBe(0);
  });

  it("serialises the same with relations loaded and listeners attached", () => {
    const plain = Note.hydrate({ id: 1, title: "a" });
    const busy = Note.hydrate({ id: 1, title: "a" });

    busy.events.on("saving", () => undefined);
    busy.loadedRelations.set("owner", { name: "x" });

    expect(Object.keys(busy)).toEqual(Object.keys(plain));
    expect(JSON.parse(JSON.stringify(plain))).toEqual({ id: 1, title: "a" });
    expect(JSON.parse(JSON.stringify(busy))).toEqual({ id: 1, title: "a" });
    expect(plain.toSnapshot().data).toEqual({ id: 1, title: "a" });
  });
});
