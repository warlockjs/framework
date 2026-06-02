import { describe, expect, it } from "vitest";
import {
  camelCaseMutator,
  capitalizeMutator,
  htmlEscapeMutator,
  kebabCaseMutator,
  lowercaseMutator,
  ltrimMutator,
  padEndMutator,
  padStartMutator,
  pascalCaseMutator,
  removeSpecialCharactersMutator,
  repeatMutator,
  replaceAllMutator,
  replaceMutator,
  reverseMutator,
  rtrimMutator,
  safeHtmlMutator,
  slugMutator,
  snakeCaseMutator,
  stringifyMutator,
  titleCaseMutator,
  trimMutator,
  truncateMutator,
  uppercaseMutator,
  urlDecodeMutator,
  urlEncodeMutator,
} from "../../../src/mutators/string-mutators";

describe("String Mutators", () => {
  describe("Case Conversion", () => {
    it("lowercase", async () => {
      expect(await lowercaseMutator("HELLO WORLD")).toBe("hello world");
      expect(await lowercaseMutator("MixedCase")).toBe("mixedcase");
      expect(await lowercaseMutator(123)).toBe("123");
    });

    it("uppercase", async () => {
      expect(await uppercaseMutator("hello world")).toBe("HELLO WORLD");
      expect(await uppercaseMutator("MixedCase")).toBe("MIXEDCASE");
      expect(await uppercaseMutator(123)).toBe("123");
    });

    it("capitalize", async () => {
      expect(await capitalizeMutator("hello world")).toBe("Hello world");
      expect(await capitalizeMutator("HELLO")).toBe("Hello");
    });

    it("titleCase", async () => {
      expect(await titleCaseMutator("hello world")).toBe("Hello World");
      expect(await titleCaseMutator("the quick brown fox")).toBe("The Quick Brown Fox");
    });

    it("camelCase", async () => {
      expect(await camelCaseMutator("hello world")).toBe("helloWorld");
      expect(await camelCaseMutator("hello_world")).toBe("helloWorld");
    });

    it("pascalCase", async () => {
      expect(await pascalCaseMutator("hello world")).toBe("HelloWorld");
      expect(await pascalCaseMutator("hello_world")).toBe("HelloWorld");
    });

    it("snakeCase", async () => {
      expect(await snakeCaseMutator("hello world")).toBe("hello_world");
      expect(await snakeCaseMutator("helloWorld")).toBe("hello_world");
    });

    it("kebabCase", async () => {
      expect(await kebabCaseMutator("hello world")).toBe("hello-world");
      expect(await kebabCaseMutator("helloWorld")).toBe("hello-world");
    });
  });

  describe("Trimming", () => {
    it("trim", async () => {
      const context = { options: {} } as any;
      expect(await trimMutator("  hello  ", context)).toBe("hello");
      expect(await trimMutator("hello", context)).toBe("hello");
    });

    it("ltrim", async () => {
      const context = { options: {} } as any;
      expect(await ltrimMutator("  hello  ", context)).toBe("hello  ");
    });

    it("rtrim", async () => {
      const context = { options: {} } as any;
      expect(await rtrimMutator("  hello  ", context)).toBe("  hello");
    });
  });

  describe("Encoding & Sanitization", () => {
    it("urlEncode", async () => {
      expect(await urlEncodeMutator("hello world")).toBe("hello%20world");
      expect(await urlEncodeMutator("test@example.com")).toBe("test%40example.com");
    });

    it("urlDecode", async () => {
      expect(await urlDecodeMutator("hello%20world")).toBe("hello world");
      expect(await urlDecodeMutator("test%40example.com")).toBe("test@example.com");
    });

    it("htmlEscape", async () => {
      expect(await htmlEscapeMutator("<div>test</div>")).toBe("&lt;div&gt;test&lt;/div&gt;");
      expect(await htmlEscapeMutator("a & b")).toBe("a &amp; b");
    });

    it("safeHtml", async () => {
      expect(await safeHtmlMutator("<div>test</div>")).toBe("test");
      expect(await safeHtmlMutator("<p>Hello <b>World</b></p>")).toBe("Hello World");
    });

    it("removeSpecialCharacters", async () => {
      expect(await removeSpecialCharactersMutator("hello@world!")).toBe("helloworld");
      expect(await removeSpecialCharactersMutator("test-123_abc")).toBe("test123abc");
    });
  });

  describe("String Manipulation", () => {
    it("stringify", async () => {
      expect(await stringifyMutator("hello")).toBe("hello");
      expect(await stringifyMutator(123)).toBe("123");
      expect(await stringifyMutator(true)).toBe("true");
      expect(await stringifyMutator(0)).toBe("0");
      expect(await stringifyMutator(null)).toBe("");
    });

    it("replace", async () => {
      const context = { options: { search: "world", replace: "universe" } } as any;
      expect(await replaceMutator("hello world", context)).toBe("hello universe");
    });

    it("replaceAll", async () => {
      const context = { options: { search: "o", replace: "0" } } as any;
      expect(await replaceAllMutator("hello world", context)).toBe("hell0 w0rld");
    });

    it("truncate", async () => {
      const context = { options: { maxLength: 7, suffix: "..." } } as any;
      expect(await truncateMutator("hello world this is a test", context)).toBe("hello w...");
    });

    it("padStart", async () => {
      const context = { options: { length: 10, char: "0" } } as any;
      expect(await padStartMutator("123", context)).toBe("0000000123");
    });

    it("padEnd", async () => {
      const context = { options: { length: 10, char: "0" } } as any;
      expect(await padEndMutator("123", context)).toBe("1230000000");
    });

    it("repeat", async () => {
      const context = { options: { count: 3 } } as any;
      expect(await repeatMutator("ab", context)).toBe("ababab");
    });

    it("reverse", async () => {
      expect(await reverseMutator("hello")).toBe("olleh");
      expect(await reverseMutator("12345")).toBe("54321");
    });

    it("slug", async () => {
      expect(await slugMutator("Hello World!")).toBe("hello-world");
      expect(await slugMutator("Test@123")).toBe("test123");
      expect(await slugMutator("  multiple   spaces  ")).toBe("multiple-spaces");
    });
  });
});
