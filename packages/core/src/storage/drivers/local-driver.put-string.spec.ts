import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDriver } from "./local-driver";

describe("LocalDriver.put() with a string", () => {
  let root: string;
  let driver: LocalDriver;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "put-string-"));
    driver = new LocalDriver({ root });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("stores the literal string even when it equals an existing file path", async () => {
    const secret = path.join(root, "secret.env");
    fs.writeFileSync(secret, "TOP_SECRET=1");

    await driver.put(secret, "notes/1.txt");

    expect(fs.readFileSync(path.join(root, "notes/1.txt"), "utf8")).toBe(secret);
  });
});
