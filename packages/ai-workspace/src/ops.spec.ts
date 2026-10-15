import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashString } from "@warlock.js/fs";
import { WorkspaceEditError, WorkspacePolicyError } from "./errors";
import { createOps } from "./ops";
import type {
  WorkspaceBackend,
  WorkspaceBackendExecOptions,
  WorkspaceBackendExecResult,
  WorkspacePolicy,
} from "./contracts";

/**
 * A tiny in-memory backend for hermetic ops tests. Content lives in a
 * `Map` keyed by absolute path; `exec` returns a scripted result. Paths
 * are still resolved against a REAL tmp jail root (so `resolveInJail`'s
 * realpath jail logic runs for real), but no file content touches disk.
 */
class FakeBackend implements WorkspaceBackend {
  public readonly files = new Map<string, string>();
  public readonly dirs = new Set<string>();
  public lastExec?: { command: string; opts?: WorkspaceBackendExecOptions };
  public execResult: WorkspaceBackendExecResult = {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
  };

  public async readFile(absPath: string): Promise<string> {
    const content = this.files.get(absPath);

    if (content === undefined) {
      throw new Error(`ENOENT: ${absPath}`);
    }

    return content;
  }

  public async writeFile(absPath: string, content: string): Promise<void> {
    this.files.set(absPath, content);
  }

  public async exists(absPath: string): Promise<boolean> {
    return this.files.has(absPath) || this.dirs.has(absPath);
  }

  public async mkdir(absPath: string): Promise<void> {
    this.dirs.add(absPath);
  }

  public async remove(absPath: string): Promise<void> {
    this.files.delete(absPath);
    this.dirs.delete(absPath);
  }

  public async list(absDir: string): Promise<string[]> {
    const prefix = absDir.endsWith(path.sep) ? absDir : `${absDir}${path.sep}`;
    const children = new Set<string>();

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const firstSegment = rest.split(path.sep)[0];
        children.add(path.join(absDir, firstSegment));
      }
    }

    // A path with NO children that is also not a known dir is treated as
    // a file: throwing here is how `isDirectory()` in ops distinguishes.
    if (children.size === 0 && !this.dirs.has(absDir) && this.files.has(absDir)) {
      throw new Error(`ENOTDIR: ${absDir}`);
    }

    return [...children];
  }

  public async realpath(absPath: string): Promise<string> {
    return absPath;
  }

  public async exec(
    command: string,
    opts?: WorkspaceBackendExecOptions,
  ): Promise<WorkspaceBackendExecResult> {
    this.lastExec = { command, opts };

    return this.execResult;
  }
}

let jailRoot: string;

beforeAll(() => {
  jailRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "ws-ops-")));
});

function policy(overrides: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  return { cwd: jailRoot, ...overrides };
}

function abs(relativePath: string): string {
  return path.join(jailRoot, relativePath);
}

describe("createOps.readFile", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = new FakeBackend();
    backend.files.set(abs("src/index.ts"), "line1\nline2\nline3\n");
  });

  it("returns content, hash, and total line count", async () => {
    const ops = createOps(backend, policy());
    const result = await ops.readFile("src/index.ts");

    expect(result.hash).toBe(hashString("line1\nline2\nline3\n"));
    expect(result.totalLines).toBe(4); // trailing newline ⇒ 4th empty line
    expect(result.content).toContain("line1");
  });

  it("numbers lines cat -n style", async () => {
    const ops = createOps(backend, policy());
    const result = await ops.readFile("src/index.ts");

    expect(result.content).toMatch(/^\s+1\tline1/);
    expect(result.content).toMatch(/\n\s+2\tline2/);
  });

  it("windows by offset and limit (1-based)", async () => {
    const ops = createOps(backend, policy());
    const result = await ops.readFile("src/index.ts", { offset: 2, limit: 1 });

    expect(result.content).toMatch(/^\s+2\tline2$/);
    expect(result.content).not.toContain("line1");
    expect(result.content).not.toContain("line3");
  });

  it("rejects a path that escapes the jail", async () => {
    const ops = createOps(backend, policy());

    await expect(ops.readFile("../../etc/passwd")).rejects.toBeInstanceOf(WorkspacePolicyError);
  });
});

