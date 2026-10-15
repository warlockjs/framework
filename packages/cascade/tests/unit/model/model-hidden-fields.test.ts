import { v } from "@warlock.js/seal";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import { createMockDriver } from "../../utils/test-helpers";

/**
 * Security regression tests for serialization.
 *
 * `toJSON()` (invoked implicitly by `JSON.stringify(model)` / `res.json(model)`)
 * used to return the entire raw document when no `resource`/`toJsonColumns`
 * was configured — leaking password hashes, tokens and PII by default.
 * `static hidden` fields must now ALWAYS be stripped from the output,
 * whatever else is configured, and credential-shaped schema fields that are
 * not covered must trigger a one-time console warning.
 */

class HiddenFieldsUser extends Model {
  static table = "hidden_users";
  static hidden = ["password", "resetToken"];
}

class NoHiddenUser extends Model {
  static table = "plain_users";
}

class HiddenWithColumnsUser extends Model {
  static table = "columns_users";
  static hidden = ["password"];
  static toJsonColumns = ["id", "name", "password"];
}

class PassthroughResource {
  public constructor(public resourceData: Record<string, unknown>) {}

  public toJSON(): Record<string, unknown> {
    return this.resourceData;
  }
}

class HiddenWithResourceUser extends Model {
  static table = "resource_users";
  static hidden = ["password"];
  static resource = PassthroughResource;
}

describe("Model serialization — hidden fields", () => {
  beforeAll(() => {
    dataSourceRegistry.register({
      name: "test",
      driver: createMockDriver(),
      isDefault: true,
    });
  });

  afterAll(() => {
    dataSourceRegistry.clear();
  });

  it("strips hidden fields from toJSON() when no resource/toJsonColumns are set", () => {
    const user = new HiddenFieldsUser({
      id: 1,
      name: "Alice",
      password: "$2b$10$hash",
      resetToken: "tok_secret",
    });

    expect(user.toJSON()).toEqual({ id: 1, name: "Alice" });
  });

  it("strips hidden fields from JSON.stringify() output", () => {
    const user = new HiddenFieldsUser({ id: 1, password: "$2b$10$hash" });

    expect(JSON.parse(JSON.stringify(user))).toEqual({ id: 1 });
  });

  it("does not mutate model.data when stripping", () => {
    const user = new HiddenFieldsUser({ id: 1, password: "$2b$10$hash" });

    user.toJSON();

    expect(user.get("password")).toBe("$2b$10$hash");
  });

  it("keeps the full-document default when no hidden fields are declared", () => {
    const user = new NoHiddenUser({ id: 1, name: "Bob", role: "member" });

    expect(user.toJSON()).toEqual({ id: 1, name: "Bob", role: "member" });
  });

  it("strips hidden fields even when toJsonColumns includes them", () => {
    const user = new HiddenWithColumnsUser({
      id: 1,
      name: "Carol",
      password: "$2b$10$hash",
    });

    expect(user.toJSON()).toEqual({ id: 1, name: "Carol" });
  });

  it("strips hidden fields from the data handed to a resource class", () => {
    const user = new HiddenWithResourceUser({
      id: 1,
      name: "Dave",
      password: "$2b$10$hash",
    });

    expect(user.toJSON()).toEqual({ id: 1, name: "Dave" });
  });
});

describe("Model serialization — sensitive schema field warning", () => {
  beforeAll(() => {
    dataSourceRegistry.register({
      name: "test",
      driver: createMockDriver(),
      isDefault: true,
    });
  });

  afterAll(() => {
    dataSourceRegistry.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns once when a credential-shaped schema field is not hidden", () => {
    class LeakyUser extends Model {
      static table = "leaky_users";
      static schema = v.object({
        name: v.string(),
        password: v.string(),
      });
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    new LeakyUser({ name: "Eve", password: "x" }).toJSON();
    new LeakyUser({ name: "Eve", password: "x" }).toJSON();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"password"');
    expect(warn.mock.calls[0][0]).toContain("LeakyUser");
  });

  it("does not warn when the sensitive field is declared hidden", () => {
    class CoveredUser extends Model {
      static table = "covered_users";
      static hidden = ["password"];
      static schema = v.object({
        name: v.string(),
        password: v.string(),
      });
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    new CoveredUser({ name: "Frank", password: "x" }).toJSON();

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when the schema has no sensitive-looking fields", () => {
    class BoringModel extends Model {
      static table = "boring";
      static schema = v.object({ name: v.string() });
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    new BoringModel({ name: "Grace" }).toJSON();

    expect(warn).not.toHaveBeenCalled();
  });
});
