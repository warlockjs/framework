import { describe, expect, it } from "vitest";
import { MASK_EMAILS_MAX_LENGTH, maskEmail, maskEmailsInText } from "./mask-email";

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("member@example.com")).toBe("m***@example.com");
  });

  it("uses the last @ so the domain is always the real one", () => {
    expect(maskEmail("a@b@example.com")).toBe("a***@example.com");
  });

  it("keeps a whole first code point, never half of a surrogate pair", () => {
    expect(maskEmail("😀a@x.com")).toBe("😀***@x.com");
  });

  it("masks a value that is not an address completely", () => {
    expect(maskEmail("no-at-sign")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });
});

describe("maskEmailsInText", () => {
  it("masks an address inside a cache key, dotted prefix included", () => {
    // dots are valid in a local part, so `email.member` reads as one
    expect(maskEmailsInText("email.member@example.com")).toBe("e***@example.com");
    expect(maskEmailsInText("email:member@example.com")).toBe("email:m***@example.com");
  });

  it("masks every address in a sentence and leaves the rest alone", () => {
    expect(maskEmailsInText("to: a.b@x.io, c+tag@mail.example.org (2)")).toBe(
      "to: a***@x.io, c***@mail.example.org (2)",
    );
  });

  it("leaves text without an address untouched", () => {
    expect(maskEmailsInText("user.42.profile")).toBe("user.42.profile");
  });
});

describe("maskEmailsInText — non-ASCII addresses", () => {
  it("masks letters from any script in the local part and the domain", () => {
    expect(maskEmailsInText("to jöhn@exämple.de")).toBe("to j***@exämple.de");
    expect(maskEmailsInText("x@münchen.de")).toBe("x***@münchen.de");
    expect(maskEmailsInText("jöhn@example.com")).toBe("j***@example.com");
  });
});

describe("maskEmailsInText — bounded cost", () => {
  // The old unbounded pattern took ~11 s on the first input (quadratic
  // backtracking). Bounded repetitions keep every input linear; the budget is
  // generous so a slow CI machine does not flake.
  it.each([
    ["a run with no domain", "a".repeat(50_000) + "@" + "b-".repeat(25_000)],
    ["a dotted domain with no TLD", "a@" + "b.".repeat(30_000) + "!"],
    ["a dotted local part", "a.".repeat(20_000) + "@x"],
  ])("handles %s quickly", (_name, input) => {
    const startedAt = performance.now();
    maskEmailsInText(input);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it("truncates text past the scan limit and marks the cut", () => {
    const text = "x".repeat(MASK_EMAILS_MAX_LENGTH) + " member@example.com";
    const masked = maskEmailsInText(text);

    expect(masked).not.toContain("member@example.com");
    expect(masked.endsWith(`…[${" member@example.com".length} chars truncated]`)).toBe(true);
  });

  it("does not end the kept text on half a surrogate pair", () => {
    const text = "x".repeat(MASK_EMAILS_MAX_LENGTH - 1) + "😀" + "tail";
    const masked = maskEmailsInText(text);

    expect(masked.startsWith("x".repeat(MASK_EMAILS_MAX_LENGTH - 1) + "…[")).toBe(true);
  });
});
