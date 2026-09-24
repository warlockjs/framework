import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearFileExistsCache, parseImports } from "./parse-imports";
import { Path } from "../utils/normalized-path";

/**
 * Root cause of finding 60721e35: `cachedFileExists` used to cache negative
 * (does-not-exist) results for the whole process lifetime, cleared only on a
 * multi-file watcher batch. So the classic "add a new controller/route" flow —
 * a `routes.ts` that imports a file which does not exist at first probe, then
 * the file is created — kept resolving the import to nothing: the dependency
 * edge never formed and the route module import failed, so the new route 404'd
 * until an unrelated multi-file batch happened to clear the cache ("needs a
 * second edit").
 *
 * The behavior asserted here is resolution correctness across a file's
 * creation, without any cache clear — not timing. A stale negative cache makes
 * the second `parseImports` still resolve nothing; a correct cache resolves the
 * now-existing file.
 */
describe("parseImports — a newly-created import target resolves without a cache clear (60721e35)", () => {
  let root: string;

  beforeEach(() => {
    // Isolate from any negative entries other suites seeded into the shared cache.
    clearFileExistsCache();
    root = mkdtempSync(path.join(tmpdir(), "warlock-parse-imports-"));
  });

  afterEach(() => {
    clearFileExistsCache();
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves an import once its target file is created, with no clearFileExistsCache in between", async () => {
    const routesFile = path.join(root, "routes.ts");
    const controllerFile = path.join(root, "create-user.ts");

    const source = `import { createUser } from "./create-user";\nrouter.post("/users", createUser);\n`;

    // First probe: the controller does not exist yet, so the import is
    // unresolved. In the buggy version this caches "create-user does not exist".
    const before = await parseImports(source, routesFile);
    expect(before.has("./create-user")).toBe(false);

    // The developer now creates the controller file.
    mkdirSync(path.dirname(controllerFile), { recursive: true });
    writeFileSync(controllerFile, `export function createUser() {}\n`);

    // Re-parse WITHOUT clearing the cache — this is what happens when the
    // controller's add event reprocesses the routes file that imports it.
    const after = await parseImports(source, routesFile);

    expect(after.has("./create-user")).toBe(true);
    expect(Path.toRelative(after.get("./create-user")!.absolutePath)).toBe(
      Path.toRelative(controllerFile),
    );
  });
});

describe("parseImports — NodeNext .js specifier resolves to the .ts source (C2:B2)", () => {
  let root: string;

  beforeEach(() => {
    clearFileExistsCache();
    root = mkdtempSync(path.join(tmpdir(), "warlock-parse-imports-js-"));
  });

  afterEach(() => {
    clearFileExistsCache();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps the dependency edge for `./x.js` when only x.ts exists", async () => {
    writeFileSync(path.join(root, "x.ts"), `export const x = 1;\n`);

    const result = await parseImports(`import { x } from "./x.js";\n`, path.join(root, "a.ts"));

    expect(result.has("./x.js")).toBe(true);
    expect(Path.toRelative(result.get("./x.js")!.absolutePath)).toBe(
      Path.toRelative(path.join(root, "x.ts")),
    );
  });
});
