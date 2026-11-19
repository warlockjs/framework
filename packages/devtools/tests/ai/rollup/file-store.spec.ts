import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFileAiRollupStore } from "../../../src/ai/rollup/file-store";
import { DevtoolsAiRollupIncrementError } from "../../../src/ai/rollup/increment-error";
import { ALL_TIME, deltaFor, describeAiRollupStoreContract } from "./store-contract";
import { HOUR_START } from "./helpers";

const folders: string[] = [];

async function freshFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(os.tmpdir(), "devtools-ai-rollups-"));

  folders.push(folder);

  return folder;
}

afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

describeAiRollupStoreContract("file", async () =>
  createFileAiRollupStore({ directory: path.join(await freshFolder(), "nested", "ai-rollups") }),
);

describe("file ai rollup store", () => {
  it("writes one JSON file per UTC day and no temporary file stays", async () => {
    const directory = await freshFolder();
    const store = createFileAiRollupStore({ directory });

    await store.increment([deltaFor(HOUR_START)]);

    expect(await readdir(directory)).toEqual(["2026-06-22.json"]);
    expect(
      JSON.parse(await readFile(path.join(directory, "2026-06-22.json"), "utf8")),
    ).toHaveLength(1);
  });

  it("verify creates the folder", async () => {
    const directory = path.join(await freshFolder(), "made");

    expect(await createFileAiRollupStore({ directory }).verify()).toBe(true);
    expect(await readdir(directory)).toEqual([]);
  });

  it("renames a corrupt file and starts over", async () => {
    const directory = await freshFolder();
    const store = createFileAiRollupStore({ directory, now: () => 123 });

    await writeFile(path.join(directory, "2026-06-22.json"), "{not json", "utf8");
    await store.increment([deltaFor(HOUR_START)]);

    expect((await readdir(directory)).sort()).toEqual([
      "2026-06-22.json",
      "2026-06-22.json.corrupt-123",
    ]);
    expect(await store.list(ALL_TIME)).toHaveLength(1);
  });

  it("does not lose adds that run at the same time", async () => {
    const store = createFileAiRollupStore({ directory: await freshFolder() });

    await Promise.all([1, 2, 3, 4, 5].map(() => store.increment([deltaFor(HOUR_START)])));

    expect((await store.list(ALL_TIME))[0].runs).toBe(5);
  });

  it("reports the deltas of a day it could not write and keeps the other days saved", async () => {
    const directory = await freshFolder();
    const store = createFileAiRollupStore({ directory });
    const nextDay = HOUR_START + 24 * 3_600_000;

    // A folder where the next day's temporary file goes makes that day's write fail.
    await mkdir(path.join(directory, `2026-06-23.json.tmp-${process.pid}`), { recursive: true });

    const failure = await store.increment([deltaFor(HOUR_START), deltaFor(nextDay)]).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(DevtoolsAiRollupIncrementError);
    expect(
      (failure as DevtoolsAiRollupIncrementError).unwritten.map((delta) => delta.hour),
    ).toEqual([nextDay]);
    expect((await store.list(ALL_TIME)).map((record) => record.hour)).toEqual([HOUR_START]);
  });
});