describe("createOps.writeFile", () => {
  it("writes content and returns size + hash", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy());
    const result = await ops.writeFile("src/new.ts", "hello");

    expect(backend.files.get(abs("src/new.ts"))).toBe("hello");
    expect(result.bytesWritten).toBe(5);
    expect(result.hash).toBe(hashString("hello"));
  });

  it("creates the parent directory before writing", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy());

    await ops.writeFile("deep/nested/file.ts", "x");

    expect(backend.dirs.has(abs("deep/nested"))).toBe(true);
  });

  it("rejects a jail escape on write", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy());

    await expect(ops.writeFile("../escape.ts", "x")).rejects.toBeInstanceOf(WorkspacePolicyError);
  });
});

describe("createOps.editFile", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = new FakeBackend();
    backend.files.set(abs("a.ts"), "const a = 1;\nconst b = 2;\nconst a2 = 1;\n");
  });

  it("replaces a unique occurrence", async () => {
    const ops = createOps(backend, policy());
    const result = await ops.editFile({ path: "a.ts", oldString: "const b = 2;", newString: "const b = 3;" });

    expect(result.replacements).toBe(1);
    expect(backend.files.get(abs("a.ts"))).toContain("const b = 3;");
  });

  it("rejects when the old string is not found", async () => {
    const ops = createOps(backend, policy());

    await expect(
      ops.editFile({ path: "a.ts", oldString: "nonexistent", newString: "x" }),
    ).rejects.toMatchObject({ type: "not-found" });
  });

  it("rejects a non-unique edit without replaceAll", async () => {
    const ops = createOps(backend, policy());

    await expect(
      ops.editFile({ path: "a.ts", oldString: "= 1;", newString: "= 9;" }),
    ).rejects.toMatchObject({ type: "not-unique", matches: 2 });
  });

  it("replaces every occurrence with replaceAll", async () => {
    const ops = createOps(backend, policy());
    const result = await ops.editFile({
      path: "a.ts",
      oldString: "= 1;",
      newString: "= 9;",
      replaceAll: true,
    });

    expect(result.replacements).toBe(2);
    expect(backend.files.get(abs("a.ts"))).not.toContain("= 1;");
  });

  it("rejects a stale expectHash", async () => {
    const ops = createOps(backend, policy());

    await expect(
      ops.editFile({
        path: "a.ts",
        oldString: "const b = 2;",
        newString: "const b = 3;",
        expectHash: "deadbeef",
      }),
    ).rejects.toBeInstanceOf(WorkspaceEditError);
  });

  it("accepts a matching expectHash", async () => {
    const ops = createOps(backend, policy());
    const current = backend.files.get(abs("a.ts"))!;
    const result = await ops.editFile({
      path: "a.ts",
      oldString: "const b = 2;",
      newString: "const b = 3;",
      expectHash: hashString(current),
    });

    expect(result.replacements).toBe(1);
  });

  it("returns the post-edit hash", async () => {
    const ops = createOps(backend, policy());
    const result = await ops.editFile({ path: "a.ts", oldString: "const b = 2;", newString: "const b = 3;" });
    const updated = backend.files.get(abs("a.ts"))!;

    expect(result.hash).toBe(hashString(updated));
  });
});

describe("createOps.exec", () => {
  it("rejects a command not on the allowlist", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy({ shell: { allow: ["npm"] } }));

    await expect(ops.exec("rm -rf /")).rejects.toMatchObject({ type: "denied-command" });
  });

  it("rejects every command when no shell policy is set", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy());

    await expect(ops.exec("npm test")).rejects.toBeInstanceOf(WorkspacePolicyError);
  });

  it("runs an allowed command with the policy env and cwd", async () => {
    const backend = new FakeBackend();
    backend.execResult = { exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
    const ops = createOps(backend, policy({ shell: { allow: ["npm"], env: { CI: "1" } } }));

    const result = await ops.exec("npm test");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(backend.lastExec?.command).toBe("npm test");
    expect(backend.lastExec?.opts?.cwd).toBe(jailRoot);
    expect(backend.lastExec?.opts?.env).toEqual({ CI: "1" });
  });

  it("caps oversized output and flags truncation", async () => {
    const backend = new FakeBackend();
    backend.execResult = { exitCode: 0, stdout: "x".repeat(50), stderr: "", timedOut: false };
    const ops = createOps(backend, policy({ shell: { allow: ["npm"], maxOutputBytes: 10 } }));

    const result = await ops.exec("npm test");

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBe(10);
  });

  it("propagates the timedOut flag", async () => {
    const backend = new FakeBackend();
    backend.execResult = { exitCode: 137, stdout: "", stderr: "", timedOut: true };
    const ops = createOps(backend, policy({ shell: { allow: ["sleep"] } }));

    const result = await ops.exec("sleep 99");

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(137);
  });
});

