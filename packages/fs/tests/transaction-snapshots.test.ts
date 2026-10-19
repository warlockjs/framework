import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fs, type WriteDurability } from "../src/index";
import { withTempDir } from "./helpers";

const race = vi.hoisted(() => ({
  afterRead: undefined as ((file: string) => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const result = await actual.readFile(...args).then(
        (value) => ({ type: "value" as const, value }),
        (error: unknown) => ({ type: "error" as const, error }),
      );
      if (typeof args[0] === "string") await race.afterRead?.(args[0]);
      if (result.type === "error") throw result.error;
      return result.value;
    },
  };
});

const durability: WriteDurability = process.platform === "win32" ? "file" : "full";

describe("bounded consistent transaction reads", () => {
  let root: string;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ dir: root, cleanup } = await withTempDir());
    await writeFile(path.join(root, "first"), "old");
    await writeFile(path.join(root, "second"), "old");
    await fs.openTransactions(root, { durability });
  });
  afterEach(async () => {
    race.afterRead = undefined;
    await cleanup();
  });

  it("retries a read when the epoch changes after its bytes were captured", async () => {
    race.afterRead = async (file) => {
      if (file !== path.join(root, "first")) return;
      race.afterRead = undefined;
      await fs.transaction(
        root,
        async (tx) => {
          await tx.write("first", "new");
        },
        { durability },
      );
    };
    expect(await fs.read("first", { root, consistent: true })).toBe("new");
  });

  it("brackets all files in readMany with the same epoch", async () => {
    const store = await fs.openTransactions(root, { durability });
    race.afterRead = async (file) => {
      if (file !== path.join(root, "first")) return;
      race.afterRead = undefined;
      await store.transaction(async (tx) => {
        await tx.write("first", "new");
        await tx.write("second", "new");
      });
    };
    expect(await store.readMany(["first", "second"], { consistent: true })).toEqual(["new", "new"]);
  });

  it("retries a transient ENOENT caused by a changed snapshot", async () => {
    race.afterRead = async (file) => {
      if (file !== path.join(root, "created")) return;
      race.afterRead = undefined;
      await fs.transaction(
        root,
        async (tx) => {
          await tx.write("created", "now-present");
        },
        { durability },
      );
    };
    expect(await fs.read("created", { root, consistent: true })).toBe("now-present");
    await expect(fs.read("missing", { root, consistent: true })).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stops after the configured attempts when each snapshot races a writer", async () => {
    let reads = 0;
    const install = () => {
      race.afterRead = async (file) => {
        if (file !== path.join(root, "first")) return;
        race.afterRead = undefined;
        reads++;
        await fs.transaction(
          root,
          async (tx) => {
            await tx.write("first", String(reads));
          },
          { durability },
        );
        install();
      };
    };
    install();
    await expect(
      fs.read("first", { root, consistent: true, attempts: 3, retryDelayMs: 0 }),
    ).rejects.toMatchObject({ type: "snapshot-changed" });
    expect(reads).toBe(3);
  });

  it("requires explicit root scope and validates retry bounds", async () => {
    await expect(fs.read("first", { consistent: true })).rejects.toThrow("root");
    await expect(fs.read("first", { root, consistent: true, attempts: 0 })).rejects.toThrow(
      "bounds",
    );
  });
});
