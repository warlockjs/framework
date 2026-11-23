import { describe, expect, it } from "vitest";
import { runCodeRules } from "./index";
import { findFocusedTests } from "./focused";
import { isGenericError } from "./specific-errors";

const lines = (file: string, text: string, rules?: Parameters<typeof runCodeRules>[2]) =>
  runCodeRules(file, text, rules).map((finding) => `${finding.code}:${finding.line}`);

describe("logical-css", () => {
  it("flags physical Tailwind classes, with variants and negatives", () => {
    const text = [
      'const a = "flex ml-4 text-sm";',
      'const b = "md:pr-2";',
      'const c = "-mr-2 mt-1";',
      'const d = "hover:text-left";',
      'const e = "rounded-l-lg border-r-2 left-0 -right-1";',
    ].join("\n");

    expect(lines("src/a.tsx", text)).toEqual([
      "GR3007:1",
      "GR3007:2",
      "GR3007:3",
      "GR3007:4",
      "GR3007:5",
      "GR3007:5",
      "GR3007:5",
      "GR3007:5",
    ]);
  });

  it("passes logical classes and prose that merely contains a direction", () => {
    const text = [
      'const a = "ms-4 me-2 ps-1 pe-1 text-start text-end start-0 end-1 rounded-s-lg border-e";',
      'const b = "turn left-handed screws to the right";',
      'const c = "ml mr left right";',
    ].join("\n");

    expect(lines("src/a.tsx", text)).toEqual([]);
  });

  it("reads CSS declarations", () => {
    const css = [
      ".a { margin-left: 4px; }",
      ".b { margin-inline-start: 4px; }",
      ".c { text-align: left; }",
      ".d { text-align: start; }",
      ".e { float: right; }",
      ".f { left: 0; }",
      ".g { inset-inline-start: 0; }",
      ".h { border-top-left-radius: 2px; }",
      "/* margin-right: 1px */",
    ].join("\n");

    expect(lines("src/a.css", css)).toEqual([
      "GR3007:1",
      "GR3007:3",
      "GR3007:5",
      "GR3007:6",
      "GR3007:8",
    ]);
  });

  it("flags inline style keys and values", () => {
    const text = [
      "const a = { marginLeft: 4 };",
      "const b = { textAlign: 'left' };",
      "const c = { left: 0 };",
      "const d = { left: node, right: null };",
      "const e = { marginInlineStart: 4 };",
    ].join("\n");

    expect(lines("src/a.tsx", text)).toEqual(["GR3007:1", "GR3007:2", "GR3007:3"]);
  });

  it("flags CSS written inside a string", () => {
    expect(lines("src/a.tsx", 'const s = "margin-left: 4px";')).toEqual(["GR3007:1"]);
  });
});

describe("specific-errors", () => {
  it("flags generic English and Arabic phrases, with punctuation and advice", () => {
    const text = [
      'toast("Something went wrong");',
      'toast("Something went wrong. Please try again.");',
      'toast("An unexpected error occurred");',
      'toast("حدث خطأ ما");',
      'toast("Could not reach the server, check your connection");',
      'toast("تعذر الوصول إلى الخادم، تحقق من اتصالك");',
      'const level = "error";',
    ].join("\n");

    expect(lines("src/a.ts", text, ["specific-errors"])).toEqual([
      "GR3008:1",
      "GR3008:2",
      "GR3008:3",
      "GR3008:4",
    ]);
  });

  it("flags short words only as locale values", () => {
    const json = '{ "error": "Error", "oops": "Oops!", "title": "Orders" }';

    expect(lines("src/locales/en.json", json)).toEqual(["GR3008:1", "GR3008:1"]);
    expect(isGenericError("Error", false)).toBe(false);
    expect(isGenericError("Error", true)).toBe(true);
  });

  it("ignores source that is not a locale JSON", () => {
    expect(lines("package.json", '{ "a": "Something went wrong" }')).toEqual([]);
  });
});

describe("type-discriminator", () => {
  it("flags kind as a key with a string literal or a union of them", () => {
    const text = [
      'type A = { kind: "a" };',
      'type B = { kind?: "a" | "b" };',
      'const c = { kind: "c" };',
      "interface D {",
      '  readonly kind: "d";',
      "}",
    ].join("\n");

    expect(lines("src/a.ts", text)).toEqual(["GR3009:1", "GR3009:2", "GR3009:3", "GR3009:5"]);
  });

  it("passes a variable named kind and a ternary", () => {
    const text = [
      "const kind = 1;",
      'const x = ok ? kind : "other";',
      "type E = { kind: string };",
      "const y = item.kind;",
      'const type = { type: "a" };',
    ].join("\n");

    expect(lines("src/a.ts", text)).toEqual([]);
  });
});

describe("no-js-imports", () => {
  it("flags relative specifiers that end in a JavaScript extension", () => {
    const text = [
      'import { a } from "./x.js";',
      'export * from "../y.mjs";',
      'const z = await import("./z.cjs");',
      'import "./side.jsx";',
      'import { b } from "./x";',
      'import { c } from "pkg/file.js";',
      'const s = "./not-an-import.js";',
    ].join("\n");

    expect(lines("src/a.ts", text)).toEqual(["GR3010:1", "GR3010:2", "GR3010:3", "GR3010:4"]);
  });
});

describe("the escape comment", () => {
  it("allows a rule on its own line and on the line below", () => {
    const text = [
      'const a = "ml-4"; // grimoire-allow logical-css: legacy widget',
      "// grimoire-allow logical-css: pixel-exact mock",
      'const b = "mr-2";',
      'const c = "ml-1";',
      "// grimoire-allow specific-errors: wrong rule",
      'const d = "pl-1";',
    ].join("\n");

    expect(lines("src/a.tsx", text)).toEqual(["GR3007:4", "GR3007:6"]);
  });

  it("needs a reason", () => {
    expect(lines("src/a.tsx", 'const a = "ml-4"; // grimoire-allow logical-css:')).toEqual([
      "GR3007:1",
    ]);
  });
});

describe("scanning", () => {
  it("ignores comments, template literals expressions and specs", () => {
    const text = [
      '/* import x from "./a.js"; */',
      "// kind: 'a'",
      "const t = `ml-4 ${value} ${other ? 'pr-2' : ''}`;",
    ].join("\n");

    expect(lines("src/a.tsx", text)).toEqual(["GR3007:3", "GR3007:3"]);
    expect(lines("src/a.spec.ts", 'const a = "ml-4";')).toEqual([]);
    expect(lines("node_modules/x/a.ts", 'const a = "ml-4";')).toEqual([]);
  });

  it("limits the rules it runs", () => {
    expect(
      lines("src/a.tsx", 'import a from "./a.js"; const x = "ml-4";', ["no-js-imports"]),
    ).toEqual(["GR3010:1"]);
    expect(lines("src/a.tsx", 'const x = "ml-4";', [])).toEqual([]);
  });
});

describe("findFocusedTests", () => {
  it("finds .only and .skip, not .skipIf, comments or strings", () => {
    const text = [
      'it.only("a", () => {});',
      'describe.only("b", () => {});',
      'test.skip("c", () => {});',
      'it.skipIf(isWindows)("d", () => {});',
      '/* it.only("e") */',
      'const s = "it.only(";',
      'it.concurrent.skip("f", () => {});',
    ].join("\n");

    expect(findFocusedTests(text).map((hit) => `${hit.type}:${hit.line}`)).toEqual([
      "only:1",
      "only:2",
      "skip:3",
      "skip:7",
    ]);
  });
});
