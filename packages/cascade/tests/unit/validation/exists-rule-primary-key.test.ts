import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import { cleanupModelsRegistery, registerModelInRegistry } from "../../../src/model/register-model";
import { existsRule } from "../../../src/validation/rules/exists-rule";
import { createMockDriver } from "../../utils/test-helpers";

class Organization extends Model {
  static table = "organizations";
}

function fakeQuery() {
  const wheres: unknown[][] = [];
  const query: Record<string, unknown> = {};
  query.where = vi.fn((...args: unknown[]) => {
    wheres.push(args);
    return query;
  });
  query.first = vi.fn(async () => ({ id: 1 }));
  return { query, wheres };
}

const bind = (options: Record<string, unknown>) =>
  ({ ...existsRule, context: { options } }) as never;

describe("existsRule column default (K4 B6)", () => {
  beforeAll(() => {
    dataSourceRegistry.register({ name: "b6", driver: createMockDriver(), isDefault: true });
    registerModelInRegistry("Organization", Organization);
  });

  afterAll(() => {
    dataSourceRegistry.clear();
    cleanupModelsRegistery();
  });

  it("looks up organization_id values by the model primary key", async () => {
    const { query, wheres } = fakeQuery();
    vi.spyOn(Organization, "query").mockReturnValue(query as never);

    await existsRule.validate?.call(bind({ Model: Organization }), "org-1", {
      key: "organization_id",
      allValues: {},
    } as never);

    expect(wheres[0]).toEqual(["id", "org-1"]);
  });

  it("lets an explicit column win", async () => {
    const { query, wheres } = fakeQuery();
    vi.spyOn(Organization, "query").mockReturnValue(query as never);

    await existsRule.validate?.call(bind({ Model: Organization, column: "slug" }), "acme", {
      key: "organization_id",
      allValues: {},
    } as never);

    expect(wheres[0]).toEqual(["slug", "acme"]);
  });
});
