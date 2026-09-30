import { describe, expect, it } from "vitest";
import { LocaleDictionaryError, parseLocaleDictionary } from "./parse-locale-dictionary";

const sourceFile = "app/locales.json";
const localeCodes = ["en", "ar"] as const;
const parse = (source: string, defaultNamespace = "products") =>
  parseLocaleDictionary({ sourceFile, source, defaultNamespace, localeCodes });

describe("parseLocaleDictionary", () => {
  it("uses its supplied namespace, flattens nested entries, and lets $group override it", () => {
    expect(
      parse('{"title":{"en":"Products","ar":"المنتجات"},"card":{"add":{"en":"Add","ar":"أضف"}}}'),
    ).toEqual({
      sourceFile,
      group: "products",
      entries: {
        "products.title": { en: "Products", ar: "المنتجات" },
        "products.card.add": { en: "Add", ar: "أضف" },
      },
    });
    expect(
      parse('{"$group":"account.settings","email":{"en":"Email","ar":"البريد"}}'),
    ).toMatchObject({ group: "account.settings" });
    expect(parse("{}", "")).toMatchObject({ group: "", entries: {} });
  });

  it("allows source-only locale dictionaries while validating generic locale shapes", () => {
    expect(
      parseLocaleDictionary({
        sourceFile,
        source: '{"title":{"en":"Title","pt-BR":"Título"}}',
        defaultNamespace: "products",
      }),
    ).toMatchObject({ entries: { "products.title": { en: "Title", "pt-BR": "Título" } } });
    expect(() =>
      parseLocaleDictionary({
        sourceFile,
        source: '{"title":{"en_US":"Title"}}',
        defaultNamespace: "products",
      }),
    ).toThrow(/invalid locale code/);
  });

  it.each([
    ["empty group", '{"$group":"","title":{"en":"Title","ar":"العنوان"}}', /cannot be empty/],
    [
      "empty group segment",
      '{"$group":"products..card","title":{"en":"Title","ar":"العنوان"}}',
      /empty segments/,
    ],
    [
      "reserved group segment",
      '{"$group":"products.prototype","title":{"en":"Title","ar":"العنوان"}}',
      /reserved/,
    ],
    ["dotted key", '{"$group":"products","a.b":{"en":"Title","ar":"العنوان"}}', /cannot contain/],
    ["reserved key", '{"$group":"products","__proto__":{"en":"Title","ar":"العنوان"}}', /reserved/],
    ["nested group", '{"$group":"products","card":{"$group":"card"}}', /only allowed at the root/],
    ["empty nested object", '{"$group":"products","card":{}}', /cannot be empty/],
    [
      "unknown locale",
      '{"$group":"products","title":{"en":"Title","fr":"Titre"}}',
      /unknown locale code/,
    ],
    ["missing locale", '{"$group":"products","title":{"en":"Title"}}', /missing locale/],
    [
      "mixed nesting",
      '{"$group":"products","card":{"en":"Card","title":{"en":"Title","ar":"العنوان"}}}',
      /cannot mix/,
    ],
    [
      "duplicate escaped key",
      '{"title":{"en":"A","\\u0065n":"B","ar":"العنوان"}}',
      /duplicate JSON property/,
    ],
    ["trailing comma", '{"title":{"en":"A","ar":"ب"},}', /object keys must be JSON strings/],
    [
      "non-JSON whitespace",
      '{\u00a0"title":{"en":"A","ar":"ب"}}',
      /object keys must be JSON strings/,
    ],
  ])("refuses %s with the source file and key in its diagnostic", (_name, source, message) => {
    expect(() => parse(source)).toThrow(LocaleDictionaryError);
    expect(() => parse(source)).toThrow(message);
    expect(() => parse(source)).toThrow(sourceFile);
  });
});
