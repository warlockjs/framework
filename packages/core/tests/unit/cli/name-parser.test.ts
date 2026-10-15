import { describe, expect, it } from "vitest";
import {
  Name,
  parseModulePath,
  parseName,
  pluralName,
  singularName,
} from "../../../src/cli/commands/generate/utils/name-parser";

/**
 * Unit coverage for the generator name utilities: splitting `module/name`
 * input, and the `Name` value object that exposes every case variant
 * (pascal/camel/kebab/snake) plus pluralization used throughout the stubs.
 */
describe("parseModulePath", () => {
  it("splits module and name on the slash", () => {
    expect(parseModulePath("users/create-user")).toEqual({
      module: "users",
      name: "create-user",
    });
  });

  it("returns only a name when there is no slash", () => {
    expect(parseModulePath("create-user")).toEqual({ name: "create-user" });
  });

  it("treats everything after the first slash as the name", () => {
    expect(parseModulePath("users/nested/create-user")).toEqual({
      module: "users",
      name: "nested/create-user",
    });
  });
});

describe("Name — case variants", () => {
  it("derives pascal, camel, kebab, and snake from kebab input", () => {
    const name = parseName("create-user");

    expect(name.pascal).toBe("CreateUser");
    expect(name.camel).toBe("createUser");
    expect(name.kebab).toBe("create-user");
    expect(name.snake).toBe("create_user");
  });

  it("normalizes camelCase input across variants", () => {
    const name = new Name("createUser");

    expect(name.kebab).toBe("create-user");
    expect(name.snake).toBe("create_user");
    expect(name.pascal).toBe("CreateUser");
  });

  it("preserves the raw input", () => {
    expect(new Name("Create-User").raw).toBe("Create-User");
  });
});

describe("Name — pluralization", () => {
  it("pluralizes via the plural getter", () => {
    expect(new Name("user").plural.kebab).toBe("users");
    expect(new Name("category").plural.kebab).toBe("categories");
  });

  it("singularizes via the singular getter", () => {
    expect(new Name("users").singular.kebab).toBe("user");
    expect(new Name("categories").singular.kebab).toBe("category");
  });

  it("pluralName() returns a Name seeded with the plural form", () => {
    const name = pluralName("product");

    expect(name).toBeInstanceOf(Name);
    expect(name.kebab).toBe("products");
  });

  it("singularName() returns a Name seeded with the singular form", () => {
    const name = singularName("products");

    expect(name).toBeInstanceOf(Name);
    expect(name.kebab).toBe("product");
  });
});
