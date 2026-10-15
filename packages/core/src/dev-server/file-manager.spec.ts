import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileManager } from "./file-manager";

const getFileAsync = vi.fn();
const lastModifiedAsync = vi.fn();

vi.mock("@warlock.js/fs", () => ({
  getFileAsync: (...args: unknown[]) => getFileAsync(...args),
  lastModifiedAsync: (...args: unknown[]) => lastModifiedAsync(...args),
}));

/**
 * `FileManager.process()` reads a file's source and then stats it in a
 * second filesystem call. A rename or move racing the filesystem can make
 * either call ENOENT between the watcher event firing and this method
 * running. That must resolve to `state: "deleted"` — never a thrown error —
 * while a genuine failure (`EACCES`, a permissions error, etc.) must still
 * throw so the caller can report it.
 */
describe("FileManager.process — ENOENT between read and stat is a deletion, not a throw", () => {
  beforeEach(() => {
    getFileAsync.mockReset();
    lastModifiedAsync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildFileManager() {
    const files = new Map();
    const fileOperations = {} as never;
    return new FileManager("/project/src/app/welcome.page.tsx", files, fileOperations);
  }

  function enoent(): NodeJS.ErrnoException {
    return Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
  }

  it("(1) does not throw and marks the file deleted when the read ENOENTs", async () => {
    getFileAsync.mockRejectedValueOnce(enoent());
    lastModifiedAsync.mockResolvedValueOnce(new Date());

    const fileManager = buildFileManager();

    await expect(fileManager.process()).resolves.toBe(false);
    expect(fileManager.state).toBe("deleted");
  });

  it("(2) does not throw and marks the file deleted when the stat ENOENTs after a successful read", async () => {
    getFileAsync.mockResolvedValueOnce("export const x = 1;");
    lastModifiedAsync.mockRejectedValueOnce(enoent());

    const fileManager = buildFileManager();

    await expect(fileManager.process()).resolves.toBe(false);
    expect(fileManager.state).toBe("deleted");
    // The source/hash must not have been committed from a read whose file
    // then vanished — otherwise the same content re-appearing later would
    // hash-match and be silently skipped as a no-op.
    expect(fileManager.source).toBe("");
    expect(fileManager.hash).toBe("");
  });

  it("(3) still throws for a genuine, non-ENOENT failure (e.g. EACCES)", async () => {
    const permissionError = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    getFileAsync.mockRejectedValueOnce(permissionError);

    const fileManager = buildFileManager();

    await expect(fileManager.process()).rejects.toBe(permissionError);
  });
});

describe("FileManager file type detection (C2:B7)", () => {
  function typeOf(relative: string) {
    const manager = new FileManager(`/project/${relative}`, new Map(), {} as never);
    const internal = manager as unknown as { relativePath: string; detectFileType(): void };
    internal.relativePath = relative;
    internal.detectFileType();
    return manager.type;
  }

  it("types a model under an events/ or service-named folder as a model", () => {
    expect(typeOf("src/app/events/models/event.model.ts")).toBe("model");
    expect(typeOf("src/app/customer-service/models/ticket.model.ts")).toBe("model");
  });

  it("does not treat domain.ts as main", () => {
    expect(typeOf("src/app/domain.ts")).not.toBe("main");
    expect(typeOf("src/main.ts")).toBe("main");
  });
});
