/**
 * Unit tests for the DB-aware seal rules `exists` and `unique`.
 *
 * Each rule reads its config off `this.context.options`, builds a query via
 * the resolved model class, applies where clauses, and inspects the first
 * row. We spy on the model's static `query()` to return a recording fake so
 * we can assert the exact where-clauses and the valid/invalid verdict without
 * a database.
 *
 * The call convention mirrors the existing database-model-rule suite:
 * `rule.validate.call({ ...rule, context }, value, context)`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import {
  cleanupModelsRegistery,
  registerModelInRegistry,
} from "../../../src/model/register-model";
import { existsRule } from "../../../src/validation/rules/exists-rule";
import { uniqueRule } from "../../../src/validation/rules/unique-rule";
import { createMockDriver } from "../../utils/test-helpers";

/**
 * Recording fake for the rule's query: query().where(...).first(). `first`
 * resolves with the supplied document (or null/undefined for "not found").
 */
function fakeRuleQuery(firstResult: unknown) {
  const wheres: unknown[][] = [];
  const query: Record<string, unknown> = {};
  query.where = vi.fn((...args: unknown[]) => {
    wheres.push(args);
    return query;
  });
  query.first = vi.fn(async () => firstResult);
  query.wheres = wheres;
  return query as Record<string, unknown> & {
    where: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    wheres: unknown[][];
  };
}

/**
 * Build the `this` binding a rule body runs against. The real seal pipeline
 * supplies a fully-formed ContextualSchemaRule (rule fields + a `context` bag
 * with translation slots). We replicate the minimum `invalidRule()` reads so
 * the invalid path renders its message instead of throwing.
 */
