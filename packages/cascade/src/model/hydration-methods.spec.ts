import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "../data-source/data-source";
import { dataSourceRegistry } from "../data-source/data-source-registry";
import { PostgresDialect } from "../drivers/postgres/postgres-dialect";
import { Model } from "./model";

const ISO = "2024-05-01T10:00:00.000Z";

const driver = {
  dialect: new PostgresDialect(),
  on: () => undefined,
  getDirtyTracker: vi.fn(() => ({})),
  // Re-inflates ISO strings in place, like the real drivers.
  deserialize: (data: Record<string, unknown>) => {
    for (const key of Object.keys(data)) {
      const value = data[key];

      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
        data[key] = new Date(value);
      }
    }

    return data;
  },
};

class Event extends Model<{ id?: number; startsAt?: Date; label?: string; note?: string }> {
  public static table = "events";
  public static schema = v.object({ startsAt: v.date(), label: v.string() });
}

describe("hydrate", () => {
  beforeEach(() => {
    dataSourceRegistry.clear();
    driver.getDirtyTracker.mockClear();
    dataSourceRegistry.register(
      new DataSource({ name: "hydrate", driver: driver as never, isDefault: true }),
    );
  });

  it("keeps a declared date column as a Date and restores undeclared date strings", () => {
    const event = Event.hydrate({ id: 1, startsAt: ISO, label: ISO, note: ISO });

    expect(event.get("startsAt")).toBeInstanceOf(Date);
    expect(event.get("label")).toBe(ISO);
    expect(event.get("note")).toBe(ISO);
    expect(event.isNew).toBe(false);
  });

  it("leaves short and non-date strings alone", () => {
    const event = Event.hydrate({ id: 1, label: "hello", note: "2024" });

    expect(event.get("label")).toBe("hello");
    expect(event.get("note")).toBe("2024");
  });

  it("resolves the data source once per row", () => {
    const getDriver = vi.spyOn(Event, "getDriver");

    Event.hydrate({ id: 1 });

    expect(getDriver).toHaveBeenCalledTimes(1);
  });

  it("uses a driver passed by the caller without resolving one", () => {
    const getDriver = vi.spyOn(Event, "getDriver");

    Event.hydrate({ id: 1 }, driver as never);
    Event.hydrate({ id: 2 }, driver as never);

    expect(getDriver).not.toHaveBeenCalled();
    expect(driver.getDirtyTracker).toHaveBeenCalledTimes(2);
  });

  it("a model built by hand still resolves its own driver", () => {
    const getDriver = vi.spyOn(Event, "getDriver");

    new Event({ id: 1 });

    expect(getDriver).toHaveBeenCalledTimes(1);
  });
});

describe("hydrate with a resolved driver", () => {
  it("uses the driver it is given instead of resolving the data source", () => {
    dataSourceRegistry.clear();
    dataSourceRegistry.register(
      new DataSource({ name: "hydrate-given", driver: driver as never, isDefault: true }),
    );

    const given = { ...driver, deserialize: vi.fn((data: Record<string, unknown>) => data) };

    const event = Event.hydrate({ id: 1, label: "a" }, given as never);

    expect(given.deserialize).toHaveBeenCalledTimes(1);
    expect(event.isNew).toBe(false);
  });
});
