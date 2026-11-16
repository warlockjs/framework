/**
 * The pipeline's composition, with the parser, the book, the proof scanner
 * and the results reader replaced by fakes. The golden spec over the fixture
 * (`tests/bookmaps.golden.spec.ts`) runs the real modules.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookAdapter, LoadedBook } from "../contracts";
import { codeFile, facts, feature, step, written } from "../../tests/support/written-model";
import { openGrimoire } from "./index";

const fakes = vi.hoisted(() => ({
  calls: [] as string[],
  buildOptions: [] as unknown[],
  written: null as unknown,
  book: null as unknown,
}));

vi.mock("../written", () => ({
  parseGrimoire: async () => {
    fakes.calls.push("parseGrimoire");
    return { written: fakes.written, findings: [{ code: "GR1007" }] };
  },
}));

vi.mock("../book", () => ({
  buildBook: async (_root: string, _adapter: BookAdapter, options: unknown) => {
    fakes.calls.push("buildBook");
    fakes.buildOptions.push(options);
    return { book: fakes.book, rebuilt: true, changed: [] };
  },
  writeBook: async () => {
    fakes.calls.push("writeBook");
    return { written: [], removed: [] };
  },
}));

vi.mock("../proves", () => ({
  scanProofs: async (_root: string, tests: readonly string[]) => {
    fakes.calls.push(`scanProofs:${tests.join(",")}`);
    return { proofs: [], findings: [{ code: "GR4004" }] };
  },
}));

vi.mock("../test-results", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../test-results")>()),
  readTestResults: async () => {
    fakes.calls.push("readTestResults");
    return null;
  },
}));

vi.mock("../bookmap", async (importOriginal) => {
  const original = await importOriginal<typeof import("../bookmap")>();

  return {
    ...original,
    writeCollectedFiles: async (...args: Parameters<typeof original.writeCollectedFiles>) => {
      fakes.calls.push("writeCollectedFiles");
      return original.writeCollectedFiles(...args);
    },
  };
});

let root: string;
const adapter = { name: "fake", version: "1.0.0" } as BookAdapter;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "grimoire-open-"));
  fakes.calls = [];
  fakes.buildOptions = [];
  fakes.written = written({
    features: [
      feature({
        id: "catalog",
        folders: ["src/app/catalog"],
        flows: [{ id: "browse", steps: [step(1, "route", "GET /api/products")] }],
      }),
    ],
  });

  const bookFacts = facts(
    [
      codeFile("src/app/catalog/routes.ts", ["src/app/catalog/list.controller.ts"], {
        type: "routes",
      }),
      codeFile("src/app/catalog/list.controller.ts"),
    ],
    {
      routes: [
        {
          method: "GET",
          path: "/api/products",
          name: null,
          sourceFile: "src/app/catalog/routes.ts",
          handler: "h",
          controller: null,
          action: null,
          handlerFile: "src/app/catalog/list.controller.ts",
          middleware: [],
          auth: { required: false, userTypes: [] },
          isPage: false,
          description: null,
        },
      ],
      tests: [
        "src/app/catalog/a.test.ts",
        "src/app/catalog/b.test.ts",
        "src/app/catalog/gone.test.ts",
      ],
    },
  );
  const book: Pick<LoadedBook, "root" | "facts" | "routes"> & {
    manifest: { tests: Record<string, string> };
  } = {
    root,
    facts: bookFacts,
    routes: "cached",
    manifest: { tests: { "src/app/catalog/a.test.ts": "from-manifest" } },
  };

  fakes.book = book;
  mkdirSync(path.join(root, "src/app/catalog"), { recursive: true });
  writeFileSync(path.join(root, "src/app/catalog/b.test.ts"), "test");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("openGrimoire", () => {
  it("runs the pipeline in order and writes the book and the collected files", async () => {
    const snapshot = await openGrimoire(root, adapter, { routes: "fresh", force: true });

    expect(fakes.calls).toEqual([
      "parseGrimoire",
      "buildBook",
      "scanProofs:src/app/catalog/a.test.ts,src/app/catalog/b.test.ts,src/app/catalog/gone.test.ts",
      "readTestResults",
      "writeBook",
      "writeCollectedFiles",
    ]);
    expect(fakes.buildOptions).toEqual([{ routes: "fresh", force: true }]);
    expect(snapshot.structure).toEqual([{ code: "GR1007" }]);
    expect(snapshot.proofFindings).toEqual([{ code: "GR4004" }]);
    expect(snapshot.routes).toBe("cached");
    expect(snapshot.ownership.files["src/app/catalog/routes.ts"]?.owner).toBe("catalog");
    expect(snapshot.collected.flows["catalog/browse"]?.steps[0]?.files).toEqual([
      "src/app/catalog/list.controller.ts",
      "src/app/catalog/routes.ts",
    ]);
    expect(snapshot.annotations.files["src/app/catalog/routes.ts"]?.flows).toEqual([
      "catalog/browse",
    ]);
  });

  it("takes test hashes from the manifest, else hashes the file, and leaves out a missing file", async () => {
    const snapshot = await openGrimoire(root, adapter);

    expect(snapshot.annotations.tests).toEqual({
      "src/app/catalog/a.test.ts": "from-manifest",
      // sha256 of "test"
      "src/app/catalog/b.test.ts":
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    });
  });

  it("defaults to cached routes", async () => {
    await openGrimoire(root, adapter);

    expect(fakes.buildOptions).toEqual([{ routes: "cached" }]);
  });

  it("writes nothing with write: false and asks the book not to write", async () => {
    const snapshot = await openGrimoire(root, adapter, { write: false });

    expect(fakes.calls).not.toContain("writeBook");
    expect(fakes.calls).not.toContain("writeCollectedFiles");
    expect(fakes.buildOptions).toEqual([{ routes: "cached", write: false }]);
    expect(snapshot.collected.features.catalog?.own).toEqual([
      "src/app/catalog/list.controller.ts",
      "src/app/catalog/routes.ts",
    ]);
  });
});
