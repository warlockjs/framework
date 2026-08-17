import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureDirectoryAsync,
  getFileAsync,
  pathExistsAsync,
  removeDirectoryAsync,
} from "@warlock.js/fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalBackend } from "./local";

// `node -e ...` is the cross-platform command we exercise `exec()` with. The
// spawned process does NOT inherit `process.env` (the backend passes exactly
// what it is handed), so a `node` lookup needs PATH threaded through `env`.
const execEnv: Record<string, string> = {
  PATH: process.env.PATH ?? "",
};

describe("createLocalBackend", () => {
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `ws-local-${randomBytes(6).toString("hex")}`);
    await ensureDirectoryAsync(root);
  });

  afterEach(async () => {
    await removeDirectoryAsync(root);
  });

  it("should round-trip a file: write then read back the exact content", async () => {
    const backend = createLocalBackend();
    const file = join(root, "note.txt");

    await backend.writeFile(file, "hello workspace");

    expect(await backend.readFile(file)).toBe("hello workspace");
  });

  it("should create missing parent directories on write (atomic write)", async () => {
    const backend = createLocalBackend();
    const file = join(root, "nested", "deep", "config.json");

    await backend.writeFile(file, '{"ok":true}');

    expect(await getFileAsync(file)).toBe('{"ok":true}');
  });

  it("should overwrite an existing file's content", async () => {
    const backend = createLocalBackend();
    const file = join(root, "mutable.txt");

    await backend.writeFile(file, "first");
    await backend.writeFile(file, "second");

    expect(await backend.readFile(file)).toBe("second");
  });

  it("should report exists() true for a file and true for a directory", async () => {
    const backend = createLocalBackend();
    const file = join(root, "present.txt");
    await backend.writeFile(file, "x");

    expect(await backend.exists(file)).toBe(true);
    expect(await backend.exists(root)).toBe(true);
  });

  it("should report exists() false for an absent path", async () => {
    const backend = createLocalBackend();

    expect(await backend.exists(join(root, "ghost.txt"))).toBe(false);
  });

  it("should create a directory tree idempotently via mkdir()", async () => {
    const backend = createLocalBackend();
    const dir = join(root, "a", "b", "c");

    await backend.mkdir(dir);
    await backend.mkdir(dir);

    expect(await pathExistsAsync(dir)).toBe(true);
  });

  it("should list immediate children of a directory as absolute paths", async () => {
    const backend = createLocalBackend();
    await backend.writeFile(join(root, "one.txt"), "1");
    await backend.writeFile(join(root, "two.txt"), "2");
    await backend.mkdir(join(root, "sub"));

    const entries = await backend.list(root);

    expect(entries.sort()).toEqual(
      [join(root, "one.txt"), join(root, "sub"), join(root, "two.txt")].sort(),
    );
  });

  it("should remove a single file", async () => {
    const backend = createLocalBackend();
    const file = join(root, "doomed.txt");
    await backend.writeFile(file, "bye");

    await backend.remove(file);

    expect(await backend.exists(file)).toBe(false);
  });

  it("should remove a directory tree recursively", async () => {
    const backend = createLocalBackend();
    const dir = join(root, "tree");
    await backend.writeFile(join(dir, "leaf.txt"), "leaf");

    await backend.remove(dir);

    expect(await backend.exists(dir)).toBe(false);
  });

  it("should treat remove() of an absent path as a no-op", async () => {
    const backend = createLocalBackend();

    await expect(backend.remove(join(root, "never.txt"))).resolves.toBeUndefined();
  });

  it("should resolve realpath() to a canonical absolute path", async () => {
    const backend = createLocalBackend();
    const file = join(root, "real.txt");
    await backend.writeFile(file, "x");

    const resolved = await backend.realpath(file);

    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.endsWith("real.txt")).toBe(true);
  });

  it("should exec a trivial cross-platform command and capture stdout + exit code 0", async () => {
    const backend = createLocalBackend();

    const result = await backend.exec('node -e "process.stdout.write(\'pong\')"', {
      cwd: root,
      env: execEnv,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pong");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  it("should capture stderr and a non-zero exit code from exec", async () => {
    const backend = createLocalBackend();

    const result = await backend.exec(
      'node -e "process.stderr.write(\'boom\'); process.exit(3)"',
      { cwd: root, env: execEnv },
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("boom");
    expect(result.timedOut).toBe(false);
  });

  it("should set timedOut and a non-zero exit when a command exceeds its timeout", async () => {
    const backend = createLocalBackend();

    const result = await backend.exec('node -e "setTimeout(() => {}, 10000)"', {
      cwd: root,
      env: execEnv,
      timeoutMs: 200,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("should run exec in the provided cwd", async () => {
    const backend = createLocalBackend();
    const sub = join(root, "workdir");
    await backend.mkdir(sub);

    const result = await backend.exec('node -e "process.stdout.write(process.cwd())"', {
      cwd: sub,
      env: execEnv,
    });

    expect(result.exitCode).toBe(0);
    // realpath both sides — macOS /var vs /private/var symlinking would
    // otherwise make a raw string compare flaky.
    expect(await backend.realpath(result.stdout)).toBe(await backend.realpath(sub));
  });

  it("should refuse to exec a command chaining a second command with `;` — nothing runs", async () => {
    const backend = createLocalBackend();
    const marker = join(root, "injected.txt").replace(/\\/g, "/");

    const result = await backend.exec(
      `node -e "process.stdout.write('safe')" ; node -e "require('fs').writeFileSync('${marker}', 'pwned')"`,
      { cwd: root, env: execEnv },
    );

    // Refused outright: neither the allowed-looking prefix nor the
    // injected suffix executed, and no shell ever saw the string.
    expect(result.exitCode).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.timedOut).toBe(false);
    expect(await backend.exists(join(root, "injected.txt"))).toBe(false);
  });

  it("should refuse every unquoted shell metacharacter (&&, |, backtick, $(), >)", async () => {
    const backend = createLocalBackend();
    const payloads = [
      "node -v && node -v",
      "node -v | node -v",
      "node -v `node -v`",
      "node -v $(node -v)",
      `node -v > ${join(root, "redirected.txt").replace(/\\/g, "/")}`,
    ];

    for (const command of payloads) {
      const result = await backend.exec(command, { cwd: root, env: execEnv });

      expect(result.exitCode).toBe(127);
      expect(result.stdout).toBe("");
    }

    expect(await backend.exists(join(root, "redirected.txt"))).toBe(false);
  });

  it("should pass quoted metacharacters through as literal argument data, not shell syntax", async () => {
    const backend = createLocalBackend();

    const result = await backend.exec(
      'node -e "process.stdout.write(process.argv[1])" "a;b|c"',
      { cwd: root, env: execEnv },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a;b|c");
  });
});
