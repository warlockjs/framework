import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import bcryptjs from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "./password";

/**
 * Stands in for the optional native `bcrypt` module (not installed in this
 * repository). It delegates to bcryptjs so hashes are real.
 */
const native = vi.hoisted(() => ({
  hash: vi.fn(),
  compare: vi.fn(),
}));

vi.mock("bcrypt", async () => {
  const js = (await import("bcryptjs")).default;

  native.hash.mockImplementation((password: string, rounds: number) => js.hash(password, rounds));
  native.compare.mockImplementation((password: string, hash: string) => js.compare(password, hash));

  return { default: native };
});

beforeEach(() => {
  config.set("encryption.password.salt", 4);
  config.set("encryption.password.rejectLongPasswords", false);
  config.set("encryption.password.driver", undefined);
  config.set("encryption.password.scrypt", { cost: 1024 });
  native.hash.mockClear();
  native.compare.mockClear();
});

describe("password hashing backend", () => {
  it("hashes with the native bcrypt module when it is installed", async () => {
    const hash = await hashPassword("s3cret-pass");

    expect(native.hash).toHaveBeenCalledTimes(1);
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
    expect(native.compare).toHaveBeenCalledTimes(1);
  });

  it("verifies a bcryptjs hash through the native module, and the other way round", async () => {
    const fromJs = await bcryptjs.hash("interop", 4);
    const fromNative = await hashPassword("interop");

    expect(await verifyPassword("interop", fromJs)).toBe(true);
    expect(await bcryptjs.compare("interop", fromNative)).toBe(true);
  });

  it("verifies a $2y$ hash with bcryptjs instead of the native module", async () => {
    const hash = (await bcryptjs.hash("legacy", 4)).replace(/^\$2b\$/, "$2y$");

    expect(await verifyPassword("legacy", hash)).toBe(true);
    expect(native.compare).not.toHaveBeenCalled();
  });

  it("returns false for a value that is not a bcrypt hash", async () => {
    expect(await verifyPassword("anything", "not-a-bcrypt-hash")).toBe(false);
  });
});

describe("passwords longer than 72 bytes", () => {
  it("hashes them and logs a single warning by default", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined as never);

    await hashPassword("é".repeat(40));
    await hashPassword("x".repeat(100));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[2])).toContain("rejectLongPasswords");
    expect(String(warn.mock.calls[0]?.[2])).not.toContain("é");

    warn.mockRestore();
  });

  it("refuses them when encryption.password.rejectLongPasswords is on", async () => {
    config.set("encryption.password.rejectLongPasswords", true);

    await expect(hashPassword("é".repeat(40))).rejects.toThrow("Password is too long");
    await expect(hashPassword("a".repeat(72))).resolves.toMatch(/^\$2[ab]\$/);
  });
});

describe("scrypt driver", () => {
  beforeEach(() => {
    config.set("encryption.password.driver", "scrypt");
  });

  it("hashes with scrypt and verifies the right password only", async () => {
    const hash = await hashPassword("s3cret-pass");

    expect(hash).toMatch(/^\$scrypt\$N=1024,r=8,p=1\$/);
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
    expect(await verifyPassword("s3cret-pasS", hash)).toBe(false);
    expect(native.hash).not.toHaveBeenCalled();
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("does not stop at 72 bytes", async () => {
    const long = "a".repeat(80);
    const hash = await hashPassword(long);

    expect(await verifyPassword(`${"a".repeat(72)}b`, hash)).toBe(false);
    expect(await verifyPassword(long, hash)).toBe(true);
  });

  it("rejects a malformed or tampered scrypt hash", async () => {
    const hash = await hashPassword("tamper");

    expect(await verifyPassword("tamper", "$scrypt$garbage")).toBe(false);
    expect(await verifyPassword("tamper", hash.slice(0, -6) + "AAAAAA")).toBe(false);
    expect(await verifyPassword("tamper", "$scrypt$N=3,r=8,p=1$AAAA$AAAA")).toBe(false);
  });

  it("verifies a bcrypt hash while scrypt is the driver", async () => {
    const bcryptHash = await bcryptjs.hash("older", 4);

    expect(await verifyPassword("older", bcryptHash)).toBe(true);
    expect(await verifyPassword("other", bcryptHash)).toBe(false);
  });

  it("verifies a scrypt hash after switching back to bcrypt", async () => {
    const hash = await hashPassword("roundabout");

    config.set("encryption.password.driver", undefined);

    expect(await verifyPassword("roundabout", hash)).toBe(true);
  });
});

describe("needsRehash()", () => {
  it("is false for a bcrypt hash at the configured cost", async () => {
    expect(needsRehash(await hashPassword("x"))).toBe(false);
  });

  it("is true for a bcrypt hash at another cost", async () => {
    expect(needsRehash(await bcryptjs.hash("x", 5))).toBe(true);
  });

  it("is true for a bcrypt hash when scrypt is the driver, and the other way round", async () => {
    const bcryptHash = await hashPassword("x");

    config.set("encryption.password.driver", "scrypt");
    const scryptHash = await hashPassword("x");

    expect(needsRehash(bcryptHash)).toBe(true);
    expect(needsRehash(scryptHash)).toBe(false);

    config.set("encryption.password.driver", undefined);
    expect(needsRehash(scryptHash)).toBe(true);
  });

  it("is true for a scrypt hash made with other parameters", async () => {
    config.set("encryption.password.driver", "scrypt");
    const hash = await hashPassword("x");

    config.set("encryption.password.scrypt", { cost: 2048 });

    expect(needsRehash(hash)).toBe(true);
  });

  it("is false for a value in no known format", () => {
    expect(needsRehash("not-a-hash")).toBe(false);
    expect(needsRehash("")).toBe(false);
  });
});
