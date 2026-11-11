import crypto from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { storageDriverContext } from "../context/storage-driver-context";
import { LocalDriver } from "./local-driver";

/**
 * Local temporary-URL tokens open exactly the file they were issued for: the
 * storage prefix (tenant) is part of the signed path, and the payload types
 * are checked.
 */
const signatureKey = "test-signature-key-please-change";
const roots: string[] = [];
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "warlock-temp-token-"));
  roots.push(root);
});

afterAll(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Run `callback` with `prefix` as the storage context prefix (a tenant). */
function asTenant<T>(prefix: string, callback: () => Promise<T>): Promise<T> {
  return storageDriverContext.run({ driver: undefined, prefix, metadata: undefined }, callback);
}

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

describe("LocalDriver temporary tokens and storage prefixes", () => {
  it("does not open another tenant's file at the same relative path", async () => {
    const driver = new LocalDriver({ root, signatureKey });

    const token = await asTenant("t1", async () => {
      await driver.put(Buffer.from("tenant one"), "invoices/2026-11.pdf");
      return driver.encodeTemporaryToken("invoices/2026-11.pdf", 3600);
    });

    await asTenant("t2", () => driver.put(Buffer.from("tenant two"), "invoices/2026-11.pdf"));

    const fromOtherTenant = await asTenant("t2", () => driver.validateTemporaryToken(token));

    expect(fromOtherTenant.valid).toBe(false);
    expect(fromOtherTenant.error).toBe("invalid_token");
  });

  it("opens the issuing tenant's file and reports the path relative to the prefix", async () => {
    const driver = new LocalDriver({ root, signatureKey });

    const validation = await asTenant("t1", async () => {
      await driver.put(Buffer.from("tenant one"), "invoices/2026-11.pdf");
      const token = driver.encodeTemporaryToken("invoices/2026-11.pdf", 3600);

      return driver.validateTemporaryToken(token);
    });

    expect(validation.valid).toBe(true);
    expect(validation.path).toBe("invoices/2026-11.pdf");
    expect(validation.absolutePath).toBe(join(root, "t1", "invoices", "2026-11.pdf"));
    expect((await asTenant("t1", () => validation.getFile!())).toString()).toBe("tenant one");
  });

  it("refuses a token issued before tokens carried a version", async () => {
    const driver = new LocalDriver({ root, signatureKey });
    await driver.put(Buffer.from("secret"), "doc.txt");

    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = crypto.createHmac("sha256", signatureKey).update(`doc.txt:${exp}`).digest("hex");

    const validation = await driver.validateTemporaryToken(encode({ path: "doc.txt", exp, sig }));

    expect(validation).toEqual({ valid: false, error: "invalid_token" });
  });

  it.each([
    ["a string exp", { v: 2, path: "doc.txt", exp: "9999999999", sig: "a".repeat(64) }],
    ["a non-integer exp", { v: 2, path: "doc.txt", exp: 1.5, sig: "a".repeat(64) }],
    ["a non-string path", { v: 2, path: ["doc.txt"], exp: 9999999999, sig: "a".repeat(64) }],
    ["a malformed signature", { v: 2, path: "doc.txt", exp: 9999999999, sig: "zz" }],
  ])("refuses a payload with %s", async (_label, payload) => {
    const driver = new LocalDriver({ root, signatureKey });
    await driver.put(Buffer.from("secret"), "doc.txt");

    const validation = await driver.validateTemporaryToken(encode(payload));

    expect(validation).toEqual({ valid: false, error: "invalid_token" });
  });

  it("does not accept a signature re-split between path and expiry", async () => {
    const driver = new LocalDriver({ root, signatureKey });
    await driver.put(Buffer.from("secret"), "a");

    const token = JSON.parse(
      Buffer.from(driver.encodeTemporaryToken("a:1700000000", 3600), "base64url").toString(),
    );

    const forged = encode({ ...token, path: "a", exp: `1700000000:${token.exp}` });

    expect((await driver.validateTemporaryToken(forged)).valid).toBe(false);
  });
});
