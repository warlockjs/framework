import ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractTranslationKeys } from "./extract-translation-keys";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
}

describe("extractTranslationKeys", () => {
  it("collects literal keys from the named-group form", () => {
    const sourceFile = parse(`
      import { groupedTranslations } from "@mongez/localization";

      groupedTranslations("products", {
        notFound: { en: "Not found" },
        "out-of-stock": { en: "Out of stock" },
      });
    `);

    expect(extractTranslationKeys(sourceFile)).toEqual([
      "products.notFound",
      "products.out-of-stock",
    ]);
  });

  it("collects literal keys from the object form", () => {
    const sourceFile = parse(`
      import { groupedTranslations } from "@warlock.js/core";

      groupedTranslations({
        site: {
          home: { en: "Home", ar: "الرئيسية" },
        },
      });
    `);

    expect(extractTranslationKeys(sourceFile)).toEqual(["site.home"]);
  });

  it("resolves nested groups at any depth, in both forms", () => {
    const sourceFile = parse(`
      groupedTranslations("products", {
        detail: {
          title: { en: "Title" },
        },
      });

      groupedTranslations({
        site: {
          footer: {
            legal: { en: "Legal", ar: "قانوني" },
          },
        },
      });
    `);

    expect(extractTranslationKeys(sourceFile)).toEqual([
      "products.detail.title",
      "site.footer.legal",
    ]);
  });

  it("skips a dynamic group name", () => {
    const sourceFile = parse(`
      groupedTranslations(groupName, { ignored: { en: "Ignored" } });
    `);

    expect(extractTranslationKeys(sourceFile)).toEqual([]);
  });

  it("skips a dynamic dictionary", () => {
    const sourceFile = parse(`
      groupedTranslations("products", dictionary);
    `);

    expect(extractTranslationKeys(sourceFile)).toEqual([]);
  });

  it("skips a computed (dynamic) key inside an otherwise static dictionary", () => {
    const sourceFile = parse(`
      groupedTranslations("products", {
        [dynamicKey]: { en: "Ignored" },
        notFound: { en: "Not found" },
      });
    `);

    expect(extractTranslationKeys(sourceFile)).toEqual(["products.notFound"]);
  });

  it("returns no keys when the file never calls groupedTranslations", () => {
    const sourceFile = parse(`export const x = 1;`);

    expect(extractTranslationKeys(sourceFile)).toEqual([]);
  });
});