describe("createOps.grep", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = new FakeBackend();
    backend.files.set(abs("src/a.ts"), "import x\nconst foo = 1\n");
    backend.files.set(abs("src/b.ts"), "const foo = 2\nconst bar = 3\n");
    backend.files.set(abs("readme.md"), "foo in docs\n");
  });

  it("finds matching lines across files", async () => {
    const ops = createOps(backend, policy());
    const result = await ops.grep("foo");

    expect(result.total).toBe(3);
    expect(result.matches.map((m) => m.path).sort()).toContain("src/a.ts");
  });

  it("narrows by a glob", async () => {
    const ops = createOps(backend, policy());
    const result = await ops.grep("foo", { glob: "src/*.ts" });

    expect(result.matches.every((m) => m.path.startsWith("src/"))).toBe(true);
    expect(result.matches.some((m) => m.path === "readme.md")).toBe(false);
  });

  it("supports case-insensitive matching", async () => {
    backend.files.set(abs("src/c.ts"), "FOO upper\n");
    const ops = createOps(backend, policy());

    const sensitive = await ops.grep("FOO");
    const insensitive = await ops.grep("foo", { ignoreCase: true });

    expect(sensitive.total).toBe(1);
    expect(insensitive.total).toBeGreaterThan(1);
  });

  it("skips files blocked by the deny list", async () => {
    backend.files.set(abs(".git/config"), "foo secret\n");
    const ops = createOps(backend, policy({ denyPaths: [".git/**"] }));

    const result = await ops.grep("foo");

    expect(result.matches.some((m) => m.path.startsWith(".git/"))).toBe(false);
  });

  it("rejects a catastrophic-backtracking pattern (ReDoS shape) instead of compiling it", async () => {
    const ops = createOps(backend, policy());

    await expect(ops.grep("(a+)+$")).rejects.toMatchObject({ type: "unsafe-pattern" });
  });

  it("rejects an overly long pattern", async () => {
    const ops = createOps(backend, policy());

    await expect(ops.grep("a".repeat(500))).rejects.toMatchObject({ type: "unsafe-pattern" });
  });

  it("bounds the worst-case time a pathological pattern can spend on one line", async () => {
    // A ReDoS-shaped pattern that's still short and passes the length cap
    // but is caught by the nested-quantifier heuristic — proves the guard
    // isn't solely relying on length.
    const ops = createOps(backend, policy());

    await expect(ops.grep("(a*)*b")).rejects.toBeInstanceOf(WorkspacePolicyError);
  });

  it("skips lines longer than the scan cap rather than testing them", async () => {
    backend.files.set(abs("src/long.ts"), `${"x".repeat(3000)}foo\n`);
    const ops = createOps(backend, policy());

    const result = await ops.grep("foo");

    expect(result.matches.some((m) => m.path === "src/long.ts")).toBe(false);
  });
});

describe("createOps.glob", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = new FakeBackend();
    backend.files.set(abs("src/models/user.ts"), "");
    backend.files.set(abs("src/models/post.ts"), "");
    backend.files.set(abs("src/index.ts"), "");
    backend.files.set(abs("readme.md"), "");
  });

  it("matches a ** pattern across directories", async () => {
    const ops = createOps(backend, policy());
    const paths = await ops.glob("src/**/*.ts");

    expect(paths).toContain("src/models/user.ts");
    expect(paths).toContain("src/index.ts");
    expect(paths).not.toContain("readme.md");
  });

  it("matches a single-segment * pattern", async () => {
    const ops = createOps(backend, policy());
    const paths = await ops.glob("src/*.ts");

    expect(paths).toContain("src/index.ts");
    expect(paths).not.toContain("src/models/user.ts");
  });

  it("returns sorted results", async () => {
    const ops = createOps(backend, policy());
    const paths = await ops.glob("src/models/*.ts");

    expect(paths).toEqual([...paths].sort());
  });

  it("excludes deny-listed paths", async () => {
    backend.files.set(abs(".git/index.ts"), "");
    const ops = createOps(backend, policy({ denyPaths: [".git/**"] }));

    const paths = await ops.glob("**/*.ts");

    expect(paths.some((p) => p.startsWith(".git/"))).toBe(false);
  });
});

