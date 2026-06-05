import fs from "fs";
import { randomUUID } from "node:crypto";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggingData } from "../types";
import { FileLog } from "./file-log";

// Each spec file owns a distinct parent directory so the parallel test runner
// never lets one file's `afterEach` cleanup (`rmSync` on the parent) race a
// sibling file's deferred channel `init()` (`mkdir` under the same parent) —
// the source of intermittent ENOENT mkdir rejections and the
// "creates the storage directory on init" flake.
const TEST_ROOT = path.join(os.tmpdir(), "warlock-logger-test-file");

function createTempDir(): string {
  const dir = path.join(TEST_ROOT, randomUUID());
  fs.mkdirSync(dir, { recursive: true });

  return dir;
}

function removeDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function waitForCondition(predicate: () => boolean, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForFile(filePath: string, attempts = 40) {
  await waitForCondition(() => fs.existsSync(filePath), attempts);
}

// Poll the channel's own `isInitialized` flag rather than sleeping a fixed
// interval. The channel runs `init()` via `setTimeout(0)`, and under heavy
// parallel-test load that callback can be pushed well past any fixed deadline
// — a `writeMessagesToFile` call that lands before init returns early
// (`!isInitialized`), so the buffer never reaches disk within the poll window
// and the assertion flakes. Waiting for the real flag removes the race.
async function waitForInit(channel?: FileLog) {
  if (!channel) {
    await new Promise((resolve) => setTimeout(resolve, 50));

    return;
  }

  await waitForCondition(
    () => (channel as unknown as { isInitialized: boolean }).isInitialized,
  );
}

function dataFor(overrides: Partial<LoggingData> = {}): LoggingData {
  return {
    type: "info",
    module: "mod",
    action: "act",
    message: "hello",
    ...overrides,
  };
}

describe("FileLog", () => {
  let storagePath: string;
  // Every channel built in a test is registered here so `afterEach` can
  // `dispose()` it — that clears the 5-second background-flush `setInterval`
  // each channel arms in `init()`. Without disposal the interval (and any
  // deferred `setTimeout(0)` `init()`) fires AFTER the temp dir is removed,
  // writing to a now-missing path and surfacing as an unhandled
  // ENOENT/EPERM rejection that flakes the whole file.
  let channels: FileLog[];

  function track(channel: FileLog): FileLog {
    channels.push(channel);

    return channel;
  }

  beforeEach(() => {
    storagePath = createTempDir();
    channels = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    // Wait for every channel's `setTimeout(0)` `init()` to finish before we
    // dispose: `init()` is fire-and-forget and not cancelable, and it re-arms
    // the 5-second background interval. Disposing only *after* init has run
    // guarantees that interval is the one we clear, and that no late `init()`
    // calls `mkdir` on the directory after we delete it below. The directory
    // still exists here (we remove it last), so every `init()` succeeds and
    // flips `isInitialized`.
    await waitForCondition(() =>
      channels.every(
        (channel) =>
          (channel as unknown as { isInitialized: boolean }).isInitialized,
      ),
    );

    for (const channel of channels) {
      try {
        channel.dispose();
      } catch {
        // Disposal flushes synchronously; a failed flush (e.g. a test that
        // mocked the filesystem to reject) must not mask the real assertion.
      }
    }

    vi.restoreAllMocks();
    removeDir(storagePath);
  });

  describe("identity and defaults", () => {
    it("is named 'file' and is non-terminal", () => {
      const channel = track(new FileLog({ storagePath }));

      expect(channel.name).toBe("file");
      expect(channel.terminal).toBe(false);
    });

    it("exposes the configured storage path", () => {
      const channel = track(new FileLog({ storagePath }));

      expect(channel.storagePath).toBe(storagePath);
    });

    it("defaults name to 'app' and extension to 'log'", () => {
      const channel = track(new FileLog({ storagePath }));

      expect(channel.fileName).toBe("app");
      expect(channel.extension).toBe("log");
    });

    it("honors custom name and extension", () => {
      const channel = track(new FileLog({ storagePath, name: "audit", extension: "txt" }));

      expect(channel.fileName).toBe("audit");
      expect(channel.extension).toBe("txt");
      expect(channel.filePath).toBe(path.join(storagePath, "audit.txt"));
    });
  });

  describe("fileName by chunk mode", () => {
    it("single chunk returns the raw name", () => {
      const channel = track(new FileLog({ storagePath, chunk: "single", name: "app" }));

      expect(channel.fileName).toBe("app");
    });

    it("daily chunk returns a date-based name", () => {
      const channel = track(new FileLog({ storagePath, chunk: "daily" }));

      expect(channel.fileName).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    });

    it("hourly chunk returns a date-and-hour-based name", () => {
      const channel = track(new FileLog({ storagePath, chunk: "hourly" }));

      expect(channel.fileName).toMatch(/^\d{2}-\d{2}-\d{4}-\d{2}-00-00-(am|pm)$/);
    });
  });

  describe("writing", () => {
    it("creates the storage directory on init", async () => {
      removeDir(storagePath);
      const channel = track(new FileLog({ storagePath }));

      // Poll rather than sleep a fixed interval: the channel's `init()` is
      // scheduled via `setTimeout(0)`, and under heavy parallel-test load the
      // event loop can push that callback past a fixed deadline, producing a
      // false negative. `waitForFile` works for directories too (it stats the
      // path), so it returns as soon as `ensureDirectoryAsync` has run.
      await waitForFile(storagePath);

      expect(fs.existsSync(storagePath)).toBe(true);

      void channel;
    });

    it("writes the buffer to disk after flushSync", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "hello" }));
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toContain("[mod][act]: hello");
    });

    it("formats a line with [date] [level] [module][action]: message", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ type: "warn", module: "billing", action: "charge", message: "oops" }));
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toMatch(/\[.+\] \[warn\] \[billing\]\[charge\]: oops/);
    });

    it("flushes once the buffer reaches maxMessagesToWrite", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 3 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "one" }));
      await channel.log(dataFor({ message: "two" }));
      await channel.log(dataFor({ message: "three" }));

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (fs.existsSync(channel.filePath)) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(fs.existsSync(channel.filePath)).toBe(true);

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toContain("one");
      expect(contents).toContain("two");
      expect(contents).toContain("three");
    });

    it("respects the levels filter", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          levels: ["error"],
          maxMessagesToWrite: 1000,
        }),
      );

      await waitForInit(channel);

      await channel.log(dataFor({ type: "info", message: "skipped" }));
      await channel.log(dataFor({ type: "error", message: "kept" }));
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).not.toContain("skipped");
      expect(contents).toContain("kept");
    });

    it("respects a custom filter", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          filter: (data) => data.module === "allowed",
          maxMessagesToWrite: 1000,
        }),
      );

      await waitForInit(channel);

      await channel.log(dataFor({ module: "allowed", message: "in" }));
      await channel.log(dataFor({ module: "denied", message: "out" }));
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toContain("in");
      expect(contents).not.toContain("out");
    });

    it("captures the stack trace when message is an Error", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      const error = new Error("boom");
      await channel.log(dataFor({ type: "error", message: error }));
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toContain("boom");
      expect(contents).toContain("[trace]");
    });

    it("lays an Error out as message line, then [trace], then the stack", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      const error = new Error("kaboom");
      error.stack = "Error: kaboom\n    at top (a.ts:1:1)\n    at next (b.ts:2:2)";

      await channel.log(
        dataFor({ type: "error", module: "billing", action: "charge", message: error }),
      );
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      // Header carries the error's `.message`; the trace marker and the raw
      // stack follow on their own lines.
      expect(contents).toMatch(/\[error\] \[billing\]\[charge\]: kaboom/);
      expect(contents).toContain("[trace]");
      expect(contents).toContain("at top (a.ts:1:1)");
      expect(contents).toContain("at next (b.ts:2:2)");
      // Order: the message line precedes [trace], which precedes the stack body.
      const messageIndex = contents.indexOf(": kaboom");
      const traceIndex = contents.indexOf("[trace]");
      const stackIndex = contents.indexOf("at top (a.ts:1:1)");
      expect(messageIndex).toBeLessThan(traceIndex);
      expect(traceIndex).toBeLessThan(stackIndex);
    });

    it("stringifies a non-string scalar message into the content line", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: 42 as unknown as string }));
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toContain("[mod][act]: 42");
    });
  });

  describe("flushSync", () => {
    it("is a no-op when buffer is empty", async () => {
      const channel = track(new FileLog({ storagePath }));

      await waitForInit(channel);

      expect(() => channel.flushSync()).not.toThrow();
      expect(fs.existsSync(channel.filePath)).toBe(false);
    });

    it("appends multiple flushes to the same file", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "first-batch" }));
      channel.flushSync();

      await channel.log(dataFor({ message: "second-batch" }));
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toContain("first-batch");
      expect(contents).toContain("second-batch");
    });
  });

  describe("flush", () => {
    it("writes the buffer to disk asynchronously", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "via-async-flush" }));
      await channel.flush();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toContain("[mod][act]: via-async-flush");
    });

    it("is a no-op when the buffer is empty", async () => {
      const channel = track(new FileLog({ storagePath }));

      await waitForInit(channel);

      await expect(channel.flush()).resolves.toBeUndefined();
      expect(fs.existsSync(channel.filePath)).toBe(false);
    });

    it("drains grouped buffers into per-group files", async () => {
      const channel = track(
        new FileLog({ storagePath, groupBy: ["level"], maxMessagesToWrite: 1000 }),
      );

      await waitForInit(channel);

      await channel.log(dataFor({ type: "error", message: "grouped-flush" }));
      await channel.flush();

      const filePath = path.join(storagePath, "error", `${channel.fileName}.${channel.extension}`);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toContain("grouped-flush");
    });
  });

  describe("groupBy", () => {
    it("writes into a per-level subdirectory when groupBy=['level']", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          groupBy: ["level"],
          maxMessagesToWrite: 1000,
        }),
      );

      await waitForInit(channel);

      await channel.log(dataFor({ type: "error", message: "boom" }));
      channel.flushSync();

      const filePath = path.join(storagePath, "error", `${channel.fileName}.${channel.extension}`);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toContain("boom");
    });

    it("writes into a per-module subdirectory when groupBy=['module']", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          groupBy: ["module"],
          maxMessagesToWrite: 1000,
        }),
      );

      await waitForInit(channel);

      await channel.log(dataFor({ module: "payments", message: "paid" }));
      channel.flushSync();

      const filePath = path.join(storagePath, "payments", `${channel.fileName}.${channel.extension}`);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("nests subdirectories in the configured order", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          groupBy: ["level", "module", "action"],
          maxMessagesToWrite: 1000,
        }),
      );

      await waitForInit(channel);

      await channel.log(dataFor({
        type: "error",
        module: "billing",
        action: "charge",
        message: "x",
      }));

      channel.flushSync();

      const filePath = path.join(
        storagePath,
        "error",
        "billing",
        "charge",
        `${channel.fileName}.${channel.extension}`,
      );

      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe("async buffer write", () => {
    it("writes grouped files via the async path when the buffer fills", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          groupBy: ["module"],
          maxMessagesToWrite: 1,
        }),
      );

      await waitForInit(channel);

      await channel.log(dataFor({ module: "orders", message: "placed" }));

      const filePath = path.join(storagePath, "orders", `${channel.fileName}.${channel.extension}`);

      await waitForFile(filePath);

      expect(fs.readFileSync(filePath, "utf-8")).toContain("placed");
    });
  });

  describe("write failures", () => {
    it("reports a write error without throwing and clears the writing flag", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1 }));

      await waitForInit(channel);

      const errorSpy = vi.spyOn(console, "error");
      vi.spyOn(fs, "createWriteStream").mockReturnValue({
        write: (_content: unknown, callback: (error: Error) => void) => {
          callback(new Error("disk full"));

          return false;
        },
        end: () => {},
      } as unknown as fs.WriteStream);

      await channel.log(dataFor({ message: "doomed" }));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(errorSpy).toHaveBeenCalledWith("Failed to write log:", expect.any(Error));
    });
  });

  describe("dispose", () => {
    it("flushes buffered entries and stops the background interval", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "drained-on-dispose" }));
      channel.dispose();

      expect(fs.readFileSync(channel.filePath, "utf-8")).toContain("drained-on-dispose");
    });

    it("is safe to call more than once", async () => {
      const channel = track(new FileLog({ storagePath }));

      await waitForInit(channel);

      expect(() => {
        channel.dispose();
        channel.dispose();
      }).not.toThrow();
    });
  });

  describe("rotation", () => {
    it("rotates the current file when it exceeds maxFileSize", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          maxMessagesToWrite: 1,
          maxFileSize: 50,
          rotate: true,
        }),
      );

      await waitForInit(channel);

      fs.writeFileSync(channel.filePath, "x".repeat(100));

      await channel.log(dataFor({ message: "after-rotation" }));

      await new Promise((resolve) => setTimeout(resolve, 250));

      const filesInStorage = fs.readdirSync(storagePath);
      const rotatedFiles = filesInStorage.filter((file) => file !== `${channel.fileName}.${channel.extension}`);

      expect(rotatedFiles.length).toBeGreaterThan(0);
    });

    it("does not rotate when rotate=false", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          maxMessagesToWrite: 1,
          maxFileSize: 10,
          rotate: false,
        }),
      );

      await waitForInit(channel);

      fs.writeFileSync(channel.filePath, "x".repeat(50));

      await channel.log(dataFor({ message: "keep" }));

      await new Promise((resolve) => setTimeout(resolve, 250));

      const filesInStorage = fs.readdirSync(storagePath);

      expect(filesInStorage).toEqual([`${channel.fileName}.${channel.extension}`]);
    });
  });
});
