import config from "@mongez/config";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../../src/encryption/password";

/**
 * Real bcrypt round-trips for the password helpers. Source:
 * core/src/encryption/password.ts. bcryptjs is loaded lazily and asynchronously
 * at module import, so `waitForBcrypt()` warms the import before the assertions
 * run. Salt rounds are pinned low via config purely to keep hashing fast.
 */

/**
 * Wait until the lazily-imported bcryptjs module is ready. `hashPassword`
 * throws the install message while `isModuleExists` is still null/false; once
 * the dynamic import resolves it stops throwing. We retry briefly to remove the
 * import-timing race without coupling to module internals.
 */
async function waitForBcrypt(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await hashPassword("warmup");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw new Error("bcryptjs did not become available in time");
}

beforeAll(async () => {
  // Low salt keeps the suite fast; security level is irrelevant for the test.
  config.set("encryption.password.salt", 4);
  await waitForBcrypt();
});

beforeEach(() => {
  config.set("encryption.password.salt", 4);
});

describe("hashPassword", () => {
  it("produces a bcrypt hash that is not the plaintext", async () => {
    const hash = await hashPassword("s3cret-pass");

    expect(hash).not.toBe("s3cret-pass");
    // bcrypt hashes start with $2a$ / $2b$ and are 60 chars long.
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(hash).toHaveLength(60);
  });

  it("salts each hash — same input yields different digests", async () => {
    const a = await hashPassword("same-input");
    const b = await hashPassword("same-input");

    expect(a).not.toBe(b);
  });

  it("coerces a non-string password via String()", async () => {
    const hash = await hashPassword(12345 as unknown as string);

    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("12345", hash)).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("returns true for the matching plaintext", async () => {
    const hash = await hashPassword("correct-horse");

    expect(await verifyPassword("correct-horse", hash)).toBe(true);
  });

  it("returns false for a wrong plaintext", async () => {
    const hash = await hashPassword("correct-horse");

    expect(await verifyPassword("battery-staple", hash)).toBe(false);
  });

  it("returns false against a non-bcrypt string instead of throwing", async () => {
    expect(await verifyPassword("anything", "not-a-bcrypt-hash")).toBe(false);
  });
});
