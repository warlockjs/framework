import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import { existsRule } from "../../../src/validation/rules/exists-rule";
import { uniqueRule } from "../../../src/validation/rules/unique-rule";
import { createMockDriver } from "../../utils/test-helpers";

/**
 * `unique()` / `exists()` ask the database a yes/no question instead of
 * fetching and hydrating a model, unless a fetch listener must see the lookup.
 */

function fakeQuery(found: boolean) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.where = vi.fn(() => query);
  query.first = vi.fn(async () => (found ? { id: 1 } : null));
  query.exists = vi.fn(async () => found);
  return query;
}

function bind(rule: typeof existsRule | typeof uniqueRule, options: Record<string, unknown>) {
  return {
    ...rule,
    context: {
      options,
      errorMessage: undefined,
      translationParams: {},
      translatableParams: {},
      attributesList: {},
      translatedAttributes: {},
    },
  } as never;
}

const context = { key: "email", allValues: {} } as never;

describe("unique / exists rules existence check", () => {
  beforeAll(() => {
    dataSourceRegistry.register({ name: "rules", driver: createMockDriver(), isDefault: true });
  });

  afterAll(() => {
    dataSourceRegistry.clear();
  });

  it("uses exists() and never hydrates a model", async () => {
    class Account extends Model {
      public static table = "accounts";
    }

    const query = fakeQuery(true);
    vi.spyOn(Account, "query").mockReturnValue(query as never);

    const unique = await uniqueRule.validate?.call(
      bind(uniqueRule, { Model: Account }),
      "a@b.c",
      context,
    );
    const exists = await existsRule.validate?.call(
      bind(existsRule, { Model: Account }),
      "a@b.c",
      context,
    );

    expect(query.exists).toHaveBeenCalledTimes(2);
    expect(query.first).not.toHaveBeenCalled();
    expect(unique?.isValid).toBe(false);
    expect(exists?.isValid).toBe(true);
  });

  it("reports a missing row the same way", async () => {
    class Account extends Model {
      public static table = "accounts";
    }

    const query = fakeQuery(false);
    vi.spyOn(Account, "query").mockReturnValue(query as never);

    const unique = await uniqueRule.validate?.call(
      bind(uniqueRule, { Model: Account }),
      "a@b.c",
      context,
    );
    const exists = await existsRule.validate?.call(
      bind(existsRule, { Model: Account }),
      "a@b.c",
      context,
    );

    expect(unique?.isValid).toBe(true);
    expect(exists?.isValid).toBe(false);
  });

  it("keeps fetching the row when a fetching listener is registered", async () => {
    class Watched extends Model {
      public static table = "watched";
    }

    Watched.events().on("fetching", () => {});
    const query = fakeQuery(true);
    vi.spyOn(Watched, "query").mockReturnValue(query as never);

    await uniqueRule.validate?.call(bind(uniqueRule, { Model: Watched }), "a@b.c", context);

    expect(query.first).toHaveBeenCalledTimes(1);
    expect(query.exists).not.toHaveBeenCalled();
  });
});
