import { describe, expectTypeOf, it } from "vitest";
import type AuditEntry from "../../tests/fixtures/model-resources/src/app/users/models/audit-entry.model";
import type { FixtureUser } from "../../tests/fixtures/model-resources/src/app/users/models/fixture-user.model";
import type { Serialized } from "./serialized";

/**
 * Type-level proof that the declaration `warlock generate.typings` emits makes
 * `Serialized<Model>` resolve to the resource output.
 *
 * `tests/fixtures/model-resources/typings/model-resources.d.ts` is the exact text
 * `renderModelResourceRegistry` produces for the fixture app beside it (the
 * runtime half of that claim is asserted in
 * `dev-server/model-resource-typings.spec.ts`). The typecheck program includes
 * it like any generated file, so the augmentation of `"@warlock.js/core"` is in
 * scope here without being declared in this spec.
 *
 * The raw data of both models carries a field the resource leaves out
 * (`password`, `ip`). Without the registry entry `Serialized` would expose
 * them; with it, only the resource shape comes through.
 */
describe("Serialized with a generated ModelResourceRegistry", () => {
  it("resolves a named model export to its resource output", () => {
    expectTypeOf<Serialized<FixtureUser>>().toEqualTypeOf<{
      id: number;
      name: string;
      createdAt: { iso: string; format: string; timestamp: number; humanTime: string };
    }>();
  });

  it("resolves a default model export to its default resource export", () => {
    expectTypeOf<Serialized<AuditEntry>>().toEqualTypeOf<{ id: number; action: string }>();
  });

  it("resolves the models inside arrays and objects", () => {
    expectTypeOf<Serialized<{ users: FixtureUser[] }>["users"][number]["name"]>().toEqualTypeOf<string>();
  });

  it("keeps the raw fields out of the output", () => {
    expectTypeOf<Serialized<FixtureUser>>().not.toHaveProperty("password");
    expectTypeOf<Serialized<AuditEntry>>().not.toHaveProperty("ip");
  });

  it("is inert at runtime", () => {
    // The assertions above are enforced by `tsc -p tsconfig.typecheck.json`.
  });
});
