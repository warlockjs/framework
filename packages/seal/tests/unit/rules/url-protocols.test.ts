import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
// Side-effect import: loads BaseValidator.prototype.optional/required/etc.
import "../../../src/validators";

const isValid = async (schema: Parameters<typeof validate>[0], value: unknown) =>
  (await validate(schema, value)).isValid;

describe("url() schemes", () => {
  it("refuses script-capable schemes by default", async () => {
    for (const value of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(await isValid(v.string().url(), value)).toBe(false);
    }
  });

  it("keeps every other scheme working by default", async () => {
    for (const value of [
      "https://a.b/c",
      "http://localhost:3000",
      "mailto:a@b.c",
      "ftp://files.example.com",
      "myapp://open/item/1",
    ]) {
      expect(await isValid(v.string().url(), value)).toBe(true);
    }
  });

  it("accepts only the listed protocols when given", async () => {
    const web = v.string().url({ protocols: ["http", "https:"] });

    expect(await isValid(web, "https://a.b")).toBe(true);
    expect(await isValid(web, "HTTP://a.b")).toBe(true);
    expect(await isValid(web, "mailto:a@b.c")).toBe(false);
    expect(await isValid(web, "javascript:alert(1)")).toBe(false);

    const mail = v.string().url({ protocols: ["mailto:"] });
    expect(await isValid(mail, "mailto:a@b.c")).toBe(true);
    expect(await isValid(mail, "https://a.b")).toBe(false);
  });

  it("an explicit list may opt a refused scheme back in", async () => {
    expect(await isValid(v.string().url({ protocols: ["data"] }), "data:,hello")).toBe(true);
  });

  it("keeps the error message forms", async () => {
    const plain = await validate(v.string().url("Bad link"), "javascript:x");
    const withOptions = await validate(
      v.string().url({ protocols: ["https"] }, "Use https"),
      "http://a",
    );

    expect(plain.errors[0]?.error).toBe("Bad link");
    expect(withOptions.errors[0]?.error).toBe("Use https");
  });

  it("still refuses strings that are not URLs", async () => {
    expect(await isValid(v.string().url(), "not-a-url")).toBe(false);
  });
});
