import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { file } from "./file";

type Snapshot = { runId: string; value: number };

describe("ai.snapshot.file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-snapshot-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips, overwrites, lists and deletes snapshots", async () => {
    const store = file<Snapshot>({ dir: join(dir, "nested") });

    expect(await store.load("run-1")).toBeUndefined();
    expect(await store.list?.()).toEqual([]);

    await store.save({ runId: "run-1", value: 1 });
    await store.save({ runId: "run-1", value: 2 });
    await store.save({ runId: "session:chat/42", value: 3 });

    expect(await store.load("run-1")).toEqual({ runId: "run-1", value: 2 });
    expect(await store.list?.()).toEqual(["run-1", "session:chat/42"]);
    expect(await store.list?.("session:")).toEqual(["session:chat/42"]);

    await store.delete("run-1");
    await store.delete("missing");
    expect(await store.load("run-1")).toBeUndefined();
    expect(store.schema()).toBe("");
  });

  it("keeps every key inside the directory and leaves no temporary files", async () => {
    const store = file<Snapshot>({ dir });

    await store.save({ runId: "../../escape", value: 1 });

    const names = await readdir(dir);
    expect(names).toEqual([`${encodeURIComponent("../../escape")}.json`]);
    expect(JSON.parse(await readFile(join(dir, names[0] ?? ""), "utf8"))).toEqual({
      runId: "../../escape",
      value: 1,
    });
    expect(await store.load("../../escape")).toEqual({ runId: "../../escape", value: 1 });
  });

  it("rejects a missing directory option and an empty key", async () => {
    expect(() => file({ dir: "" })).toThrow(/dir/);
    await expect(file<Snapshot>({ dir }).load("")).rejects.toThrow(/non-empty/);
  });
});
