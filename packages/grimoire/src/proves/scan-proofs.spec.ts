import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { shopFacts, shopRoot } from "../../tests/fixtures/shop-facts";
import { scanProofs, scanProofsInText } from "./scan-proofs";

/** Counts the reads in flight, passing every call through to the real `readFile`. */
const reads = vi.hoisted(() => ({ inFlight: 0, most: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...original,
    readFile: async (...args: Parameters<typeof original.readFile>) => {
      reads.inFlight++;
      reads.most = Math.max(reads.most, reads.inFlight);

      try {
        await new Promise((resolve) => setImmediate(resolve));

        return await original.readFile(...args);
      } finally {
        reads.inFlight--;
      }
    },
  };
});

const FILE = "src/app/catalog/tests/new-arrivals.test.ts";

function codes(text: string): string[] {
  return scanProofsInText(text, FILE).findings.map(
    (finding) => `${finding.code}:${finding.at?.line}`,
  );
}

describe("scanProofsInText", () => {
  it("reads a proof line and the test right under it", () => {
    const text = [
      'describe("new arrivals", () => {',
      "  // @proves catalog/new-arrivals AC-1",
      '  it("lists the newest products first", async () => {});',
      "});",
    ].join("\n");

    expect(scanProofsInText(text, FILE)).toEqual({
      proofs: [
        {
          feature: "catalog",
          flow: "new-arrivals",
          ref: "catalog/new-arrivals",
          criterion: "AC-1",
          test: { name: "lists the newest products first", line: 3 },
          at: { file: FILE, line: 2, column: null },
        },
      ],
      findings: [],
    });
  });

  it("skips blank and comment lines between the proof and the test", () => {
    const text = [
      "// @proves orders/place-order AC-3",
      "",
      "// opens the product page",
      "/* and pays */",
      "test('places an order', () => {});",
    ].join("\r\n");
    const result = scanProofsInText(text, "e2e\\checkout.e2e.ts");

    expect(result.findings).toEqual([]);
    expect(result.proofs[0]?.test).toEqual({ name: "places an order", line: 5 });
    expect(result.proofs[0]?.at.file).toBe("e2e/checkout.e2e.ts");
  });

  it("reads the name after the arguments of each, skipIf and runIf", () => {
    const names = [
      'it.each([[1, 2], [3, 4]])("adds %i", () => {});',
      "test.skipIf(process.env.CI)(`runs locally`, () => {});",
      'it.only("focused", () => {});',
      "it.concurrent.each`\n",
      "it(name, () => {});",
    ].map(
      (line) =>
        scanProofsInText(`// @proves a/b AC-1\n${line}`, FILE).proofs[0]?.test?.name ?? null,
    );

    expect(names).toEqual(["adds %i", "runs locally", "focused", null, null]);
  });

  it("ignores lines inside block comments", () => {
    const text = [
      "/**",
      " * // @proves catalog/new-arrivals AC-9",
      " */",
      'it("x", () => {});',
    ].join("\n");

    expect(scanProofsInText(text, FILE)).toEqual({ proofs: [], findings: [] });
  });

  it("GR4003: a malformed proof line, and a proof after code on the same line", () => {
    expect(codes('// @proves catalog AC-1\nit("x", () => {});')).toEqual(["GR4003:1"]);
    expect(codes('// @proves catalog/new-arrivals AC-1, AC-2\nit("x", () => {});')).toEqual([
      "GR4003:1",
    ]);
    expect(codes('// @proves Catalog/new-arrivals ac-1\nit("x", () => {});')).toEqual(["GR4003:1"]);
    expect(codes('it("x", () => {}); // @proves catalog/new-arrivals AC-1')).toEqual(["GR4003:1"]);
    expect(codes('// @proves catalog/new-arrivals AC-1\nit("x", () => {});')).toEqual([]);
  });

  it("GR4004: a proof line with no test under it", () => {
    const text = [
      "// @proves catalog/new-arrivals AC-1",
      'describe("x", () => {',
      "});",
      "// @proves catalog/new-arrivals AC-2",
    ].join("\n");
    const result = scanProofsInText(text, FILE);

    expect(result.findings.map((finding) => `${finding.code}:${finding.at?.line}`)).toEqual([
      "GR4004:1",
      "GR4004:4",
    ]);
    expect(result.findings[0]?.subject).toMatchObject({
      feature: "catalog",
      flow: "catalog/new-arrivals",
    });
    expect(result.proofs.map((proof) => proof.test)).toEqual([null, null]);
    expect(codes('// @proves catalog/new-arrivals AC-1\nit("x", () => {});')).toEqual([]);
  });

  it("GR4005: one test proving two criteria", () => {
    const text = [
      "// @proves catalog/new-arrivals AC-1",
      "// @proves catalog/new-arrivals AC-2",
      'it("both", () => {});',
    ].join("\n");
    const result = scanProofsInText(text, FILE);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "GR4005",
      severity: "warning",
      message:
        'test "both" proves 2 criteria: catalog/new-arrivals AC-1, catalog/new-arrivals AC-2',
      at: { file: FILE, line: 1 },
    });
    expect(result.proofs.map((proof) => proof.test?.line)).toEqual([3, 3]);
    expect(
      codes(
        '// @proves catalog/new-arrivals AC-1\n// @proves catalog/new-arrivals AC-1\nit("x", () => {});',
      ),
    ).toEqual([]);
  });
});

describe("scanProofs", () => {
  it("reads every test file of the fixture, in file order, and skips missing files", async () => {
    const result = await scanProofs(shopRoot, [...shopFacts.tests, "src/app/gone.test.ts"]);

    expect(result.findings).toEqual([]);
    expect(
      result.proofs.map(
        (proof) =>
          `${proof.at.file}:${proof.at.line} ${proof.ref} ${proof.criterion} @${proof.test?.line}`,
      ),
    ).toEqual([
      "e2e/checkout.e2e.ts:5 orders/place-order AC-3 @6",
      "src/app/catalog/tests/new-arrivals.test.ts:11 catalog/new-arrivals AC-1 @12",
      "src/app/catalog/tests/new-arrivals.test.ts:16 catalog/new-arrivals AC-2 @17",
      "src/app/orders/tests/place-order.test.ts:11 orders/place-order AC-1 @12",
      "src/app/orders/tests/place-order.test.ts:16 orders/place-order AC-2 @17",
    ]);
  });
});

describe("scanProofs on a large suite", () => {
  it("reads every test file with a bounded number of files open at once", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grimoire-proofs-"));

    try {
      const files = Array.from({ length: 400 }, (_, index) => `tests/t${index}.test.ts`);

      mkdirSync(path.join(root, "tests"));

      for (const file of files) {
        writeFileSync(
          path.join(root, ...file.split("/")),
          '// @proves catalog/new-arrivals AC-1\nit("works", () => {});\n',
        );
      }

      reads.most = 0;

      const result = await scanProofs(root, files);

      expect(result.proofs).toHaveLength(400);
      expect(reads.most).toBeGreaterThan(1);
      expect(reads.most).toBeLessThanOrEqual(32);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