describe("createOps exists / mkdir / remove", () => {
  it("reports existence through the jail", async () => {
    const backend = new FakeBackend();
    backend.files.set(abs("there.ts"), "x");
    const ops = createOps(backend, policy());

    expect(await ops.exists("there.ts")).toBe(true);
    expect(await ops.exists("missing.ts")).toBe(false);
  });

  it("makes a directory at a jailed path", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy());

    await ops.mkdir("newdir");

    expect(backend.dirs.has(abs("newdir"))).toBe(true);
  });

  it("removes a jailed path", async () => {
    const backend = new FakeBackend();
    backend.files.set(abs("gone.ts"), "x");
    const ops = createOps(backend, policy());

    await ops.remove("gone.ts");

    expect(backend.files.has(abs("gone.ts"))).toBe(false);
  });

  it("rejects mkdir/remove jail escapes", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy());

    await expect(ops.mkdir("../evil")).rejects.toBeInstanceOf(WorkspacePolicyError);
    await expect(ops.remove("../evil")).rejects.toBeInstanceOf(WorkspacePolicyError);
  });
});

describe("createOps.readFile byte cap (read.maxBytes)", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = new FakeBackend();
  });

  it("bounds a single long line to maxBytes, numbered prefix included", async () => {
    const raw = "x".repeat(4096);
    backend.files.set(abs("long.txt"), raw);
    const ops = createOps(backend, policy({ read: { maxBytes: 16, defaultLines: 1 } }));

    const result = await ops.readFile("long.txt");

    expect(Buffer.byteLength(result.content, "utf8")).toBe(16);
    // 6-wide number + tab = 7 bytes of prefix, 9 bytes of line content.
    expect(result.content).toBe(`     1\t${"x".repeat(9)}`);
    expect(result.bytesCapped).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(1);
    expect(result.totalLines).toBe(1);
    expect(result.totalBytes).toBe(4096);
  });

  it("hashes the full file, not the returned window", async () => {
    const raw = "y".repeat(1000);
    backend.files.set(abs("long.txt"), raw);
    const ops = createOps(backend, policy({ read: { maxBytes: 32 } }));

    const result = await ops.readFile("long.txt");

    expect(result.hash).toBe(hashString(raw));
  });

  it("never splits a multibyte character", async () => {
    // Each "é" is 2 bytes and each "😀" is 4 bytes in UTF-8.
    backend.files.set(abs("utf8.txt"), "é😀".repeat(50));
    const ops = createOps(backend, policy({ read: { maxBytes: 7 + 5 } }));

    const result = await ops.readFile("utf8.txt");

    // 5 bytes of room fits "é" (2) but not the following "😀" (4).
    expect(result.content).toBe("     1\té");
    expect(result.content).not.toContain("�");
    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(12);
    expect(result.bytesCapped).toBe(true);
  });

  it("stops at whole lines when they fit and reports the last line returned", async () => {
    backend.files.set(abs("lines.txt"), "aaaa\nbbbb\ncccc\ndddd");
    // Each numbered line is 7 + 4 = 11 bytes, plus 1 byte per separator.
    const ops = createOps(backend, policy({ read: { maxBytes: 23 } }));

    const result = await ops.readFile("lines.txt");

    expect(result.content).toBe("     1\taaaa\n     2\tbbbb");
    expect(Buffer.byteLength(result.content, "utf8")).toBe(23);
    expect(result.endLine).toBe(2);
    expect(result.bytesCapped).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("drops a line entirely when not even its prefix and one character fit", async () => {
    backend.files.set(abs("lines.txt"), "aaaa\nbbbb");
    const ops = createOps(backend, policy({ read: { maxBytes: 15 } }));

    const result = await ops.readFile("lines.txt");

    expect(result.content).toBe("     1\taaaa");
    expect(result.endLine).toBe(1);
    expect(result.bytesCapped).toBe(true);
  });

  it("applies the cap to an offset window too", async () => {
    backend.files.set(abs("lines.txt"), `a\n${"b".repeat(100)}\nc`);
    const ops = createOps(backend, policy({ read: { maxBytes: 10 } }));

    const result = await ops.readFile("lines.txt", { offset: 2 });

    expect(result.content).toBe("     2\tbbb");
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(2);
  });

  it("returns the whole window untouched when it fits under the cap", async () => {
    backend.files.set(abs("small.txt"), "one\ntwo");
    const ops = createOps(backend, policy({ read: { maxBytes: 1000 } }));

    const result = await ops.readFile("small.txt");

    expect(result.content).toBe("     1\tone\n     2\ttwo");
    expect(result.bytesCapped).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.endLine).toBe(2);
  });

  it("does not cap when the policy sets no maxBytes", async () => {
    backend.files.set(abs("long.txt"), "z".repeat(10_000));
    const ops = createOps(backend, policy());

    const result = await ops.readFile("long.txt");

    expect(Buffer.byteLength(result.content, "utf8")).toBe(10_007);
    expect(result.bytesCapped).toBe(false);
  });

  it("reports line-limit truncation separately from the byte cap", async () => {
    backend.files.set(abs("lines.txt"), "a\nb\nc");
    const ops = createOps(backend, policy({ read: { defaultLines: 2, maxBytes: 1000 } }));

    const result = await ops.readFile("lines.txt");

    expect(result.endLine).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.bytesCapped).toBe(false);
  });
});

