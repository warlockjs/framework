import baseConfig from "@mongez/config";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../../../src/config/config-getter";

beforeEach(() => {
  baseConfig.set("app", {
    name: "Online Store",
    locales: ["en", "ar"],
  });
  baseConfig.set("database.host", "127.0.0.1");
  baseConfig.set("database.port", 27017);
});

describe("config.key", () => {
  it("reads a value via a dot-notation path", () => {
    expect(config.key("database.host")).toBe("127.0.0.1");
    expect(config.key("database.port")).toBe(27017);
  });

  it("reads a nested value inside a config group", () => {
    expect(config.key("app.name")).toBe("Online Store");
    expect(config.key("app.locales")).toEqual(["en", "ar"]);
  });

  it("returns the default when the key is missing", () => {
    expect(config.key("database.timeout", 5000)).toBe(5000);
  });

  it("returns null when the key is missing and no default is given", () => {
    // @mongez/config resolves an absent key to null (not undefined).
    expect(config.key("database.missing")).toBeNull();
  });
});

describe("config.get", () => {
  it("reads an entire config group by name", () => {
    expect(config.get("app")).toEqual({
      name: "Online Store",
      locales: ["en", "ar"],
    });
  });

  it("returns the default when the group is missing", () => {
    const fallback = { driver: "memory" };

    expect(config.get("cache", fallback)).toBe(fallback);
  });
});
