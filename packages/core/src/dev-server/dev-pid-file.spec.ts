import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEV_PID_FILE, writeDevPidFile } from "./dev-pid-file";

describe("writeDevPidFile", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "warlock-dev-pid-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("records this process in .warlock/dev.pid", () => {
    const remove = writeDevPidFile(root);

    expect(readFileSync(path.join(root, DEV_PID_FILE), "utf8").trim()).toBe(String(process.pid));

    remove();
  });

  it("removes the file when asked, and only once", () => {
    const remove = writeDevPidFile(root);

    remove();
    expect(existsSync(path.join(root, DEV_PID_FILE))).toBe(false);

    expect(() => remove()).not.toThrow();
  });

  it("leaves a file that names another process alone", () => {
    const remove = writeDevPidFile(root);

    writeFileSync(path.join(root, DEV_PID_FILE), "999999\n");
    remove();

    expect(readFileSync(path.join(root, DEV_PID_FILE), "utf8").trim()).toBe("999999");
  });

  it("does not throw when the project directory cannot be written", () => {
    const blocker = path.join(root, "blocked");

    writeFileSync(blocker, "a file, not a directory");

    expect(() => writeDevPidFile(blocker)).not.toThrow();
  });
});
