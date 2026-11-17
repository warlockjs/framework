import { describe, expect, it } from "vitest";
import { generateTotpSecret, totpCode, totpUri, verifyTotp } from "./totp";

// RFC 6238 appendix B, SHA1 secret "12345678901234567890" in base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const vectors: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("totp", () => {
  it.each(vectors)("matches the RFC 6238 vector at %i", (seconds, code) => {
    expect(totpCode(RFC_SECRET, seconds * 1000, { digits: 8 })).toBe(code);
    expect(verifyTotp(RFC_SECRET, code, { at: seconds * 1000, digits: 8, window: 0 })).toBe(
      Math.floor(seconds / 30),
    );
  });

  it("produces six digits by default", () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe("287082");
  });

  it("accepts a lower-case secret and spaces in the code", () => {
    expect(verifyTotp(RFC_SECRET.toLowerCase(), "287 082", { at: 59_000, window: 0 })).toBe(1);
  });

  it("accepts neighbouring steps inside the window and returns the matched step", () => {
    const code = totpCode(RFC_SECRET, 59_000);

    expect(verifyTotp(RFC_SECRET, code, { at: 89_000 })).toBe(1);
    expect(verifyTotp(RFC_SECRET, code, { at: 29_000 })).toBe(1);
    expect(verifyTotp(RFC_SECRET, code, { at: 119_000 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { at: 119_000, window: 2 })).toBe(1);
  });

  it("refuses codes that are not exactly six digits", () => {
    expect(verifyTotp(RFC_SECRET, "28708", { at: 59_000 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "2870822", { at: 59_000 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "28708a", { at: 59_000 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "", { at: 59_000 })).toBeNull();
  });

  it("returns null for a wrong code and for an invalid secret", () => {
    expect(verifyTotp(RFC_SECRET, "000000", { at: 59_000 })).toBeNull();
    expect(verifyTotp("not base32!", "287082", { at: 59_000 })).toBeNull();
  });

  it("generates base32 secrets of the requested size", () => {
    const secret = generateTotpSecret();

    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret(10)).toMatch(/^[A-Z2-7]{16}$/);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it("builds the key URI with encoded label parts", () => {
    const uri = totpUri({ secret: "ABC234", account: "a+b@x.com", issuer: "Warlock monitor" });

    expect(uri).toBe(
      "otpauth://totp/Warlock%20monitor:a%2Bb%40x.com?secret=ABC234&issuer=Warlock%20monitor&algorithm=SHA1&digits=6&period=30",
    );
  });
});
