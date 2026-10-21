import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isTranslationKeyUsed,
  readTranslationDeclarations,
  scanTranslationSource,
  translationDeclarationUsage,
  mergeTranslationUsage,
} from "./translation-usage";
import { analyzePageTranslationUsage, resolveSourceImport } from "./translation-usage-graph";

describe("scanTranslationSource", () => {
  it("resolves literal keys from trans, t and transX calls", () => {
    const { usage } = scanTranslationSource(
      "src/web/members/page.tsx",
      `import { trans } from "@mongez/localization";
       const label = trans("members.title");
       const short = t("common.save");
       transX("common.cancel");`,
    );

    expect(usage.dynamic).toBe(false);
    expect(usage.keys).toEqual(
      expect.arrayContaining(["members.title", "common.save", "common.cancel"]),
    );
  });

  it("reads the key argument of transFrom at index one", () => {
    const { usage } = scanTranslationSource(
      "src/web/a.tsx",
      `const value = transFrom("en", "app.title");`,
    );

    expect(usage.keys).toEqual(["app.title"]);
    expect(usage.dynamic).toBe(false);
  });

  it("treats a static-prefix template as its whole subtree", () => {
    const { usage } = scanTranslationSource(
      "src/web/orders.tsx",
      "const label = trans(`statuses.${order.status}`);",
    );

    expect(usage.prefixes).toEqual(["statuses."]);
    expect(isTranslationKeyUsed(usage, "statuses.paid")).toBe(true);
    expect(isTranslationKeyUsed(usage, "statuses.paid.short")).toBe(true);
    expect(isTranslationKeyUsed(usage, "members.title")).toBe(false);
  });

  it("resolves identifiers bound to module-level string constants and literal choices", () => {
    const { usage } = scanTranslationSource(
      "src/web/a.tsx",
      `const TITLE = "members.title";
       const label = trans(TITLE);
       const pick = trans(isOpen ? "a.open" : "a.closed");`,
    );

    expect(usage.dynamic).toBe(false);
    expect(usage.keys).toEqual(expect.arrayContaining(["members.title", "a.open", "a.closed"]));
  });

  it("marks a lookup with no static prefix as dynamic and records where it is", () => {
    const { usage } = scanTranslationSource("src/web/a.tsx", "export const label = trans(key);");

    expect(usage.dynamic).toBe(true);
    expect(usage.dynamicSites).toEqual([
      expect.objectContaining({ file: "src/web/a.tsx", line: 1, text: "key" }),
    ]);
  });

  it("marks a template without a static prefix as dynamic", () => {
    const { usage } = scanTranslationSource("src/web/a.tsx", "trans(`${area}.title`);");

    expect(usage.dynamic).toBe(true);
  });

  it("follows a useTrans() binding under any local name", () => {
    const { usage } = scanTranslationSource(
      "src/web/a.tsx",
      `import { useTrans as useT } from "@warlock.js/web";
       export function Page() {
         const translate = useT();
         return <p>{translate("members.title")}</p>;
       }`,
    );

    expect(usage.dynamic).toBe(false);
    expect(usage.keys).toEqual(["members.title"]);
  });

  it("treats a translator passed on as a value as dynamic", () => {
    const { usage } = scanTranslationSource(
      "src/web/a.tsx",
      `export function Page() {
         const t = useTrans();
         return <Field label={t} />;
       }`,
    );

    expect(usage.dynamic).toBe(true);
  });

  it("ignores inline translation objects, which carry their own text", () => {
    const { usage } = scanTranslationSource(
      "src/web/a.tsx",
      `const label = trans({ en: "Save", ar: "حفظ" });`,
    );

    expect(usage.dynamic).toBe(false);
    expect(usage.keys).toEqual([]);
  });

  it("collects value imports and dynamic imports but not type-only imports", () => {
    const { imports } = scanTranslationSource(
      "src/web/a.tsx",
      `import type { Props } from "./props";
       import { Card } from "./card";
       export * from "./barrel";
       const lazy = import("./lazy");`,
    );

    expect(imports).toEqual(expect.arrayContaining(["./card", "./barrel", "./lazy"]));
    expect(imports).not.toContain("./props");
  });
});

