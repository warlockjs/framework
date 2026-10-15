import { afterEach, describe, expect, it } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { createMockDriver } from "../../helpers/mock-driver";

describe("default data source (K4 B4)", () => {
  afterEach(() => dataSourceRegistry.clear());

  it("keeps the first source as default when later ones do not claim it", () => {
    dataSourceRegistry.register({ name: "primary", driver: createMockDriver() }, { explicitDefault: false });
    dataSourceRegistry.register({ name: "analytics", driver: createMockDriver() }, { explicitDefault: false });
    dataSourceRegistry.register({ name: "logs", driver: createMockDriver() }, { explicitDefault: false });

    expect(dataSourceRegistry.get().name).toBe("primary");
  });

  it("lets a later source explicitly claim the default over the implicit one", () => {
    dataSourceRegistry.register({ name: "primary", driver: createMockDriver() }, { explicitDefault: false });
    dataSourceRegistry.register({ name: "logs", driver: createMockDriver(), isDefault: true });

    expect(dataSourceRegistry.get().name).toBe("logs");
  });

  it("throws when two sources explicitly claim the default", () => {
    dataSourceRegistry.register({ name: "a", driver: createMockDriver(), isDefault: true });

    expect(() =>
      dataSourceRegistry.register({ name: "b", driver: createMockDriver(), isDefault: true }),
    ).toThrow(/already the default/);
  });

  it("hasDefault() reflects registration", () => {
    expect(dataSourceRegistry.hasDefault()).toBe(false);
    dataSourceRegistry.register({ name: "a", driver: createMockDriver() });
    expect(dataSourceRegistry.hasDefault()).toBe(true);
  });
});
