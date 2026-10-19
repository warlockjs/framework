import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fs, FsTransactionError, type FileTransaction, type WriteDurability } from "../src/index";
import { withTempDir } from "./helpers";

const faults = vi.hoisted(() => ({
  after: undefined as
    | ((target: string, content: string | Buffer) => Promise<void> | void)
    | undefined,
}));
vi.mock("../src/atomic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/atomic")>();
  return {
    ...actual,
    atomicWriteAsync: async (...args: Parameters<typeof actual.atomicWriteAsync>) => {
      await actual.atomicWriteAsync(...args);
      await faults.after?.(args[0], args[1]);
    },
  };
});

const durability: WriteDurability = process.platform === "win32" ? "file" : "full";

const options = () => ({ operationId: "update", durability });
const update = async (tx: FileTransaction) => {
  await tx.write("first", "new-a");
  await tx.write("second", "new-b");
  return { saved: true };
};
const noop = () => undefined;

describe("multi-file transactions", () => {
  let root: string;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ dir: root, cleanup } = await withTempDir());
    await writeFile(path.join(root, "first"), "old-a");
    await writeFile(path.join(root, "second"), "old-b");
  });
  afterEach(async () => {
    faults.after = undefined;
    await cleanup();
  });

  it("reads staged writes/removals and copies buffers without publishing before callback completion", async () => {
    await fs.transaction(
      root,
      async (tx) => {
        const content = Buffer.from("new-a");
        await tx.write("first", content);
        content.fill(0);
        expect(await tx.read("first")).toBe("new-a");
        expect(await readFile(path.join(root, "first"), "utf8")).toBe("old-a");
        await tx.remove("second");
        expect(await tx.read("second")).toBeNull();
        await tx.write("nested/created", "created", { expectedHash: null });
      },
      options(),
    );
    expect(await readFile(path.join(root, "first"), "utf8")).toBe("new-a");
    await expect(readFile(path.join(root, "second"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.inspectTransactions(root)).toMatchObject({ epoch: 1, pending: false });
  });

  it("discards callback failures and rejects non-JSON results before an intent exists", async () => {
    await expect(
      fs.transaction(
        root,
        async (tx) => {
          await tx.write("first", "discarded");
          throw new Error("abort");
        },
        options(),
      ),
    ).rejects.toThrow("abort");
    await expect(
      fs.transaction(root, async () => ({ invalid: undefined }), options()),
    ).rejects.toThrow("JSON");
    expect((await fs.inspectTransactions(root)).operations).toEqual([]);
    expect(await readFile(path.join(root, "first"), "utf8")).toBe("old-a");
  });

  it("checks hashes against original bytes and rejects stale root epochs", async () => {
    await expect(
      fs.transaction(
        root,
        async (tx) => {
          await tx.write("first", "wrong", { expectedHash: fs.hash.string("stale") });
        },
        options(),
      ),
    ).rejects.toMatchObject({ type: "cas-conflict" });
    await fs.transaction(
      root,
      async (tx) => {
        await tx.write("first", "once", { expectedHash: fs.hash.string("old-a") });
        await tx.write("first", "twice", { expectedHash: fs.hash.string("old-a") });
      },
      { ...options(), expectedEpoch: 0 },
    );
    await expect(
      fs.transaction(root, update, { ...options(), operationId: "other", expectedEpoch: 0 }),
    ).rejects.toMatchObject({ type: "cas-conflict" });
    expect(await readFile(path.join(root, "first"), "utf8")).toBe("twice");
  });

  it("replays a historical result without a callback or any atomic writes, even after later commits", async () => {
    const result = await fs.transaction(root, update, options());
    await fs.transaction(
      root,
      async (tx) => {
        await tx.write("first", "later");
      },
      { ...options(), operationId: "later" },
    );
    const callback = vi.fn(update);
    faults.after = () => {
      throw new Error("Replay wrote to disk");
    };
    expect(await fs.transaction(root, callback, { ...options(), expectedEpoch: 0 })).toEqual(
      result,
    );
    expect(callback).not.toHaveBeenCalled();
    expect(await readFile(path.join(root, "first"), "utf8")).toBe("later");
  });

  it.each(["after-intent", "mid-apply", "before-commit", "after-commit"])(
    "recovers %s on the next open and replays the saved result",
    async (point) => {
      let fired = false;
      faults.after = (target, content) => {
        if (fired) return;
        const journal = target.includes(`${path.sep}journal${path.sep}`);
        const trigger =
          (point === "after-intent" && journal && String(content).includes('"phase":"intent"')) ||
          (point === "mid-apply" && target === path.join(root, "first")) ||
          (point === "before-commit" && target === path.join(root, "second")) ||
          (point === "after-commit" && journal && String(content).includes('"phase":"committed"'));
        if (trigger) {
          fired = true;
          throw new Error("simulated process interruption");
        }
      };
      await expect(fs.transaction(root, update, options())).rejects.toMatchObject({
        type: "durability-uncertain",
      });
      expect(fired).toBe(true);
      expect((await fs.inspectTransactions(root)).pending).toBe(true);
      if (point === "after-intent")
        expect(await readFile(path.join(root, "first"), "utf8")).toBe("old-a");
      if (point === "mid-apply") {
        expect(await readFile(path.join(root, "first"), "utf8")).toBe("new-a");
        expect(await readFile(path.join(root, "second"), "utf8")).toBe("old-b");
      }
      faults.after = undefined;
      const store = await fs.openTransactions(root, { durability });
      expect(await store.readMany(["first", "second"], { consistent: true })).toEqual([
        "new-a",
        "new-b",
      ]);
      const callback = vi.fn(update);
      expect(await store.transaction(callback, { operationId: "update" })).toEqual({ saved: true });
      expect(callback).not.toHaveBeenCalled();
      expect(await store.inspect()).toMatchObject({ epoch: 1, pending: false });
    },
  );

  it.each(["intent", "committed"])(
    "reflushes a visible %s journal before repairing the head",
    async (phase) => {
      faults.after = (target, content) => {
        if (
          target.includes(`${path.sep}journal${path.sep}`) &&
          String(content).includes(`"phase":"${phase}"`)
        ) {
          throw new Error("journal directory flush uncertain");
        }
      };
      await expect(fs.transaction(root, update, options())).rejects.toMatchObject({
        type: "durability-uncertain",
      });
      const publications: string[] = [];
      faults.after = (target, content) => {
        if (target.includes(`${path.sep}journal${path.sep}`)) {
          publications.push(String(content).includes('"phase":"intent"') ? "intent" : "committed");
        }
        if (target.endsWith(`${path.sep}head.json`)) publications.push("head");
      };
      await fs.openTransactions(root, { durability });
      expect(publications[0]).toBe(phase);
      expect(publications.at(-1)).toBe("head");
      expect((await fs.inspectTransactions(root)).pending).toBe(false);
    },
  );

  it("preserves a recovery hold when a file contains foreign bytes", async () => {
    faults.after = (target) => {
      if (target === path.join(root, "first")) throw new Error("interrupted");
    };
    await expect(fs.transaction(root, update, options())).rejects.toBeInstanceOf(
      FsTransactionError,
    );
    faults.after = undefined;
    await writeFile(path.join(root, "first"), "foreign");
    await expect(fs.openTransactions(root, { durability })).rejects.toMatchObject({
      type: "recovery-conflict",
    });
    expect(await readFile(path.join(root, "first"), "utf8")).toBe("foreign");
    expect(await readFile(path.join(root, "second"), "utf8")).toBe("old-b");
    expect((await fs.inspectTransactions(root)).pending).toBe(true);
  });

  it("replays without writes while a later operation has a busy head", async () => {
    await fs.transaction(root, update, options());
    let entered: () => void = noop;
    let release: () => void = noop;
    const applying = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    faults.after = async (target) => {
      writes++;
      if (target === path.join(root, "first")) {
        entered();
        await gate;
      }
    };
    const later = fs.transaction(
      root,
      async (tx) => {
        await tx.write("first", "later");
      },
      { ...options(), operationId: "later-busy" },
    );
    try {
      await applying;
      const before = writes;
      expect(await fs.transaction(root, update, options())).toEqual({ saved: true });
      expect(writes).toBe(before);
    } finally {
      release();
      await later;
    }
  });

  it("recovery can itself be interrupted and preserves creation/removal images", async () => {
    await writeFile(path.join(root, "removed"), "original");
    faults.after = (target) => {
      if (target === path.join(root, "created")) throw new Error("interrupted");
    };
    await expect(
      fs.transaction(
        root,
        async (tx) => {
          await tx.write("created", "saved", { expectedHash: null });
          await tx.remove("removed");
        },
        options(),
      ),
    ).rejects.toMatchObject({ type: "durability-uncertain" });
    await expect(fs.openTransactions(root, { durability })).rejects.toThrow("interrupted");
    faults.after = undefined;
    await fs.openTransactions(root, { durability });
    expect(await readFile(path.join(root, "created"), "utf8")).toBe("saved");
    await expect(readFile(path.join(root, "removed"))).rejects.toMatchObject({ code: "ENOENT" });
    const callback = vi.fn(async () => undefined);
    expect(await fs.transaction(root, callback, options())).toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
  });

  it("serializes concurrent writers and coalesces concurrent replay keys", async () => {
    await writeFile(path.join(root, "count"), "0");
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        fs.transaction(
          root,
          async (tx) => {
            const count = Number(await tx.read("count"));
            await tx.write("count", String(count + 1));
          },
          { ...options(), operationId: `increment-${index}` },
        ),
      ),
    );
    expect(await readFile(path.join(root, "count"), "utf8")).toBe("8");
    const callback = vi.fn(update);
    await Promise.all([
      fs.transaction(root, callback, options()),
      fs.transaction(root, callback, options()),
    ]);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("allows only one concurrent CAS writer to use an epoch", async () => {
    const outcomes = await Promise.allSettled(
      ["one", "two"].map((id) =>
        fs.transaction(root, update, { ...options(), operationId: id, expectedEpoch: 0 }),
      ),
    );
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toMatchObject([
      { reason: { type: "cas-conflict" } },
    ]);
  });

  it("refuses path escapes, portable aliases and conflicting file/parent writes before journaling", async () => {
    for (const input of [
      "../outside",
      "/absolute",
      ".warlock-transactions/head.json",
      "CON",
      "name.",
    ]) {
      await expect(
        fs.transaction(
          root,
          async (tx) => {
            await tx.write(input, "no");
          },
          options(),
        ),
      ).rejects.toThrow();
    }
    await expect(
      fs.transaction(
        root,
        async (tx) => {
          await tx.write("new", "file");
          await tx.write("new/child", "file");
        },
        options(),
      ),
    ).rejects.toThrow("distinct files");
    expect((await fs.inspectTransactions(root)).operations).toEqual([]);
  });

  it("refuses broken history instead of manufacturing a fresh epoch", async () => {
    await fs.transaction(root, update, options());
    const directory = path.join(root, ".warlock-transactions", "journal");
    const [name] = await readdir(directory);
    if (!name) throw new Error("Missing journal");
    await writeFile(path.join(directory, name), '{"version":999}');
    await expect(fs.openTransactions(root, { durability })).rejects.toMatchObject({
      type: "invalid-journal",
    });
  });
});
