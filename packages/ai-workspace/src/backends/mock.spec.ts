import { describe, expect, it } from "vitest";
import { createMockBackend } from "./mock";

describe("createMockBackend", () => {
  it("seeds files from the shorthand record and reads them back", async () => {
    const backend = createMockBackend({
      "/srv/app/src/index.ts": "export const x = 1;",
    });

    expect(await backend.readFile("/srv/app/src/index.ts")).toBe("export const x = 1;");
  });

  it("round-trips a write then read at the same path", async () => {
    const backend = createMockBackend();

    await backend.writeFile("/srv/app/notes.md", "# hello");

    expect(await backend.readFile("/srv/app/notes.md")).toBe("# hello");
  });

  it("throws when reading a path that does not exist", async () => {
    const backend = createMockBackend();

    await expect(backend.readFile("/srv/app/missing.ts")).rejects.toThrow(/no such file/i);
  });

  it("reports existence for seeded files and their implicit parent dirs", async () => {
    const backend = createMockBackend({ "/srv/app/src/index.ts": "x" });

    expect(await backend.exists("/srv/app/src/index.ts")).toBe(true);
    expect(await backend.exists("/srv/app/src")).toBe(true);
    expect(await backend.exists("/srv/app")).toBe(true);
    expect(await backend.exists("/srv/app/nope")).toBe(false);
  });

  it("creates an empty directory via mkdir that then exists", async () => {
    const backend = createMockBackend();

    expect(await backend.exists("/srv/app/empty")).toBe(false);

    await backend.mkdir("/srv/app/empty");

    expect(await backend.exists("/srv/app/empty")).toBe(true);
    expect(await backend.exists("/srv/app")).toBe(true);
  });

  it("removes a directory tree recursively", async () => {
    const backend = createMockBackend({
      "/srv/app/src/a.ts": "a",
      "/srv/app/src/nested/b.ts": "b",
      "/srv/app/keep.ts": "keep",
    });

    await backend.remove("/srv/app/src");

    expect(await backend.exists("/srv/app/src")).toBe(false);
    expect(await backend.exists("/srv/app/src/a.ts")).toBe(false);
    expect(await backend.exists("/srv/app/src/nested/b.ts")).toBe(false);
    expect(await backend.exists("/srv/app/keep.ts")).toBe(true);
  });

  it("lists only immediate children, sorted, as absolute paths", async () => {
    const backend = createMockBackend({
      "/srv/app/src/index.ts": "x",
      "/srv/app/src/util/helper.ts": "y",
      "/srv/app/README.md": "z",
    });

    expect(await backend.list("/srv/app")).toEqual(["/srv/app/README.md", "/srv/app/src"]);
    expect(await backend.list("/srv/app/src")).toEqual([
      "/srv/app/src/index.ts",
      "/srv/app/src/util",
    ]);
  });

  it("canonicalizes paths via realpath (collapses . / .. and slashes)", async () => {
    const backend = createMockBackend();

    expect(await backend.realpath("/srv/app/./src/../src/index.ts")).toBe("/srv/app/src/index.ts");
    expect(await backend.realpath("/srv//app///src")).toBe("/srv/app/src");
    // Backslashes are unified so Windows-style cwd roots map to one key.
    expect(await backend.realpath("C:\\srv\\app")).toBe("C:/srv/app");
  });

  it("treats a path and its non-canonical spelling as the same entry", async () => {
    const backend = createMockBackend();

    await backend.writeFile("/srv/app/src/index.ts", "v1");
    await backend.writeFile("/srv/app/src/../src/index.ts", "v2");

    expect(await backend.readFile("/srv/app/src/index.ts")).toBe("v2");
  });

  it("runs scripted commands and defaults unknown commands to a 0-exit no-op", async () => {
    const backend = createMockBackend({
      files: { "/srv/app/package.json": "{}" },
      commands: { "npm test": { exitCode: 1, stderr: "1 failing" } },
    });

    expect(await backend.exec("npm test")).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "1 failing",
      timedOut: false,
      cancelled: false,
    });

    expect(await backend.exec("echo hi")).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
    });
  });

  it("resolves cancelled without consulting the script when the signal is already aborted", async () => {
    const backend = createMockBackend({
      commands: { "npm test": { exitCode: 0, stdout: "ran" } },
    });
    const controller = new AbortController();
    controller.abort();

    const result = await backend.exec("npm test", { signal: controller.signal });

    expect(result.cancelled).toBe(true);
    expect(result.stdout).toBe("");
  });

  it("supports the structured seed shape with both files and commands", async () => {
    const backend = createMockBackend({
      files: { "/srv/app/main.ts": "console.log(1);" },
      commands: { "node main.ts": { stdout: "1\n" } },
    });

    expect(await backend.readFile("/srv/app/main.ts")).toBe("console.log(1);");
    expect((await backend.exec("node main.ts")).stdout).toBe("1\n");
  });
});
