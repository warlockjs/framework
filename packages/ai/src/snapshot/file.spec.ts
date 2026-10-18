import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { file } from "./file";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, writeFile: vi.fn(fs.writeFile), rename: vi.fn(fs.rename) };
});

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

  it.skipIf(process.platform === "win32")(
    "keeps the temporary file private from creation through rename",
    async () => {
      const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      const previous = process.umask(0);

      try {
        vi.mocked(writeFile).mockImplementationOnce(async (path, data, options) => {
          expect(options).toMatchObject({ mode: 0o600, flag: "wx" });
          await fs.writeFile(path, data, options);
          expect((await stat(String(path))).mode & 0o777).toBe(0o600);
        });
        vi.mocked(rename).mockImplementationOnce(async (source, target) => {
          expect((await stat(source)).mode & 0o777).toBe(0o600);
          await fs.rename(source, target);
        });

        await file<Snapshot>({ dir }).save({ runId: "private", value: 1 });
      } finally {
        process.umask(previous);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "creates private directories and files under umask 0",
    async () => {
      const previous = process.umask(0);

      try {
        const nested = join(dir, "parent", "snapshots");
        const store = file<Snapshot>({ dir: nested });
        await store.save({ runId: "private", value: 1 });

        expect((await stat(join(dir, "parent"))).mode & 0o777).toBe(0o700);
        expect((await stat(nested)).mode & 0o777).toBe(0o700);
        expect((await stat(join(nested, "private.json"))).mode & 0o777).toBe(0o600);
      } finally {
        process.umask(previous);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "preserves existing directories and makes rewritten files private",
    async () => {
      await chmod(dir, 0o755);
      const target = join(dir, "existing.json");
      await writeFile(target, "{}", { mode: 0o644 });
      await chmod(target, 0o644);

      await file<Snapshot>({ dir }).save({ runId: "existing", value: 2 });

      expect((await stat(dir)).mode & 0o777).toBe(0o755);
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === "win32")(
    "honours custom modes without changing an existing parent",
    async () => {
      const previous = process.umask(0);

      try {
        await chmod(dir, 0o711);
        const nested = join(dir, "shared");
        await file<Snapshot>({ dir: nested, dirMode: 0o750, fileMode: 0o640 }).save({
          runId: "custom",
          value: 1,
        });
        expect((await stat(dir)).mode & 0o777).toBe(0o711);
        expect((await stat(nested)).mode & 0o777).toBe(0o750);
        expect((await stat(join(nested, "custom.json"))).mode & 0o777).toBe(0o640);
      } finally {
        process.umask(previous);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "restores exact file modes even when umask removes owner bits",
    async () => {
      const nested = join(dir, "restrictive");
      await mkdir(nested, { mode: 0o700 });
      const previous = process.umask(0o777);

      try {
        const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        vi.mocked(rename).mockImplementationOnce(async (source, target) => {
          expect((await stat(source)).mode & 0o777).toBe(0o600);
          await fs.rename(source, target);
        });
        await file<Snapshot>({ dir: nested }).save({ runId: "private", value: 1 });
        expect((await stat(join(nested, "private.json"))).mode & 0o777).toBe(0o600);
        await file<Snapshot>({ dir: nested, fileMode: 0o640 }).save({ runId: "custom", value: 1 });
        expect((await stat(join(nested, "custom.json"))).mode & 0o777).toBe(0o640);
      } finally {
        process.umask(previous);
      }
    },
  );

  it.each([0o702, 0o720, 0o777, -1, 0o1000, 1.5, NaN, Infinity])(
    "refuses unsafe or invalid modes: %s",
    (mode) => {
      expect(() => file({ dir, dirMode: mode })).toThrow(/dirMode/);
      expect(() => file({ dir, fileMode: mode })).toThrow(/fileMode/);
    },
  );

  it("rejects a missing directory option and an empty key", async () => {
    expect(() => file({ dir: "" })).toThrow(/dir/);
    await expect(file<Snapshot>({ dir }).load("")).rejects.toThrow(/non-empty/);
  });
});
