import config from "@mongez/config";
import bcryptjs from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { isPasswordHash, verifyPassword } from "../encryption/password";
import { useHashedPassword } from "./utils";

function run(transformer: any, value: string, isNew = true) {
  const model = { isDirty: () => true, isNew };

  return transformer(value, { context: { rootContext: { model }, key: "password" } });
}

beforeEach(() => {
  config.set("encryption.password.salt", 4);
});

describe("useHashedPassword", () => {
  it("hashes a value that already is a hash by default", async () => {
    const existing = await bcryptjs.hash("secret-pass", 4);
    const stored = await run(useHashedPassword(), existing);

    expect(stored).not.toBe(existing);
    expect(await verifyPassword("secret-pass", stored)).toBe(false);
  });

  it("keeps a supported hash with keepHashes and still verifies the original password", async () => {
    const existing = await bcryptjs.hash("secret-pass", 4);
    const stored = await run(useHashedPassword({ keepHashes: true }), existing);

    expect(stored).toBe(existing);
    expect(await verifyPassword("secret-pass", stored)).toBe(true);
  });

  it("keeps a scrypt hash with keepHashes", async () => {
    const scrypt = "$scrypt$N=1024,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaGhhc2hoYXNoaGFzaA==";

    expect(await run(useHashedPassword({ keepHashes: true }), scrypt)).toBe(scrypt);
  });

  it("hashes a plain password with keepHashes", async () => {
    const stored = await run(useHashedPassword({ keepHashes: true }), "plain-pass");

    expect(stored).not.toBe("plain-pass");
    expect(await verifyPassword("plain-pass", stored)).toBe(true);
  });
});

describe("isPasswordHash", () => {
  it("recognises bcrypt and scrypt hashes only", async () => {
    expect(isPasswordHash(await bcryptjs.hash("x", 4))).toBe(true);
    expect(isPasswordHash("$scrypt$N=1024,r=8,p=1$c2FsdA==$aGFzaA==")).toBe(true);
    expect(isPasswordHash("plain")).toBe(false);
    expect(isPasswordHash("$2b$04$short")).toBe(false);
    expect(isPasswordHash("")).toBe(false);
    expect(isPasswordHash(undefined)).toBe(false);
  });
});