function bindRule(
  rule: typeof existsRule | typeof uniqueRule,
  options: Record<string, unknown>,
) {
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

/** A SchemaContext stub carrying the fields the rules touch. */
function ctx(overrides: Record<string, unknown> = {}) {
  return { key: "email", allValues: {}, ...overrides } as never;
}

class User extends Model {
  static table = "users";
}

describe("validation/rules — exists & unique", () => {
  beforeAll(() => {
    dataSourceRegistry.register({
      name: "test",
      driver: createMockDriver(),
      isDefault: true,
    });
    registerModelInRegistry("User", User);
  });

  afterAll(() => {
    dataSourceRegistry.clear();
    cleanupModelsRegistery();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("existsRule", () => {
    it("has the expected name and default message", () => {
      expect(existsRule.name).toBe("exists");
      expect(existsRule.defaultErrorMessage).toBe("The :input must exist");
    });

    it("is valid when a matching document exists", async () => {
      const fake = fakeRuleQuery({ id: 1 });
      vi.spyOn(User, "query").mockReturnValue(fake as never);

      const result = await existsRule.validate?.call(
        bindRule(existsRule, { Model: User }),
        "a@b.com",
        ctx(),
      );

      expect(result).toEqual({ isValid: true });
      // Defaults the column to the context key.
      expect(fake.wheres[0]).toEqual(["email", "a@b.com"]);
    });

    it("is invalid when no document matches", async () => {
      const fake = fakeRuleQuery(null);
      vi.spyOn(User, "query").mockReturnValue(fake as never);

      const result = await existsRule.validate?.call(
        bindRule(existsRule, { Model: User }),
        "missing@b.com",
        ctx(),
      );

      expect(result).toHaveProperty("isValid", false);
    });

    it("uses an explicit column override instead of the context key", async () => {
      const fake = fakeRuleQuery({ id: 1 });
      vi.spyOn(User, "query").mockReturnValue(fake as never);

      await existsRule.validate?.call(
        bindRule(existsRule, { Model: User, column: "slug" }),
        "abc",
        ctx(),
      );

      expect(fake.wheres[0]).toEqual(["slug", "abc"]);
    });

    it("invokes the custom query callback with the db query and value", async () => {
      const fake = fakeRuleQuery({ id: 1 });
      vi.spyOn(User, "query").mockReturnValue(fake as never);
      const queryCb = vi.fn(async () => {});

      await existsRule.validate?.call(
        bindRule(existsRule, { Model: User, query: queryCb }),
        "v",
        ctx({ allValues: { other: 1 } }),
      );

      expect(queryCb).toHaveBeenCalledTimes(1);
      const arg = queryCb.mock.calls[0][0] as { value: unknown; allValues: unknown };
      expect(arg.value).toBe("v");
      expect(arg.allValues).toEqual({ other: 1 });
    });

    it("resolves a string model reference via the registry", async () => {
      const fake = fakeRuleQuery({ id: 1 });
      vi.spyOn(User, "query").mockReturnValue(fake as never);

      const result = await existsRule.validate?.call(
        bindRule(existsRule, { Model: "User" }),
        "x",
        ctx(),
      );

      expect(result).toEqual({ isValid: true });
    });
  });

  describe("uniqueRule", () => {
    it("has the expected name and default message", () => {
      expect(uniqueRule.name).toBe("unique");
      expect(uniqueRule.defaultErrorMessage).toBe("The :input must be unique");
    });

    it("is valid when no existing document is found", async () => {
      const fake = fakeRuleQuery(null);
      vi.spyOn(User, "query").mockReturnValue(fake as never);

      const result = await uniqueRule.validate?.call(
        bindRule(uniqueRule, { Model: User }),
        "fresh@b.com",
        ctx(),
      );

      expect(result).toEqual({ isValid: true });
      expect(fake.wheres[0]).toEqual(["email", "fresh@b.com"]);
    });

    it("is invalid when a duplicate document exists", async () => {
      const fake = fakeRuleQuery({ id: 7 });
      vi.spyOn(User, "query").mockReturnValue(fake as never);

      const result = await uniqueRule.validate?.call(
        bindRule(uniqueRule, { Model: User }),
        "dupe@b.com",
        ctx(),
      );

      expect(result).toHaveProperty("isValid", false);
    });

    it("adds an except clause reading the sibling value from allValues", async () => {
      const fake = fakeRuleQuery(null);
      vi.spyOn(User, "query").mockReturnValue(fake as never);

      await uniqueRule.validate?.call(
        bindRule(uniqueRule, { Model: User, except: "id" }),
        "v",
        ctx({ allValues: { id: 42 } }),
      );

      // First where = the uniqueness check; second = the exclusion.
      expect(fake.wheres[0]).toEqual(["email", "v"]);
      expect(fake.wheres[1]).toEqual(["id", "!=", 42]);
    });

    it("omits the except clause when the sibling value is undefined", async () => {
      const fake = fakeRuleQuery(null);
      vi.spyOn(User, "query").mockReturnValue(fake as never);

      await uniqueRule.validate?.call(
        bindRule(uniqueRule, { Model: User, except: "id" }),
        "v",
        ctx(),
      );

      expect(fake.wheres).toHaveLength(1);
    });

    it("supports exceptColumnName/exceptValue exclusion", async () => {
      const fake = fakeRuleQuery(null);
      vi.spyOn(User, "query").mockReturnValue(fake as never);

      await uniqueRule.validate?.call(
        bindRule(uniqueRule, { Model: User, exceptColumnName: "tenant_id", exceptValue: 5 }),
        "v",
        ctx(),
      );

      expect(fake.wheres).toContainEqual(["tenant_id", "!=", 5]);
    });

    it("invokes the custom query callback before checking for duplicates", async () => {
      const fake = fakeRuleQuery(null);
      vi.spyOn(User, "query").mockReturnValue(fake as never);
      const queryCb = vi.fn(async () => {});

      await uniqueRule.validate?.call(
        bindRule(uniqueRule, { Model: User, query: queryCb }),
        "v",
        ctx(),
      );

      expect(queryCb).toHaveBeenCalledTimes(1);
    });
  });
});
