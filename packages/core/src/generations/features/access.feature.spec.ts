import { parseLocaleDictionary } from "../../localization/parse-locale-dictionary";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

function matchedFile(path: string): [string, string] | undefined {
  return [...files.entries()].find(([file]) => path.replace(/\\/g, "/").endsWith(file));
}

vi.mock("@warlock.js/fs", () => ({
  ensureDirectoryAsync: vi.fn(),
  fileExistsAsync: vi.fn(async (path: string) => matchedFile(path) !== undefined),
  getFileAsync: vi.fn(async (path: string) => matchedFile(path)?.[1] ?? ""),
  putFileAsync: vi.fn(async (path: string, content: string) => files.set(path, content)),
}));

import { accessFeature } from "./access.feature";

const accessJson = /src[\\/]app[\\/]access[\\/]utils[\\/]locales\.json$/;
const sharedLegacy = /src[\\/]app[\\/]shared[\\/]utils[\\/]locales\.ts$/;

function jsonFile(): [string, string] | undefined {
  return [...files.entries()].reverse().find(([path]) => accessJson.test(path));
}

describe("add access locale dictionary", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    files.clear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => logSpy.mockRestore());

  it("creates access/utils/locales.json and produces the access.errors.forbidden key", async () => {
    await accessFeature.onExecuting?.({} as never);

    const written = jsonFile();
    expect(written).toBeDefined();
    expect(written?.[1]).toMatch(/\n$/);
    expect(JSON.parse(written?.[1] ?? "")).toEqual({
      errors: {
        forbidden: {
          en: "You do not have permission to perform this action.",
          ar: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
        },
      },
    });
    expect(
      parseLocaleDictionary({
        sourceFile: written?.[0] ?? "locales.json",
        source: written?.[1] ?? "",
        defaultNamespace: "access",
      }).entries,
    ).toHaveProperty("access.errors.forbidden");
  });

  it("skips JSON when the legacy shared access locale is already registered", async () => {
    files.set("src/app/shared/utils/locales.ts", 'groupedTranslations("access", {});\n');

    await accessFeature.onExecuting?.({} as never);

    expect(jsonFile()).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("already registered"));
  });

  it("merges the missing forbidden key into an existing dictionary", async () => {
    files.set("src/app/access/utils/locales.json", '{\n  "other": { "en": "Other" }\n}\n');

    await accessFeature.onExecuting?.({} as never);

    const dictionary = JSON.parse(jsonFile()?.[1] ?? "");
    expect(dictionary.other).toEqual({ en: "Other" });
    expect(dictionary.errors.forbidden.en).toBe(
      "You do not have permission to perform this action.",
    );
  });

  it("leaves an existing forbidden key untouched", async () => {
    const existing = '{\n  "errors": {\n    "forbidden": { "en": "Custom" }\n  }\n}\n';
    files.set("src/app/access/utils/locales.json", existing);

    await accessFeature.onExecuting?.({} as never);

    expect(jsonFile()?.[1]).toBe(existing);
  });

  it("leaves invalid JSON untouched and asks for a manual update", async () => {
    const invalid = "{ invalid json";
    files.set("src/app/access/utils/locales.json", invalid);

    await accessFeature.onExecuting?.({} as never);

    expect(jsonFile()?.[1]).toBe(invalid);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("manually"));
  });

  it("refuses to merge into a dictionary whose $group is not access", async () => {
    const renamed = '{\n  "$group": "shared",\n  "other": { "en": "Other" }\n}\n';
    files.set("src/app/access/utils/locales.json", renamed);

    await accessFeature.onExecuting?.({} as never);

    expect(jsonFile()?.[1]).toBe(renamed);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("$group"));
  });
});
