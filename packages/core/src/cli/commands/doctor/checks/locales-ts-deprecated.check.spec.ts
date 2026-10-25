import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorBootContext } from "../check.types";
import {
  fixLocaleSources,
  inspectLocaleSources,
  localesTsDeprecatedCheck,
} from "./locales-ts-deprecated.check";

const LEGACY = [
  'import { groupedTranslations } from "@warlock.js/core";',
  "",
  'groupedTranslations("posts", {',
  '  published: { en: "Published", ar: "Published (ar)" },',
  "});",
  "",
].join("\n");

let root: string;

function write(relative: string, contents: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-locales-doctor-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("legacy utils/locales.ts migration", () => {
  it("converts a pure groupedTranslations file into the module's locales.json", () => {
    write("src/app/posts/utils/locales.ts", LEGACY);

    const [result] = fixLocaleSources();

    expect(result?.reason).toContain("converted");
    expect(existsSync(path.join(root, "src/app/posts/utils/locales.ts"))).toBe(false);
    expect(JSON.parse(read("src/app/posts/utils/locales.json"))).toEqual({
      published: { en: "Published", ar: "Published (ar)" },
    });
  });

  it("writes locales/legacy.json when locales.json already exists and no key overlaps", () => {
    write("src/app/posts/utils/locales.ts", LEGACY);
    write(
      "src/app/posts/utils/locales.json",
      '{ "draft": { "en": "Draft", "ar": "Draft (ar)" } }\n',
    );

    const [inspection] = inspectLocaleSources();
    expect(inspection?.convertible).toBe(true);
    expect(inspection?.target).toBe(path.join(root, "src/app/posts/utils/locales/legacy.json"));

    const [result] = fixLocaleSources();

    expect(result?.reason).toContain("converted");
    expect(JSON.parse(read("src/app/posts/utils/locales/legacy.json"))).toEqual({
      published: { en: "Published", ar: "Published (ar)" },
    });
    expect(read("src/app/posts/utils/locales.json")).toContain("Draft");
    expect(existsSync(path.join(root, "src/app/posts/utils/locales.ts"))).toBe(false);
  });

  it("keeps the TypeScript file when its keys already exist in locales.json", () => {
    write("src/app/posts/utils/locales.ts", LEGACY);
    write(
      "src/app/posts/utils/locales.json",
      '{ "published": { "en": "Published", "ar": "Published (ar)" } }\n',
    );

    const [result] = fixLocaleSources();

    expect(result?.convertible).toBe(false);
    expect(result?.reason).toContain("keys already defined in locales.json");
    expect(existsSync(path.join(root, "src/app/posts/utils/locales.ts"))).toBe(true);
    expect(existsSync(path.join(root, "src/app/posts/utils/locales"))).toBe(false);
  });

  it("is not convertible when both locales.json and locales/legacy.json exist", () => {
    write("src/app/posts/utils/locales.ts", LEGACY);
    write("src/app/posts/utils/locales.json", "{}\n");
    write("src/app/posts/utils/locales/legacy.json", "{}\n");

    expect(inspectLocaleSources()[0]?.convertible).toBe(false);
  });

  it("warns and names every legacy file", () => {
    write("src/app/posts/utils/locales.ts", LEGACY);
    write("src/app/blog/utils/locales.ts", LEGACY.replace('"posts"', '"blog"'));

    const result = localesTsDeprecatedCheck.run({} as DoctorBootContext) as {
      status: string;
      code: string;
      detail: string;
    };

    expect(result.status).toBe("warn");
    expect(result.code).toBe("WL9101");
    expect(result.detail).toContain("src/app/posts/utils/locales.ts");
    expect(result.detail).toContain("src/app/blog/utils/locales.ts");
  });
});
