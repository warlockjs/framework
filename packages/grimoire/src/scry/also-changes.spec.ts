import { describe, expect, it } from "vitest";
import type { BookFileType } from "../contracts/adapter";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { formatScryResult } from "./format";
import { scry } from "./query";

const located = <T>(value: T) => ({ value, at: { file: "x", line: 1 } });

type Spec = {
  file: string;
  type?: BookFileType;
  owner?: string | null;
  imports?: string[];
  about?: string | null;
};

function snapshotOf(
  specs: Spec[],
  flows: unknown[] = [],
  collectedFlows: Record<string, unknown> = {},
) {
  const files = specs.map((item) => ({
    file: item.file,
    module: item.file.split("/").slice(0, 3).join("/"),
    type: item.type ?? "util",
    about: item.about ?? null,
    exports: [],
    imports: (item.imports ?? []).map((file) => ({ specifier: file, file })),
    importedBy: specs
      .filter((other) => other.imports?.includes(item.file))
      .map((other) => other.file),
    mobileApp: null,
  }));

  return {
    root: "/p",
    routes: "fresh",
    written: {
      apps: [],
      features: [
        {
          id: "catalog",
          readme: { title: located("Catalog"), summary: null, why: null, audience: [] },
          flows,
        },
      ],
    },
    proofs: [],
    book: { facts: { pages: [], mobile: [], routes: [], named: [], files, tests: [] } },
    ownership: {
      files: Object.fromEntries(
        specs.map((item) => [
          item.file,
          { file: item.file, owner: item.owner === undefined ? "catalog" : item.owner },
        ]),
      ),
    },
    apps: {},
    collected: { tasksIndex: { open: [], done: [] }, flows: collectedFlows },
  } as unknown as GrimoireSnapshot;
}

function search(snapshot: GrimoireSnapshot, text: string) {
  const result = scry(snapshot, { type: "search", text });

  if (result.type !== "search") throw new Error("expected a search answer");

  return result;
}

const SERVICE = "src/app/catalog/services/zephyr.service.ts";

