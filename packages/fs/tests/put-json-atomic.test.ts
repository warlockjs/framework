import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { putJsonFile, putJsonFileAsync } from "../src/write";

describe("putJsonFile / putJsonFileAsync", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "fs-put-json-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("never exposes a partial file to a concurrent reader", async () => {
    const file = path.join(dir, "state.json");
    const big = { items: Array.from({ length: 20_000 }, (_, index) => ({ index })) };

    putJsonFile(file, big);

    let failures = 0;
    let writing = true;
    const reader = (async () => {
      while (writing) {
        try {
          JSON.parse(readFileSync(file, "utf-8"));
        } catch {
          failures++;
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    for (let round = 0; round < 15; round++) {
      await putJsonFileAsync(file, { ...big, round });
    }

    writing = false;
    await reader;

    expect(failures).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf-8")).round).toBe(14);
  });

  it("leaves no temporary files behind and creates missing folders", async () => {
    await putJsonFileAsync(path.join(dir, "a/b/one.json"), { ok: true });
    putJsonFile(path.join(dir, "a/b/two.json"), { ok: true });

    expect(readdirSync(path.join(dir, "a/b")).sort()).toEqual(["one.json", "two.json"]);
  });
});
