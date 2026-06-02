import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

describe("StringValidator - Comprehensive", () => {
  describe("Type Validation", () => {
    it("validates string type", async () => {
      const result = await validate(v.string(), "test");
      expect(result.isValid).toBe(true);
    });

    it("fails for non-string", async () => {
      const result = await validate(v.string(), 123);
      expect(result.isValid).toBe(false);
    });
  });

  describe("Case Mutators", () => {
    it("uppercase", async () => {
      const result = await validate(v.string().uppercase(), "test");
      expect(result.data).toBe("TEST");
    });

    it("lowercase", async () => {
      const result = await validate(v.string().lowercase(), "TEST");
      expect(result.data).toBe("test");
    });

    it("capitalize", async () => {
      const result = await validate(v.string().capitalize(), "hello world");
      expect(result.data).toBe("Hello world");
    });

    it("titleCase", async () => {
      const result = await validate(v.string().titleCase(), "hello world");
      expect(result.data).toBe("Hello World");
    });

    it("camelCase", async () => {
      const result = await validate(v.string().camelCase(), "hello world");
      expect(result.data).toBe("helloWorld");
    });

    it("pascalCase", async () => {
      const result = await validate(v.string().pascalCase(), "hello world");
      expect(result.data).toBe("HelloWorld");
    });

    it("snakeCase", async () => {
      const result = await validate(v.string().snakeCase(), "hello world");
      expect(result.data).toBe("hello_world");
    });

    it("kebabCase", async () => {
      const result = await validate(v.string().kebabCase(), "hello world");
      expect(result.data).toBe("hello-world");
    });
  });

  describe("Trim Mutators", () => {
    it("trim", async () => {
      const result = await validate(v.string().trim(), "  test  ");
      expect(result.data).toBe("test");
    });

    it("ltrim", async () => {
      const result = await validate(v.string().ltrim(), "  test  ");
      expect(result.data).toBe("test  ");
    });

    it("rtrim", async () => {
      const result = await validate(v.string().rtrim(), "  test  ");
      expect(result.data).toBe("  test");
    });

    it("trimMultipleWhitespace", async () => {
      const result = await validate(v.string().trimMultipleWhitespace(), "hello    world");
      expect(result.data).toBe("hello world");
    });
  });

  describe("Padding Mutators", () => {
    it("padStart", async () => {
      const result = await validate(v.string().padStart(5, "0"), "12");
      expect(result.data).toBe("00012");
    });

    it("padEnd", async () => {
      const result = await validate(v.string().padEnd(5, "0"), "12");
      expect(result.data).toBe("12000");
    });
  });

  describe("HTML Mutators", () => {
    it("safeHtml", async () => {
      const result = await validate(v.string().safeHtml(), "<div>test</div>");
      expect(result.data).toBe("test");
    });

    it("htmlEscape", async () => {
      const result = await validate(v.string().htmlEscape(), "<div>test</div>");
      expect(result.data).toBe("&lt;div&gt;test&lt;/div&gt;");
    });

    it("unescapeHtml", async () => {
      const result = await validate(v.string().unescapeHtml(), "&lt;div&gt;");
      expect(result.data).toBe("<div>");
    });
  });

  describe("String Manipulation Mutators", () => {
    it("removeSpecialCharacters", async () => {
      const result = await validate(v.string().removeSpecialCharacters(), "hello@world!");
      expect(result.data).toBe("helloworld");
    });

    it("toAlpha", async () => {
      const result = await validate(v.string().toAlpha(), "hello123");
      expect(result.data).toBe("hello");
    });

    it("toAlphanumeric", async () => {
      const result = await validate(v.string().toAlphanumeric(), "hello@123");
      expect(result.data).toBe("hello123");
    });

    it("removeNumbers", async () => {
      const result = await validate(v.string().removeNumbers(), "hello123");
      expect(result.data).toBe("hello");
    });

    it("reverse", async () => {
      const result = await validate(v.string().reverse(), "hello");
      expect(result.data).toBe("olleh");
    });

    it("repeat", async () => {
      const result = await validate(v.string().repeat(3), "ab");
      expect(result.data).toBe("ababab");
    });

    it("slug", async () => {
      const result = await validate(v.string().slug(), "Hello World!");
      expect(result.data).toBe("hello-world");
    });

    it("truncate", async () => {
      const result = await validate(v.string().truncate(5), "hello world");
      expect(result.data).toContain("hello");
    });

    it("replace", async () => {
      const result = await validate(v.string().replace("world", "universe"), "hello world");
      expect(result.data).toBe("hello universe");
    });

    it("replaceAll", async () => {
      const result = await validate(v.string().replaceAll("o", "0"), "hello world");
      expect(result.data).toBe("hell0 w0rld");
    });

    it("append", async () => {
      const result = await validate(v.string().append("!"), "hello");
      expect(result.data).toBe("hello!");
    });

    it("prepend", async () => {
      const result = await validate(v.string().prepend("Mr. "), "Smith");
      expect(result.data).toBe("Mr. Smith");
    });

    it("mask", async () => {
      const result = await validate(v.string().mask(2, 6), "12345678");
      expect(result.data).toBe("12****78");
    });
  });

  describe("Encoding Mutators", () => {
    it("urlEncode", async () => {
      const result = await validate(v.string().urlEncode(), "hello world");
      expect(result.data).toBe("hello%20world");
    });

    it("urlDecode", async () => {
      const result = await validate(v.string().urlDecode(), "hello%20world");
      expect(result.data).toBe("hello world");
    });

    it("base64Encode", async () => {
      const result = await validate(v.string().base64Encode(), "hello");
      expect(result.data).toBe("aGVsbG8=");
    });

    it("base64Decode", async () => {
      const result = await validate(v.string().base64Decode(), "aGVsbG8=");
      expect(result.data).toBe("hello");
    });
  });

  describe("Validation Rules", () => {
    it("email", async () => {
      expect((await validate(v.string().email(), "test@example.com")).isValid).toBe(true);
      expect((await validate(v.string().email(), "invalid")).isValid).toBe(false);
    });

    it("url", async () => {
      expect((await validate(v.string().url(), "https://example.com")).isValid).toBe(true);
      expect((await validate(v.string().url(), "invalid")).isValid).toBe(false);
    });

    it("alpha", async () => {
      expect((await validate(v.string().alpha(), "hello")).isValid).toBe(true);
      expect((await validate(v.string().alpha(), "hello123")).isValid).toBe(false);
    });

    it("alphanumeric", async () => {
      expect((await validate(v.string().alphanumeric(), "hello123")).isValid).toBe(true);
      expect((await validate(v.string().alphanumeric(), "hello@123")).isValid).toBe(false);
    });

    it("numeric", async () => {
      expect((await validate(v.string().numeric(), "123")).isValid).toBe(true);
      expect((await validate(v.string().numeric(), "abc")).isValid).toBe(false);
    });

    it("pattern", async () => {
      expect((await validate(v.string().pattern(/^[a-z]+$/), "hello")).isValid).toBe(true);
      expect((await validate(v.string().pattern(/^[a-z]+$/), "Hello")).isValid).toBe(false);
    });

    it("startsWith", async () => {
      expect((await validate(v.string().startsWith("hello"), "hello world")).isValid).toBe(true);
      expect((await validate(v.string().startsWith("world"), "hello world")).isValid).toBe(false);
    });

    it("endsWith", async () => {
      expect((await validate(v.string().endsWith("world"), "hello world")).isValid).toBe(true);
      expect((await validate(v.string().endsWith("hello"), "hello world")).isValid).toBe(false);
    });

    it("contains", async () => {
      expect((await validate(v.string().contains("lo wo"), "hello world")).isValid).toBe(true);
      expect((await validate(v.string().contains("xyz"), "hello world")).isValid).toBe(false);
    });

    it("notContains", async () => {
      expect((await validate(v.string().notContains("xyz"), "hello world")).isValid).toBe(true);
      expect((await validate(v.string().notContains("hello"), "hello world")).isValid).toBe(false);
    });

    it("withoutWhitespace", async () => {
      expect((await validate(v.string().withoutWhitespace(), "helloworld")).isValid).toBe(true);
      expect((await validate(v.string().withoutWhitespace(), "hello world")).isValid).toBe(false);
    });
  });

  describe("Length Rules", () => {
    it("length", async () => {
      expect((await validate(v.string().length(5), "hello")).isValid).toBe(true);
      expect((await validate(v.string().length(5), "hi")).isValid).toBe(false);
    });

    it("minLength", async () => {
      expect((await validate(v.string().minLength(3), "hello")).isValid).toBe(true);
      expect((await validate(v.string().minLength(10), "hello")).isValid).toBe(false);
    });

    it("maxLength", async () => {
      expect((await validate(v.string().maxLength(10), "hello")).isValid).toBe(true);
      expect((await validate(v.string().maxLength(3), "hello")).isValid).toBe(false);
    });

    it("lengthBetween", async () => {
      expect((await validate(v.string().lengthBetween(3, 10), "hello")).isValid).toBe(true);
      expect((await validate(v.string().lengthBetween(10, 20), "hello")).isValid).toBe(false);
    });

    it("minWords", async () => {
      expect((await validate(v.string().minWords(2), "hello world")).isValid).toBe(true);
      expect((await validate(v.string().minWords(5), "hello world")).isValid).toBe(false);
    });

    it("maxWords", async () => {
      expect((await validate(v.string().maxWords(5), "hello world")).isValid).toBe(true);
      expect((await validate(v.string().maxWords(1), "hello world")).isValid).toBe(false);
    });

    it("words", async () => {
      expect((await validate(v.string().words(2), "hello world")).isValid).toBe(true);
      expect((await validate(v.string().words(3), "hello world")).isValid).toBe(false);
    });
  });

  describe("Color Rules", () => {
    it("color", async () => {
      expect((await validate(v.string().color(), "#ff0000")).isValid).toBe(true);
      expect((await validate(v.string().color(), "invalid")).isValid).toBe(false);
    });

    it("hexColor", async () => {
      expect((await validate(v.string().hexColor(), "#ff0000")).isValid).toBe(true);
      expect((await validate(v.string().hexColor(), "rgb(255,0,0)")).isValid).toBe(false);
    });

    it("rgbColor", async () => {
      expect((await validate(v.string().rgbColor(), "rgb(255, 0, 0)")).isValid).toBe(true);
      expect((await validate(v.string().rgbColor(), "#ff0000")).isValid).toBe(false);
    });

    it("rgbaColor", async () => {
      expect((await validate(v.string().rgbaColor(), "rgba(255, 0, 0, 1)")).isValid).toBe(true);
      expect((await validate(v.string().rgbaColor(), "rgb(255,0,0)")).isValid).toBe(false);
    });

    it("hslColor", async () => {
      expect((await validate(v.string().hslColor(), "hsl(0, 100%, 50%)")).isValid).toBe(true);
      expect((await validate(v.string().hslColor(), "#ff0000")).isValid).toBe(false);
    });
  });

  describe("IP Rules", () => {
    it("ip", async () => {
      expect((await validate(v.string().ip(), "192.168.1.1")).isValid).toBe(true);
      expect((await validate(v.string().ip(), "2001:db8::1")).isValid).toBe(true);
      expect((await validate(v.string().ip(), "invalid")).isValid).toBe(false);
    });

    it("ip4", async () => {
      expect((await validate(v.string().ip4(), "192.168.1.1")).isValid).toBe(true);
      expect((await validate(v.string().ip4(), "2001:db8::1")).isValid).toBe(false);
    });

    it("ip6", async () => {
      expect((await validate(v.string().ip6(), "2001:db8::1")).isValid).toBe(true);
      expect((await validate(v.string().ip6(), "192.168.1.1")).isValid).toBe(false);
    });
  });

  describe("Special Rules", () => {
    it("creditCard", async () => {
      expect((await validate(v.string().creditCard(), "4532015112830366")).isValid).toBe(true);
      expect((await validate(v.string().creditCard(), "1234")).isValid).toBe(false);
    });

    it("strongPassword", async () => {
      expect((await validate(v.string().strongPassword(), "Abc123!@#")).isValid).toBe(true);
      expect((await validate(v.string().strongPassword(), "weak")).isValid).toBe(false);
    });
  });

  describe("Chaining", () => {
    it("chains multiple mutators", async () => {
      const result = await validate(v.string().trim().lowercase().capitalize(), "  HELLO WORLD  ");
      expect(result.data).toBe("Hello world");
    });

    it("chains mutators and rules", async () => {
      const result = await validate(v.string().trim().email(), "  test@example.com  ");
      expect(result.isValid).toBe(true);
      expect(result.data).toBe("test@example.com");
    });
  });
});
