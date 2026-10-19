import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { atomicWriteAsync } from "../src/atomic";
import { withTempDir } from "./helpers";

const events = vi.hoisted(() => ({
  steps: [] as string[],
  directories: [] as string[],
  failDirectory: false,
  failFile: false,
  failAtDirectory: undefined as string | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const directory = args[1] === "r";
      return new Proxy(handle, {
        get(target, property) {
          if (property === "sync")
            return async () => {
              events.steps.push(directory ? "directory-sync" : "file-sync");
              if (directory) events.directories.push(String(args[0]));
              if (directory && args[0] === events.failAtDirectory) {
                events.failAtDirectory = undefined;
                throw new Error("directory chain interrupted");
              }
              if (
                (directory && events.failDirectory && events.steps.includes("rename")) ||
                (!directory && events.failFile)
              )
                throw new Error("sync failed");
              await target.sync();
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      events.steps.push("rename");
      await actual.rename(...args);
    },
  };
});

afterEach(() => {
  events.steps = [];
  events.failDirectory = false;
  events.failFile = false;
  events.directories = [];
  events.failAtDirectory = undefined;
});

describe("atomic write durability ordering", () => {
  it.skipIf(process.platform === "win32")(
    "syncs file bytes before rename and the directory afterward",
    async () => {
      const { dir, cleanup } = await withTempDir();
      try {
        await atomicWriteAsync(path.join(dir, "file"), "saved", { durability: "full" });
        expect(events.steps.slice(-3)).toEqual(["file-sync", "rename", "directory-sync"]);
      } finally {
        await cleanup();
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "resyncs existing parent chains left by an interrupted mkdir attempt",
    async () => {
      const { dir, cleanup } = await withTempDir();
      try {
        const parent = path.join(dir, "new", "nested");
        const file = path.join(parent, "file");
        events.failAtDirectory = parent;
        await expect(atomicWriteAsync(file, "saved", { durability: "full" })).rejects.toThrow(
          "directory chain interrupted",
        );
        events.directories = [];
        await atomicWriteAsync(file, "saved", { durability: "full" });
        expect(events.directories).toContain(parent);
        expect(events.directories).toContain(path.dirname(parent));
        expect(events.directories).toContain(dir);
        expect(await readFile(file, "utf8")).toBe("saved");
      } finally {
        await cleanup();
      }
    },
  );

  it("keeps old bytes when file sync fails before rename", async () => {
    const { dir, cleanup } = await withTempDir();
    try {
      const file = path.join(dir, "file");
      await atomicWriteAsync(file, "old");
      events.steps = [];
      events.failFile = true;
      await expect(atomicWriteAsync(file, "new", { durability: "file" })).rejects.toThrow(
        "sync failed",
      );
      expect(await readFile(file, "utf8")).toBe("old");
      expect(events.steps).toEqual(["file-sync"]);
    } finally {
      await cleanup();
    }
  });

  it.skipIf(process.platform === "win32")(
    "reports directory-sync uncertainty after a successful rename",
    async () => {
      const { dir, cleanup } = await withTempDir();
      try {
        events.failDirectory = true;
        await expect(
          atomicWriteAsync(path.join(dir, "file"), "new", { durability: "full" }),
        ).rejects.toThrow("sync failed");
        expect(await readFile(path.join(dir, "file"), "utf8")).toBe("new");
      } finally {
        await cleanup();
      }
    },
  );

  it.skipIf(process.platform !== "win32")(
    "requires explicit file-only durability on Windows",
    async () => {
      const { dir, cleanup } = await withTempDir();
      try {
        await expect(
          atomicWriteAsync(path.join(dir, "file"), "new", { durability: "full" }),
        ).rejects.toThrow("Windows");
        expect(events.steps).toEqual([]);
      } finally {
        await cleanup();
      }
    },
  );
});
