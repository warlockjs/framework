import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteFile, type AtomicWriteFileDeps } from "../src/atomic-write-file";

describe("atomicWriteFile", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("creates the target with the given content when nothing exists yet", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const filePath = join(dir, "sitemap.xml");

    await atomicWriteFile(filePath, "<a/>");

    expect(await readFile(filePath, "utf8")).toBe("<a/>");
  });

  it("replaces existing content on the success path", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const filePath = join(dir, "sitemap.xml");

    await writeFile(filePath, "<old/>", "utf8");
    await atomicWriteFile(filePath, "<new/>");

    expect(await readFile(filePath, "utf8")).toBe("<new/>");
  });

  it("leaves no temp files behind after a successful write", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const filePath = join(dir, "sitemap.xml");

    await atomicWriteFile(filePath, "<a/>");

    const entries = await readdir(dir);

    expect(entries).toEqual(["sitemap.xml"]);
  });

  it("generates a distinct temp name per call, so concurrent writers never collide", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const seen = new Set<string>();

    const deps: AtomicWriteFileDeps = {
      writeFile: (async (path: string, content: string, encoding: BufferEncoding) => {
        expect(seen.has(path)).toBe(false);
        seen.add(path);

        return writeFile(path, content, encoding);
      }) as typeof writeFile,
      rename: (await import("node:fs/promises")).rename,
      rm: (await import("node:fs/promises")).rm,
    };

    const filePath = join(dir, "sitemap.xml");

    await Promise.all([
      atomicWriteFile(filePath, "<a/>", deps),
      atomicWriteFile(join(dir, "other.xml"), "<b/>", deps),
    ]);

    expect(seen.size).toBe(2);
  });

  it("leaves an existing target byte-for-byte untouched when the write fails", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const filePath = join(dir, "sitemap.xml");

    await writeFile(filePath, "<untouched/>", "utf8");

    const { rename, rm } = await import("node:fs/promises");

    await expect(
      atomicWriteFile(filePath, "<new/>", {
        writeFile: async () => {
          throw new Error("disk full");
        },
        rename,
        rm,
      }),
    ).rejects.toThrow("disk full");

    expect(await readFile(filePath, "utf8")).toBe("<untouched/>");
  });

  it("leaves an existing target byte-for-byte untouched when the rename fails", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const filePath = join(dir, "sitemap.xml");

    await writeFile(filePath, "<untouched/>", "utf8");

    const { writeFile: realWriteFile, rm } = await import("node:fs/promises");

    await expect(
      atomicWriteFile(filePath, "<new/>", {
        writeFile: realWriteFile,
        rename: async () => {
          throw new Error("permission denied");
        },
        rm,
      }),
    ).rejects.toThrow("permission denied");

    expect(await readFile(filePath, "utf8")).toBe("<untouched/>");
  });

  it("removes the temp file after a failed write", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const filePath = join(dir, "sitemap.xml");

    const { rename, rm } = await import("node:fs/promises");

    await expect(
      atomicWriteFile(filePath, "<new/>", {
        writeFile: async () => {
          throw new Error("disk full");
        },
        rename,
        rm,
      }),
    ).rejects.toThrow();

    expect(await readdir(dir)).toEqual([]);
  });

  it("removes the temp file after a failed rename", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const filePath = join(dir, "sitemap.xml");

    const { writeFile: realWriteFile } = await import("node:fs/promises");

    await expect(
      atomicWriteFile(filePath, "<new/>", {
        writeFile: realWriteFile,
        rename: async () => {
          throw new Error("permission denied");
        },
        rm: async () => undefined,
      }),
    ).rejects.toThrow();
  });

  it("retries a transient EPERM/EBUSY rename before giving up, then succeeds", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const filePath = join(dir, "sitemap.xml");

    const { writeFile: realWriteFile, rename: realRename, rm } = await import("node:fs/promises");

    let calls = 0;

    await atomicWriteFile(filePath, "<retried/>", {
      writeFile: realWriteFile,
      rename: async (from, to) => {
        calls += 1;

        if (calls < 3) {
          const error = new Error("busy") as NodeJS.ErrnoException;
          error.code = "EBUSY";
          throw error;
        }

        return realRename(from, to);
      },
      rm,
    });

    expect(calls).toBe(3);
    expect(await readFile(filePath, "utf8")).toBe("<retried/>");
  });

  it("does not retry a non-transient rename error", async () => {
    dir = await mkdtemp(join(tmpdir(), "warlock-atomic-"));

    const filePath = join(dir, "sitemap.xml");

    const { writeFile: realWriteFile, rm } = await import("node:fs/promises");

    let calls = 0;

    await expect(
      atomicWriteFile(filePath, "<x/>", {
        writeFile: realWriteFile,
        rename: async () => {
          calls += 1;

          const error = new Error("no such file") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        },
        rm,
      }),
    ).rejects.toThrow("no such file");

    expect(calls).toBe(1);
  });
});