describe("config.translations declarations", () => {
  it("reads string entries from the setup file's config object", () => {
    const entries = readTranslationDeclarations(
      "src/web/orders/page.setup.ts",
      `export const config = { route: "/orders", translations: ["statuses.*", "members"] };`,
    );

    expect(entries).toEqual(["statuses.*", "members"]);
  });

  it("returns undefined when the setup file declares none", () => {
    expect(
      readTranslationDeclarations("src/web/a.setup.ts", `export const config = { route: "/a" };`),
    ).toBeUndefined();
  });

  it("refuses a non-literal declaration instead of guessing", () => {
    expect(() =>
      readTranslationDeclarations(
        "src/web/a.setup.ts",
        `export const config = { translations: buildKeys() };`,
      ),
    ).toThrow(/array of string literals/);
  });

  it("maps a prefix, a group and the wildcard onto usage", () => {
    expect(translationDeclarationUsage("statuses.*", "a.setup.ts").prefixes).toEqual(["statuses."]);
    expect(translationDeclarationUsage("members", "a.setup.ts").keys).toEqual(["members"]);
    expect(translationDeclarationUsage("*", "a.setup.ts").prefixes).toEqual([""]);
  });

  it("refuses a wildcard that is not a final .*", () => {
    expect(() => translationDeclarationUsage("sta*s", "a.setup.ts")).toThrow(/only as the final/);
  });

  it("merges declared usage with dynamic lookups", () => {
    const merged = mergeTranslationUsage([
      translationDeclarationUsage("members", "a.setup.ts"),
      scanTranslationSource("src/web/a.tsx", "trans(key)").usage,
    ]);

    expect(merged.dynamic).toBe(true);
    expect(merged.keys).toEqual(["members"]);
  });
});

describe("analyzePageTranslationUsage", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-translation-usage-"));
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text, "utf8");
    };

    write(
      "src/web/layout.tsx",
      `import { Badge } from "web/components/badge";\nexport const x = trans("app.brand");`,
    );
    write(
      "src/web/components/badge.tsx",
      `export function Badge() { return <i>{trans("common.new")}</i>; }`,
    );
    write(
      "src/web/orders/page.tsx",
      `import "../layout";\nexport default function P() { return trans(\`statuses.\${s}\`); }`,
    );
    write("src/web/orders/page.setup.ts", `export const config = { translations: ["members"] };`);
    write(
      "src/web/dynamic/page.tsx",
      `import { lookup } from "./lookup";\nexport default function D() { return lookup(); }`,
    );
    write("src/web/dynamic/lookup.ts", `export function lookup() { return trans(key); }`);
    write("src/web/broken/page.tsx", `import "./missing";\nexport default function B() {}`);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("unions the keys reachable from the page, its layout and imported components", () => {
    const { usage } = analyzePageTranslationUsage({
      appSrcRoot: path.join(root, "src"),
      entries: [path.join(root, "src/web/orders/page.tsx"), path.join(root, "src/web/layout.tsx")],
      setupFiles: [path.join(root, "src/web/orders/page.setup.ts")],
    });

    expect(usage.dynamic).toBe(false);
    expect(usage.keys).toEqual(expect.arrayContaining(["app.brand", "common.new", "members"]));
    expect(usage.prefixes).toEqual(["statuses."]);
  });

  it("follows an import into a dynamic lookup, and makes the page dynamic", () => {
    const { usage } = analyzePageTranslationUsage({
      appSrcRoot: path.join(root, "src"),
      entries: [path.join(root, "src/web/dynamic/page.tsx")],
    });

    expect(usage.dynamic).toBe(true);
  });

  it("skips an unresolvable relative import, which the bundler reports on its own", () => {
    const { usage } = analyzePageTranslationUsage({
      appSrcRoot: path.join(root, "src"),
      entries: [path.join(root, "src/web/broken/page.tsx")],
    });

    expect(usage.dynamic).toBe(false);
    expect(
      resolveSourceImport(
        "./missing",
        path.join(root, "src/web/broken/page.tsx"),
        path.join(root, "src"),
      ),
    ).toBeUndefined();
  });

  it("does not walk non-code imports such as JSON", () => {
    expect(
      resolveSourceImport("./data.json", path.join(root, "src/web/a.tsx"), path.join(root, "src")),
    ).toBeUndefined();
  });
});
