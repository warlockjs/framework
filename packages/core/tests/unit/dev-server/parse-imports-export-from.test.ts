import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearFileExistsCache, parseImports } from "../../../src/dev-server/parse-imports";

/**
 * End-to-end coverage for the `export ... from "m"` edge classifier
 * (`isExportTypeOnlyStatement`, exercised through `parseImports`). This pins the
 * behaviour its docblock claims: an inline `export { type X, type Y } from`
 * list is a TYPE-ONLY edge, while any runtime specifier makes the edge runtime.
 *
 * `parseImports` resolves relative paths against the importing file on disk, so
 * each case writes a real barrel + target module into a temp dir.
 * Source: core/src/dev-server/parse-imports.ts (isExportTypeOnlyStatement).
 *
 * NOTE: this is the EDGE classifier (drives cycle detection), distinct from the
 * file-level `isTypeOnlyFile` heuristic — see parse-imports-type-only.test.ts.
 */
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "warlock-parse-export-"));
  clearFileExistsCache();
});

afterEach(async () => {
  clearFileExistsCache();
  await rm(dir, { recursive: true, force: true });
});

async function parseBarrel(barrelSource: string): Promise<Map<string, { isTypeOnly: boolean }>> {
  const barrelPath = path.join(dir, "barrel.ts");
  const targetPath = path.join(dir, "models.ts");

  await writeFile(
    targetPath,
    "export const createUser = () => {};\nexport type User = { id: number };\n",
  );
  await writeFile(barrelPath, barrelSource);

  return parseImports(barrelSource, barrelPath);
}

describe("parseImports — export-from edge type-only classification", () => {
  it("flags an inline `export { type X } from` list as a type-only edge", async () => {
    const edge = (await parseBarrel(`export { type User } from "./models";`)).get("./models");

    expect(edge?.isTypeOnly).toBe(true);
  });

  it("flags `export { runtime } from` as a runtime edge", async () => {
    const edge = (await parseBarrel(`export { createUser } from "./models";`)).get("./models");

    expect(edge?.isTypeOnly).toBe(false);
  });

  it("flags a mixed list with one runtime specifier as a runtime edge", async () => {
    const edge = (await parseBarrel(`export { type User, createUser } from "./models";`)).get(
      "./models",
    );

    expect(edge?.isTypeOnly).toBe(false);
  });

  it("flags `export * from` as a runtime edge (re-exports everything)", async () => {
    const edge = (await parseBarrel(`export * from "./models";`)).get("./models");

    expect(edge?.isTypeOnly).toBe(false);
  });

  // A pure `export type { X } from "..."` is fully type-erased: es-module-lexer
  // does not report it as an import specifier, so NO dependency edge is tracked
  // at all. That is the correct outcome for cycle detection (the edge vanishes
  // at compile time) — `isExportTypeOnlyStatement` never sees this form because
  // the lexer omits it upstream.
  it("does not track an edge for a pure `export type { X } from` re-export", async () => {
    const map = await parseBarrel(`export type { User } from "./models";`);

    expect(map.has("./models")).toBe(false);
  });
});