describe("createOps.exec cancellation", () => {
  it("does not reach the backend when the signal is already aborted", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy({ shell: { allow: ["npm"] } }));
    const controller = new AbortController();
    controller.abort();

    const result = await ops.exec("npm test", { signal: controller.signal });

    expect(backend.lastExec).toBeUndefined();
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("still applies the command gate before the cancellation check", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy({ shell: { allow: ["npm"] } }));
    const controller = new AbortController();
    controller.abort();

    await expect(ops.exec("rm -rf /", { signal: controller.signal })).rejects.toMatchObject({
      type: "denied-command",
    });
  });

  it("threads the per-call signal to the backend", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy({ shell: { allow: ["npm"] } }));
    const controller = new AbortController();

    await ops.exec("npm test", { signal: controller.signal });

    expect(backend.lastExec?.opts?.signal).toBe(controller.signal);
  });

  it("passes no signal when the caller gave none", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy({ shell: { allow: ["npm"] } }));

    await ops.exec("npm test");

    expect(backend.lastExec?.opts && "signal" in backend.lastExec.opts).toBe(false);
  });

  it("surfaces a backend cancellation and never reports it as a timeout", async () => {
    const backend = new FakeBackend();
    backend.execResult = { exitCode: 137, stdout: "", stderr: "", timedOut: true, cancelled: true };
    const ops = createOps(backend, policy({ shell: { allow: ["npm"] } }));

    const result = await ops.exec("npm test", { signal: new AbortController().signal });

    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it("reads an absent backend `cancelled` as false", async () => {
    const backend = new FakeBackend();
    const ops = createOps(backend, policy({ shell: { allow: ["npm"] } }));

    const result = await ops.exec("npm test");

    expect(result.cancelled).toBe(false);
  });
});

describe("createOps.exec output cap", () => {
  it("clips captured output on a character boundary", async () => {
    const backend = new FakeBackend();
    backend.execResult = { exitCode: 0, stdout: "€".repeat(10), stderr: "", timedOut: false };
    const ops = createOps(backend, policy({ shell: { allow: ["npm"], maxOutputBytes: 7 } }));

    const result = await ops.exec("npm test");

    // "€" is 3 bytes: 7 bytes of room holds two whole characters.
    expect(result.stdout).toBe("€€");
    expect(result.truncated).toBe(true);
  });
});
