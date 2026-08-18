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