describe("search: files that change with the top hits", () => {
  const snapshot = snapshotOf([
    {
      file: SERVICE,
      type: "service",
      imports: [
        "src/app/catalog/types/arrival.type.ts",
        "src/app/catalog/repositories/products.repository.ts",
        "src/app/shared/clock.ts",
      ],
    },
    { file: "src/app/catalog/types/arrival.type.ts", type: "type" },
    { file: "src/app/catalog/repositories/products.repository.ts", type: "repository" },
    { file: "src/app/shared/clock.ts", owner: "shared" },
    {
      file: "src/app/catalog/controllers/arrivals.controller.ts",
      type: "controller",
      imports: [SERVICE],
    },
    {
      file: "src/app/orders/controllers/orders.controller.ts",
      owner: "orders",
      imports: [SERVICE],
    },
    { file: "src/app/catalog/services/arrivals.spec.ts", type: "spec", imports: [SERVICE] },
    {
      file: "src/app/catalog/tests/other.spec.ts",
      type: "spec",
      imports: ["src/app/catalog/repositories/products.repository.ts"],
    },
  ]);

  it("lists same-feature imports and importers and the tests, not other features", () => {
    const result = search(snapshot, "zephyr");

    expect(result.hits[0]?.id).toBe(SERVICE);
    expect(result.alsoChanges).toEqual([
      {
        file: "src/app/catalog/controllers/arrivals.controller.ts",
        reason: "imports",
        via: [SERVICE],
      },
      {
        file: "src/app/catalog/repositories/products.repository.ts",
        reason: "imported-by",
        via: [SERVICE],
      },
      { file: "src/app/catalog/types/arrival.type.ts", reason: "imported-by", via: [SERVICE] },
      { file: "src/app/catalog/services/arrivals.spec.ts", reason: "test", via: [SERVICE] },
    ]);
    expect(result.next).toBe(`warlock scry --impact ${SERVICE}`);
  });

  it("folds the top file's impact into the answer without repeating listed files, and caps it at 8", () => {
    const result = search(snapshot, "zephyr");

    // The orders controller imports the service from another feature, so only the impact list has it.
    expect(result.impact).toEqual({
      file: SERVICE,
      files: ["src/app/orders/controllers/orders.controller.ts"],
      more: 0,
      routes: [],
      flows: [],
      tests: [],
    });

    const importers = Array.from({ length: 12 }, (_, index) => ({
      file: `src/app/orders/c${index}.ts`,
      owner: "orders",
      imports: [SERVICE],
    }));
    const wide = search(snapshotOf([{ file: SERVICE, type: "service" }, ...importers]), "zephyr");

    expect(wide.impact?.files).toHaveLength(8);
    expect(wide.impact?.more).toBe(4);
    expect(formatScryResult(wide).join("\n")).toContain("+4 more");
  });

  it("prints the block, the next line and no weak note for a name match", () => {
    const lines = formatScryResult(search(snapshot, "zephyr"));
    const start = lines.indexOf("changes with the top hits:");

    expect(start).toBeGreaterThan(0);
    expect(lines[start + 1]).toMatch(/arrivals\.controller\.ts\s+imports zephyr\.service\.ts$/);
    expect(lines[start + 2]).toMatch(/products\.repository\.ts\s+imported by zephyr\.service\.ts$/);
    // The impact of the top file follows the block; it already answers `--impact`, so no `next:` line.
    const impact = lines.indexOf(`impact of ${SERVICE}:`);

    expect(impact).toBeGreaterThan(start);
    expect(lines[impact + 1]).toBe("  files  src/app/orders/controllers/orders.controller.ts");
    expect(lines.some((line) => line.startsWith("next:"))).toBe(false);
    expect(lines.some((line) => line.startsWith("weak match"))).toBe(false);
  });

  it("uses the module when the file has no owner, and caps the list at 10", () => {
    const many = Array.from({ length: 14 }, (_, index) => ({
      file: `src/app/catalog/controllers/c${index}.controller.ts`,
      owner: null,
      imports: ["src/app/catalog/services/core.service.ts"],
    }));
    const result = search(
      snapshotOf([
        { file: "src/app/catalog/services/core.service.ts", owner: null },
        ...many,
        {
          file: "src/app/orders/x.ts",
          owner: null,
          imports: ["src/app/catalog/services/core.service.ts"],
        },
      ]),
      "core service",
    );

    expect(result.alsoChanges).toHaveLength(10);
    expect(result.alsoChanges?.some((item) => item.file.includes("orders"))).toBe(false);
  });

  it("brings in a flow's step entry files and proving tests", () => {
    const entry = "src/app/catalog/services/fresh.service.ts";
    const flow = {
      id: located("new-arrivals"),
      ref: "catalog/new-arrivals",
      heading: located("New arrivals"),
      summary: null,
      who: located("customer"),
      story: [],
      cases: [],
      criteria: [],
    };
    const result = search(
      snapshotOf(
        [
          {
            file: entry,
            type: "service",
            imports: ["src/app/catalog/repositories/products.repository.ts"],
          },
          { file: "src/app/catalog/repositories/products.repository.ts" },
        ],
        [flow],
        {
          "catalog/new-arrivals": {
            ref: "catalog/new-arrivals",
            steps: [{ entries: [entry] }],
            criteria: [{ tests: [{ file: "src/app/catalog/tests/new-arrivals.test.ts" }] }],
          },
        },
      ),
      "new arrivals",
    );

    expect(result.hits[0]?.id).toBe("catalog/new-arrivals");
    expect(result.alsoChanges?.map((item) => [item.file, item.reason])).toEqual([
      [entry, "step"],
      ["src/app/catalog/repositories/products.repository.ts", "imported-by"],
      ["src/app/catalog/tests/new-arrivals.test.ts", "test"],
    ]);
    expect(result.next).toBe(`warlock scry --impact ${entry}`);
  });
});

describe("search: weak matches", () => {
  const snapshot = snapshotOf([
    {
      file: "src/app/catalog/services/discount.service.ts",
      about: "Applies a discount to the cart total when the customer has a coupon",
    },
    { file: "src/app/catalog/services/price.service.ts" },
  ]);

  it("is true when only body text half-matches and false for a name match", () => {
    const weak = search(snapshot, "coupon invoice refund shipping address validation");

    expect(weak.hits.length).toBeGreaterThan(0);
    expect(weak.weak).toBe(true);
    expect(formatScryResult(weak)).toContain(
      "weak match: no hit holds most of the request's words; use grep for literal text",
    );
    expect(search(snapshot, "discount service").weak).toBe(false);
    expect(search(snapshot, "coupon").weak).toBe(false);
  });
});

describe("search: ranking of specs, locale files and type files", () => {
  it("ranks them below an equal code file", () => {
    const snapshot = snapshotOf([
      { file: "src/app/catalog/a/widget.spec.ts", type: "spec", about: "Widget rules." },
      { file: "src/app/catalog/b/widget.locale.ts", type: "locale", about: "Widget rules." },
      { file: "src/app/catalog/c/widget.type.ts", type: "type", about: "Widget rules." },
      { file: "src/app/catalog/d/widget.service.ts", type: "service", about: "Widget rules." },
    ]);
    const hits = search(snapshot, "rules").hits.map((hit) => hit.id);

    expect(hits[0]).toBe("src/app/catalog/d/widget.service.ts");
    expect(hits).toHaveLength(4);
  });
});
