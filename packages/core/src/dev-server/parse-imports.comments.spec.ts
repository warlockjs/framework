import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Path } from "../utils/normalized-path";
import { clearFileExistsCache, parseImports, stripComments } from "./parse-imports";

/**
 * FW-13: a file with no real imports fell through to the regex fallback, which
 * scanned comments too. A doc comment showing `(await import("./query-testing"))`
 * resolved to the file itself, and the dependency graph reported a one-file
 * "circular dependency".
 */
describe("parseImports — comments and self edges (FW-13)", () => {
  let root: string;

  beforeEach(() => {
    clearFileExistsCache();
    root = mkdtempSync(path.join(tmpdir(), "warlock-parse-imports-fw13-"));
  });

  afterEach(() => {
    clearFileExistsCache();
    rmSync(root, { recursive: true, force: true });
  });

  function file(name: string, contents = "export {};\n") {
    const absolutePath = path.join(root, name);
    writeFileSync(absolutePath, contents);
    return absolutePath;
  }

  it("ignores an import() inside a doc comment of a file with no imports", async () => {
    const source = [
      "/**",
      " * Usage:",
      ' *   (await import("./query-testing")).queryParamModuleMock(),',
      " */",
      "export function queryParamModuleMock() {",
      "  return {};",
      "}",
      "",
    ].join("\n");
    const filePath = file("query-testing.ts", source);

    const imports = await parseImports(source, filePath);

    expect(imports.size).toBe(0);
  });

  it("ignores imports in line and block comments on the regex path", async () => {
    file("other.ts");
    const source = [
      '// import { a } from "./other";',
      '/* export * from "./other"; */',
      "export type Local = string;",
      "",
    ].join("\n");

    const imports = await parseImports(source, file("commented.ts", source));

    expect(imports.size).toBe(0);
  });

  it("adds no edge for a pure type re-export, on the fallback path as on the lexer path", async () => {
    file("types.ts", "export type A = string;\n");
    const typeOnly = 'export type { A } from "./types";\nexport type * from "./types";\n';
    // The lexer path: a runtime import makes the lexer succeed, and it never
    // reports `export type ... from`. The fallback must agree with it.
    file("runtime.ts");
    const withRuntime = 'import { r } from "./runtime";\n' + typeOnly + "export const x = r;\n";

    const fallback = await parseImports(typeOnly, file("barrel.ts", typeOnly));
    const lexer = await parseImports(withRuntime, file("mixed-barrel.ts", withRuntime));

    expect(fallback.has("./types")).toBe(false);
    expect(lexer.has("./types")).toBe(false);
    expect(lexer.has("./runtime")).toBe(true);
  });

  it("tracks `export * as ns from` as a runtime edge", async () => {
    const target = file("utils.ts", "export const u = 1;\n");
    const source = 'export * as utils from "./utils";\n';

    const imports = await parseImports(source, file("ns-barrel.ts", source));

    expect(Path.toRelative(imports.get("./utils")!.absolutePath)).toBe(Path.toRelative(target));
    expect(imports.get("./utils")?.isTypeOnly).toBe(false);
  });

  it("drops a real self import, which is no dependency edge", async () => {
    const source = 'import { self } from "./self";\nexport const self = 1;\n';

    const imports = await parseImports(source, file("self.ts", source));

    expect(imports.has("./self")).toBe(false);
  });

  it("keeps a real import next to a commented one", async () => {
    const target = file("real.ts");
    const source = [
      '/** (await import("./commented")) */',
      'import { real } from "./real";',
      "export const value = real;",
      "",
    ].join("\n");

    const imports = await parseImports(source, file("mixed.ts", source));

    expect([...imports.keys()]).toEqual(["./real"]);
    expect(Path.toRelative(imports.get("./real")!.absolutePath)).toBe(Path.toRelative(target));
  });

  it("keeps imports after a regex literal containing /* in a .tsx file the lexer rejects", async () => {
    const page = file("page.tsx");
    const helper = file("helper.ts");
    const source = [
      'export const clean = (p: string) => p.replace(/\\/*$/, "");',
      "export function A() { return <div>Don't stop</div>; }",
      'export const Page = lazy(() => import("./page"));',
      'export { helper } from "./helper";',
      "/** done */",
      "",
    ].join("\n");

    const imports = await parseImports(source, file("screen.tsx", source));

    expect([...imports.keys()].sort()).toEqual(["./helper", "./page"]);
    expect(Path.toRelative(imports.get("./page")!.absolutePath)).toBe(Path.toRelative(page));
    expect(Path.toRelative(imports.get("./helper")!.absolutePath)).toBe(Path.toRelative(helper));
  });
});

describe("stripComments", () => {
  it("removes line and block comments but keeps newlines", () => {
    expect(stripComments('a; // import("./x")\nb;')).toBe("a; \nb;");
    expect(stripComments('a;\n/**\n * import("./x")\n */\nb;')).toBe("a;\n\n\n\nb;");
  });

  it("leaves comment markers inside strings and templates alone", () => {
    const source = 'const url = "http://x/*y"; const t = `a // b`; import("./real");';

    expect(stripComments(source)).toBe(source);
  });

  it("keeps regex literals that contain comment markers", () => {
    const source = 'const a = p.replace(/\\/*$/, ""); const b = /[/*]/; import("./x");';

    expect(stripComments(source, "file.ts")).toBe(source);
  });

  it("keeps // inside JSX text and strips the comments around it", () => {
    const source = "const el = <p>http://x // not a comment</p>; // real\nnext();";

    expect(stripComments(source, "file.tsx")).toBe(
      "const el = <p>http://x // not a comment</p>; \nnext();",
    );
  });

  it("strips comments next to template literals with interpolated comment markers", () => {
    const source = 'const t = `a ${"/*"} b`; /* block */ x; // end';

    expect(stripComments(source, "file.ts")).toBe('const t = `a ${"/*"} b`;  x; ');
  });

  it("respects escaped quotes inside strings", () => {
    const source = 'const s = "it\\"s // not a comment"; import x from "./x";';

    expect(stripComments(source)).toBe(source);
  });
});
