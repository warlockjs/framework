import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fixLocaleSources,
  localesTsDeprecatedCheck,
} from "../../../../src/cli/commands/doctor/checks/locales-ts-deprecated.check";
import type { DoctorBootContext } from "../../../../src/cli/commands/doctor/check.types";
import { parseLocaleDictionary } from "../../../../src/localization/parse-locale-dictionary";

const appPathFor = (...segments: string[]) => path.join(process.cwd(), "src", "app", ...segments);

const localeSource = (group: string, dictionary: string) =>
  [
    'import { groupedTranslations } from "@warlock.js/core";',
    "",
    `groupedTranslations("${group}", ${dictionary});`,
    "",
  ].join("\n");

const context = {} as DoctorBootContext;
let originalCwd: string;
let tempDir: string;

async function writeLocaleSource(module: string, source: string): Promise<string> {
  const file = appPathFor(module, "utils", "locales.ts");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source);
  return file;
}

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "warlock-doctor-locales-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("locales-ts-deprecated doctor migration", () => {
  it("converts only verified literals and leaves unsafe sources for manual migration", async () => {
    const catalogSource = localeSource(
      "catalog",
      '{ title: { en: "Catalog", ar: "الكتالوج" }, nested: { empty: { en: "Empty", ar: "فارغ" } } }',
    );
    const renamedSource = localeSource(
      "commerce.orders",
      '{ title: { en: "Orders", ar: "الطلبات" } }',
    );
    const computedSource = [
      'import { groupedTranslations } from "@warlock.js/core";',
      "",
      'groupedTranslations("dynamic", { title: { en: `Dynamic`, ar: getArabic() } });',
      "",
    ].join("\n");
    const extraImportSource = [
      'import { groupedTranslations } from "@warlock.js/core";',
      'import { translate } from "./translate";',
      "",
      'groupedTranslations("imported", { title: { en: "Imported", ar: "مستورد" } });',
      "",
    ].join("\n");

    const catalogFile = await writeLocaleSource("catalog", catalogSource);
    const renamedFile = await writeLocaleSource("orders", renamedSource);
    const computedFile = await writeLocaleSource("dynamic", computedSource);
    const extraImportFile = await writeLocaleSource("imported", extraImportSource);
    const occupiedFile = await writeLocaleSource(
      "occupied",
      localeSource("occupied", '{ title: { en: "Old", ar: "قديم" } }'),
    );
    const occupiedJson = appPathFor("occupied", "utils", "locales.json");
    await writeFile(occupiedJson, '{ "title": { "en": "Existing", "ar": "موجود" } }\n');

    const firstRun = fixLocaleSources();

    expect(
      firstRun.map(({ module, convertible, reason }) => ({ module, convertible, reason })),
    ).toEqual([
      { module: "catalog", convertible: true, reason: expect.stringContaining("converted") },
      { module: "dynamic", convertible: false, reason: expect.stringContaining("literal") },
      {
        module: "imported",
        convertible: false,
        reason: expect.stringContaining("must contain only"),
      },
      { module: "occupied", convertible: false, reason: "locales.json already exists" },
      { module: "orders", convertible: true, reason: expect.stringContaining("converted") },
    ]);

    expect(existsSync(catalogFile)).toBe(false);
    expect(existsSync(renamedFile)).toBe(false);
    expect(existsSync(computedFile)).toBe(true);
    expect(existsSync(extraImportFile)).toBe(true);
    expect(existsSync(occupiedFile)).toBe(true);

    const catalogJson = await readFile(appPathFor("catalog", "utils", "locales.json"), "utf8");
    const renamedJson = await readFile(appPathFor("orders", "utils", "locales.json"), "utf8");
    expect(
      parseLocaleDictionary({
        sourceFile: "catalog/locales.json",
        source: catalogJson,
        defaultNamespace: "catalog",
      }).entries,
    ).toEqual({
      "catalog.title": { en: "Catalog", ar: "الكتالوج" },
      "catalog.nested.empty": { en: "Empty", ar: "فارغ" },
    });
    expect(
      parseLocaleDictionary({
        sourceFile: "orders/locales.json",
        source: renamedJson,
        defaultNamespace: "orders",
      }),
    ).toMatchObject({
      group: "commerce.orders",
      entries: { "commerce.orders.title": { en: "Orders", ar: "الطلبات" } },
    });
    expect(JSON.parse(renamedJson)).toMatchObject({ $group: "commerce.orders" });

    const secondRun = fixLocaleSources();
    expect(secondRun.map(({ module, convertible }) => ({ module, convertible }))).toEqual([
      { module: "dynamic", convertible: false },
      { module: "imported", convertible: false },
      { module: "occupied", convertible: false },
    ]);
    expect(await readFile(appPathFor("catalog", "utils", "locales.json"), "utf8")).toBe(
      catalogJson,
    );
    expect(await readFile(appPathFor("orders", "utils", "locales.json"), "utf8")).toBe(renamedJson);

    const report = await localesTsDeprecatedCheck.run(context);
    expect(report).toMatchObject({ name: "locales-ts-deprecated", status: "warn" });
    expect(report?.detail).toContain("dynamic/utils/locales.ts: manual");
    expect(report?.detail).toContain("translation object must contain only literal");
    expect(report?.detail).toContain("imported/utils/locales.ts: manual");
    expect(report?.detail).toContain(
      "must contain only the groupedTranslations import and one call",
    );
    expect(report?.detail).toContain(
      "occupied/utils/locales.ts: manual (locales.json already exists)",
    );
    expect(report?.detail).toContain("goes away in v6");
  });
});
