import { describe, expect, it, vi } from "vitest";

// database/utils.ts imports `authService` from @warlock.js/auth, whose barrel
// re-imports @warlock.js/core by package name — unresolvable in this monorepo
// checkout (no build). Stub the auth surface so utils.ts loads in isolation.
// We only test the slug/seeder helpers, which never call authService.
vi.mock("@warlock.js/auth", () => ({
  authService: { hashPassword: vi.fn((value: string) => `hashed:${value}`) },
}));

import { seeder } from "../../../src/database/seeds/seeder";
import { useComputedSlug } from "../../../src/database/utils";

/**
 * Database-module utility tests. The database slice's public surface is thin —
 * model transformers + the seeder factory — and most of it is tightly coupled to
 * @warlock.js/cascade + @warlock.js/seal model/schema runtime. These cover the
 * parts that are unit-testable WITHOUT a live database connection.
 *
 * DB IS MOCKED / NOT USED — no Mongo/Postgres connection here (Docker absent).
 *
 * Source: core/src/database/utils.ts, core/src/database/seeds/seeder.ts.
 */

describe("seeder() factory", () => {
  it("returns the seeder definition unchanged (pass-through)", () => {
    const run = vi.fn(async () => undefined);
    const definition = {
      name: "users-seeder",
      description: "Seed users",
      once: true,
      order: 1,
      run,
    };

    const result = seeder(definition);

    expect(result).toBe(definition);
    expect(result.name).toBe("users-seeder");
    expect(result.run).toBe(run);
  });
});

describe("useComputedSlug — sibling scope", () => {
  /**
   * Drives the ComputedCallback the same way Cascade's schema engine does:
   * `(data, context)` where `context.rootContext.model` is the model instance.
   */
  function invoke(callback: any, data: Record<string, any>, modelValue?: string) {
    const model = { get: vi.fn(() => modelValue) };
    const context = { rootContext: { model }, allValues: data };

    return { value: callback(data, context), model };
  }

  it("slugifies the source field value", () => {
    const callback = useComputedSlug("title");

    const { value } = invoke(callback, { title: "Hello World" });

    expect(value).toBe("hello-world");
  });

  it("slugifies a different configured field", () => {
    const callback = useComputedSlug("name");

    const { value } = invoke(callback, { name: "My Cool Product!" });

    expect(value).toBe("my-cool-product");
  });

  it("falls back to the existing model value when the source field is empty", () => {
    const callback = useComputedSlug("title");

    const { value, model } = invoke(callback, { title: "" }, "existing-slug");

    expect(model.get).toHaveBeenCalledWith("title");
    expect(value).toBe("existing-slug");
  });
});

describe("useComputedSlug — global scope", () => {
  it("reads the source field from allValues (dot-path aware)", () => {
    const callback = useComputedSlug("seo.title", "global");

    const model = { get: vi.fn() };
    const data = {};
    const context = { rootContext: { model }, allValues: { seo: { title: "Deep Title" } } };

    expect(callback(data, context)).toBe("deep-title");
  });
});
