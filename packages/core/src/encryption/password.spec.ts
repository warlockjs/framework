import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import bcryptjs from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "./password";

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
