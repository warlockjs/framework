import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConventions, readConventionOptions } from "./conventions-step";
import {
  configuredLocaleCodes,
  localeCoverageProblems,
  moduleLocaleFiles,
} from "./locale-conventions";

let root: string;

function write(relative: string, source: string): void {
  const file = path.join(root, relative);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-locale-check-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("configuredLocaleCodes", () => {
  it("reads localeCodes from src/config/app.ts", () => {
    write("src/config/app.ts", 'export default { localeCode: "en", localeCodes: ["en", \'ar\'] };\n');

    expect(configuredLocaleCodes(root)).toEqual(["en", "ar"]);
  });

  it("prefers localeCodes from .warlock-check.json", () => {
    write("src/config/app.ts", 'export default { localeCodes: ["en", "ar"] };\n');

    expect(configuredLocaleCodes(root, ["en", "fr"])).toEqual(["en", "fr"]);
  });

  it("is undefined when nothing names the locales", () => {
    write("src/config/app.ts", 'export default { localeCode: "en" };\n');

    expect(configuredLocaleCodes(root)).toBeUndefined();
    expect(configuredLocaleCodes(path.join(root, "missing"))).toBeUndefined();
  });
});

describe("moduleLocaleFiles", () => {
  it("lists locales.json and locales/<feature>.json of every module, sorted", () => {
    write("src/app/orders/utils/locales.json", "{}");
    write("src/app/orders/utils/locales/refunds.json", "{}");
    write("src/app/users/utils/locales.json", "{}");
    write("src/app/users/utils/locales/nested/deep.json", "{}");
    write("src/app/users/data/seed.json", "[]");

    expect(moduleLocaleFiles(root)).toEqual([
      "src/app/orders/utils/locales.json",
      "src/app/orders/utils/locales/refunds.json",
      "src/app/users/utils/locales.json",
    ]);
  });
});

describe("WL9105 translation key missing a configured locale", () => {
  it("names the file, the key and the missing locale, in locales.json and feature files", () => {
    write(
      "src/app/orders/utils/locales.json",
      JSON.stringify({ title: { en: "Orders", ar: "Orders (ar)" }, empty: { en: "None" } }),
    );
    write(
      "src/app/orders/utils/locales/refunds.json",
      JSON.stringify({ refunded: { ar: "Refunded (ar)" } }),
    );

    const problems = localeCoverageProblems(root, ["en", "ar"]);

    expect(problems.map((problem) => [problem.code, problem.file, problem.severity])).toEqual([
      ["WL9105", "src/app/orders/utils/locales.json", "error"],
      ["WL9105", "src/app/orders/utils/locales/refunds.json", "error"],
    ]);
    expect(problems[0]?.message).toContain('"orders.empty"');
    expect(problems[0]?.message).toContain("ar");
    expect(problems[1]?.message).toContain('"orders.refunded"');
    expect(problems[1]?.message).toContain("en");
  });

  it("covers nested keys and an explicit $group", () => {
    write(
      "src/app/orders/utils/locales.json",
      JSON.stringify({ $group: "shop", errors: { missing: { en: "Missing" } } }),
    );

    const [problem] = localeCoverageProblems(root, ["en", "ar"]);

    expect(problem?.message).toContain('"shop.errors.missing"');
  });

  it("is silent when every key is complete or no locales are configured", () => {
    write("src/app/orders/utils/locales.json", JSON.stringify({ title: { en: "Orders" } }));

    expect(localeCoverageProblems(root, ["en"])).toEqual([]);
    expect(localeCoverageProblems(root, undefined)).toEqual([]);
    expect(localeCoverageProblems(root, [])).toEqual([]);
  });

  it("reports a dictionary that cannot be parsed with the parser's own message", () => {
    write("src/app/orders/utils/locales.json", '{ "title": "not a locale object" }');

    const [problem] = localeCoverageProblems(root, ["en"]);

    expect(problem).toMatchObject({ code: "WL1007", file: "src/app/orders/utils/locales.json" });
  });

  it("runs as part of the conventions step and honours rule overrides", () => {
    write("src/config/app.ts", 'export default { localeCodes: ["en", "ar"] };\n');
    write("src/app/orders/utils/locales.json", JSON.stringify({ title: { en: "Orders" } }));

    expect(runConventions(root, []).map((problem) => problem.code)).toEqual(["WL9105"]);

    write(".warlock-check.json", JSON.stringify({ rules: { WL9105: "warning" } }));

    expect(runConventions(root, []).map((problem) => problem.severity)).toEqual(["warning"]);

    write(".warlock-check.json", JSON.stringify({ rules: { WL9105: "off" } }));

    expect(runConventions(root, [])).toEqual([]);
  });

  it("reads localeCodes from .warlock-check.json", () => {
    write(".warlock-check.json", JSON.stringify({ localeCodes: ["en", "fr"] }));
    write("src/app/orders/utils/locales.json", JSON.stringify({ title: { en: "Orders" } }));

    expect(readConventionOptions(root).localeCodes).toEqual(["en", "fr"]);
    expect(runConventions(root, [])[0]?.message).toContain("fr");
  });

  it("rejects malformed localeCodes", () => {
    write(".warlock-check.json", JSON.stringify({ localeCodes: "en" }));

    expect(() => readConventionOptions(root)).toThrow("localeCodes must be an array");
  });
});
