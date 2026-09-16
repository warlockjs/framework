import ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractTranslationKeys } from "./translation-type-generator";

describe("translation type generation", () => {
  it("collects literal keys from registered dictionaries", () => {
    const sourceFile = ts.createSourceFile(
      "locales.ts",
      `
        groupedTranslations("products", {
          notFound: { en: "Not found" },
          "out-of-stock": { en: "Out of stock" },
        });
        groupedTranslations(groupName, { ignored: { en: "Ignored" } });
      `,
      ts.ScriptTarget.Latest,
    );

    expect(extractTranslationKeys(sourceFile)).toEqual([
      "products.notFound",
      "products.out-of-stock",
    ]);
  });
});
