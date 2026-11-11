import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createLocalBackend } from "./backends/local";
import { createMockBackend } from "./backends/mock";
import { createOps } from "./ops";
import type { WorkspaceBackend, WorkspaceOps, WorkspacePolicy } from "./contracts";

let jailRoot: string;
let outside: string;

beforeAll(() => {
  jailRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-spill-")));
  outside = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-spill-out-")));
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(
  policy: Partial<WorkspacePolicy>,
  seed?: { files?: Record<string, string>; commands?: Record<string, { stdout: string }> },
): { backend: WorkspaceBackend; ops: WorkspaceOps } {
  const backend = createMockBackend(seed);

  return {
    backend,
    ops: createOps(backend, { cwd: jailRoot, shell: { allow: ["big"] }, ...policy }),
  };
}

const BIG = Array.from({ length: 100_000 }, (_, index) => `line ${index} ${"x".repeat(40)}`).join(
  "\n",
);

describe("output spill", () => {
  it("keeps head and tail of a huge stdout and saves all of it", async () => {
    const spillDir = path.join(jailRoot, ".spill");
    const { backend, ops } = setup(
      { output: { spillDir, maxBytes: 4096, maxLines: 50 } },
      { commands: { big: { stdout: BIG } } },
    );
    const result = await ops.exec("big");

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(4096 + 300);
    expect(result.stdout).toMatch(
      /\[showing lines 1-\d+ and \d+-100000 of 100000; full output saved to .+\]/,
    );
    expect(result.stdout.startsWith("line 0 ")).toBe(true);

    const file = result.truncation?.stdout?.path as string;

    expect(path.basename(file)).toMatch(/^spill-\d+-[a-z0-9]+-run_shell-stdout\.txt$/);
    expect(await backend.readFile(file)).toBe(BIG);
    expect(result.truncation?.stdout?.total).toEqual({
      lines: 100_000,
      bytes: Buffer.byteLength(BIG, "utf8"),
    });
  });

  it("lets read_file open the spill file with offset and limit", async () => {
    const spillDir = path.join(outside, "spill");
    const { ops } = setup(
      { output: { spillDir, maxBytes: 2000, maxLines: 20 } },
      { commands: { big: { stdout: BIG } } },
    );
    const result = await ops.exec("big");
    const file = result.truncation?.stdout?.path as string;
    const window = await ops.readFile(file, { offset: 500, limit: 3 });

    expect(window.content).toContain("line 499 ");
    expect(window.endLine - window.startLine).toBe(2);
  });

  it("keeps a workspace's spill files from another workspace sharing the directory", async () => {
    const spillDir = path.join(outside, "shared-spill");
    const backend = createMockBackend({ commands: { big: { stdout: BIG } } });
    const policy: WorkspacePolicy = {
      cwd: jailRoot,
      shell: { allow: ["big"] },
      output: { spillDir, maxLines: 20 },
    };
    const owner = createOps(backend, policy);
    const other = createOps(backend, policy);
    const file = (await owner.exec("big")).truncation?.stdout?.path as string;

    expect((await owner.readFile(file, { limit: 1 })).content).toContain("line 0 ");
    await expect(other.readFile(file)).rejects.toMatchObject({ type: "path-escape" });
    await expect(other.grep("line", { path: file })).rejects.toMatchObject({
      type: "path-escape",
    });
    await expect(other.grep("line", { path: spillDir })).rejects.toMatchObject({
      type: "path-escape",
    });
  });

  it.skipIf(process.platform === "win32")(
    "creates spill files readable by the owner only",
    async () => {
      const { statSync } = await import("node:fs");
      const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-spill-mode-")));
      const spillDir = path.join(outside, "mode-spill");

      writeFileSync(path.join(root, "long.txt"), BIG.slice(0, 20_000));

      const ops = createOps(createLocalBackend(), {
        cwd: root,
        read: { maxBytes: 500 },
        output: { spillDir },
      });
      const read = await ops.readFile("long.txt");
      const file = read.truncation?.path as string;

      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(spillDir).mode & 0o777).toBe(0o700);
    },
  );

  it("still refuses a path outside the jail and the spill directory", async () => {
    const { ops } = setup({ output: { spillDir: path.join(outside, "spill") } });

    await expect(ops.readFile(path.join(outside, "other.txt"))).rejects.toMatchObject({
      type: "path-escape",
    });
  });

  it("does not let writes target the spill directory outside the jail", async () => {
    const { ops } = setup({ output: { spillDir: path.join(outside, "spill") } });

    await expect(ops.writeFile(path.join(outside, "spill", "x.txt"), "x")).rejects.toMatchObject({
      type: "path-escape",
    });
  });

  it("cuts as before without a spillDir, and adds truncation data", async () => {
    const { ops } = setup(
      { shell: { allow: ["big"], maxOutputBytes: 100 } },
      { commands: { big: { stdout: BIG } } },
    );
    const result = await ops.exec("big");

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(100);
    expect(result.truncation?.stdout?.path).toBeUndefined();
  });

  it("returns small output untouched", async () => {
    const { ops } = setup(
      { output: { spillDir: path.join(jailRoot, ".spill") } },
      { commands: { big: { stdout: "ok\n" } } },
    );
    const result = await ops.exec("big");

    expect(result).toMatchObject({ stdout: "ok\n", truncated: false });
    expect(result.truncation).toBeUndefined();
  });

  it("spills grep and glob lists", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-spill-list-")));

    mkdirSync(path.join(root, "dir"));

    for (let index = 0; index < 30; index++) {
      writeFileSync(path.join(root, `dir/file-${String(index).padStart(2, "0")}.txt`), "hit\n");
    }

    const ops = createOps(createLocalBackend(), {
      cwd: root,
      output: { spillDir: ".spill", maxLines: 5 },
    });
    const grep = await ops.grep("hit", { glob: "dir/*.txt" });

    expect(grep.total).toBe(30);
    expect(grep.matches).toHaveLength(5);
    expect(grep.truncated).toBe(true);
    expect((await ops.readFile(grep.truncation?.path as string)).content).toContain("file-");

    const glob = await ops.globResult?.("dir/*.txt");

    expect(glob?.paths).toHaveLength(5);
    expect(glob?.truncation?.total.lines).toBe(30);
  });

  it("lists spill files flat in spilledTo and ends the text with the file", async () => {
    const spillDir = path.join(jailRoot, ".spill");
    const { ops } = setup(
      { output: { spillDir, maxBytes: 4096, maxLines: 50 } },
      { commands: { big: { stdout: BIG } } },
    );
    const result = await ops.exec("big");
    const file = result.truncation?.stdout?.path as string;

    expect(result.spilledTo).toEqual([file]);
    expect(result.stdout.endsWith(`[full output saved to ${file}]`)).toBe(true);
  });

  it("lists the spill file of a spilled read in spilledTo", async () => {
    const content = Array.from({ length: 200 }, (_, index) => `row ${index}`).join("\n");
    const { ops } = setup(
      { read: { maxBytes: 300 }, output: { spillDir: path.join(jailRoot, ".spill") } },
      { files: { [path.join(jailRoot, "big.txt")]: content } },
    );
    const result = await ops.readFile("big.txt");

    expect(result.spilledTo).toEqual([result.truncation?.path]);
    expect(result.content.endsWith(`full output saved to ${result.truncation?.path}]`)).toBe(true);
  });

  it("spills a read that read.maxBytes cut", async () => {
    const content = Array.from({ length: 200 }, (_, index) => `row ${index}`).join("\n");
    const { backend, ops } = setup(
      { read: { maxBytes: 300 }, output: { spillDir: path.join(jailRoot, ".spill") } },
      { files: { [path.join(jailRoot, "big.txt")]: content } },
    );
    const result = await ops.readFile("big.txt");

    expect(result.bytesCapped).toBe(true);
    expect(result.content).toMatch(/\[showing lines 1-\d+ of 200; full output saved to .+\]/);
    expect(await backend.readFile(result.truncation?.path as string)).toContain("   200\trow 199");
  });

  it("removes expired spill files when a workspace is created", async () => {
    const spillDir = path.join(jailRoot, ".old-spill");
    const old = path.join(
      spillDir,
      `spill-${Date.now() - 10 * 86_400_000}-abc123-run_shell-stdout.txt`,
    );
    const other = path.join(spillDir, "notes.txt");
    const { backend } = setup(
      { output: { spillDir, retentionMs: 1000 } },
      { files: { [old]: "old", [other]: "keep" } },
    );

    await sleep(50);

    expect(await backend.exists(old)).toBe(false);
    expect(await backend.exists(other)).toBe(true);
  });

  it("removes this run's files on dispose when retentionMs is 0", async () => {
    const spillDir = path.join(jailRoot, ".zero-spill");
    const { backend, ops } = setup(
      { output: { spillDir, retentionMs: 0, maxLines: 5 } },
      { commands: { big: { stdout: BIG } } },
    );
    const result = await ops.exec("big");
    const file = result.truncation?.stdout?.path as string;

    expect(await backend.exists(file)).toBe(true);

    await ops.dispose();

    expect(await backend.exists(file)).toBe(false);
  });
});
