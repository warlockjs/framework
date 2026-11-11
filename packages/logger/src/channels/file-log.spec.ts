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

  await waitForCondition(() => (channel as unknown as { isInitialized: boolean }).isInitialized);
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
      channels.every((channel) => (channel as unknown as { isInitialized: boolean }).isInitialized),
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

      expect(channel.fileName).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("hourly chunk returns a date-and-hour-based name", () => {
      const channel = track(new FileLog({ storagePath, chunk: "hourly" }));

      expect(channel.fileName).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}$/);
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

      await channel.log(
        dataFor({ type: "warn", module: "billing", action: "charge", message: "oops" }),
      );
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

      const filePath = path.join(
        storagePath,
        "payments",
        `${channel.fileName}.${channel.extension}`,
      );

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

      await channel.log(
        dataFor({
          type: "error",
          module: "billing",
          action: "charge",
          message: "x",
        }),
      );

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
      const reporter = vi.fn();

      channel.setErrorReporter(reporter);

      await waitForInit(channel);

      vi.spyOn(fs.promises, "appendFile").mockRejectedValue(new Error("disk full"));

      await channel.log(dataFor({ message: "doomed" }));

      expect(reporter).toHaveBeenCalledWith(
        expect.objectContaining({ message: "disk full" }),
        expect.objectContaining({ module: "logger", action: "write" }),
      );
      expect((channel as unknown as { isWriting: boolean }).isWriting).toBe(false);
    });

    it("keeps the entries of a failed write buffered and writes them on the next flush", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1 }));

      channel.setErrorReporter(() => {});

      await waitForInit(channel);

      const append = vi.spyOn(fs.promises, "appendFile").mockRejectedValueOnce(new Error("busy"));

      await channel.log(dataFor({ message: "first" }));

      append.mockRestore();

      await channel.flush();

      expect(fs.readFileSync(channel.filePath, "utf-8")).toContain("[mod][act]: first");
    });

    it("does not crash the process when the log directory disappears; it recreates it", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));
      const reporter = vi.fn();
      const uncaught = vi.fn();

      channel.setErrorReporter(reporter);
      process.on("uncaughtException", uncaught);

      try {
        await waitForInit(channel);

        removeDir(storagePath);

        await channel.log(dataFor({ message: "after removal" }));
        await channel.flush();

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(uncaught).not.toHaveBeenCalled();
        expect(fs.readFileSync(channel.filePath, "utf-8")).toContain("after removal");
      } finally {
        process.off("uncaughtException", uncaught);
      }
    });

    it("reports, and never throws, when the log path cannot be opened at all", async () => {
      const blocker = path.join(storagePath, "not-a-directory");

      fs.writeFileSync(blocker, "");

      const channel = track(new FileLog({ storagePath: blocker, maxMessagesToWrite: 1 }));
      const reporter = vi.fn();
      const uncaught = vi.fn();

      channel.setErrorReporter(reporter);
      process.on("uncaughtException", uncaught);

      try {
        // `init()` cannot create the directory either: reported, not thrown.
        await channel.ready;

        expect(reporter).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ action: "init" }),
        );

        await channel.log(dataFor({ message: "nowhere to go" }));
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(uncaught).not.toHaveBeenCalled();
        expect(reporter).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ action: "write" }),
        );
      } finally {
        process.off("uncaughtException", uncaught);
        channels.splice(channels.indexOf(channel), 1);
      }
    });

    it("drops the oldest entries past maxBufferedMessages and reports it once", async () => {
      const channel = track(
        new FileLog({ storagePath, maxMessagesToWrite: 2, maxBufferedMessages: 5 }),
      );
      const reporter = vi.fn();

      channel.setErrorReporter(reporter);

      await waitForInit(channel);

      vi.spyOn(fs.promises, "appendFile").mockRejectedValue(new Error("read-only"));

      for (let index = 0; index < 20; index++) {
        await channel.log(dataFor({ message: `entry-${index}` }));
      }

      const buffered = (channel as unknown as { messages: Array<{ content: string }> }).messages;

      expect(buffered).toHaveLength(5);
      expect(buffered.at(-1)?.content).toContain("entry-19");

      const overflowReports = reporter.mock.calls.filter(
        ([, entry]) => (entry as LoggingData).action === "buffer",
      );

      expect(overflowReports).toHaveLength(1);

      vi.restoreAllMocks();
      channels.splice(channels.indexOf(channel), 1);
      channel.dispose();
    });
  });

  describe("entries logged while a write is in flight", () => {
    it("writes every entry when logs keep arriving during writes", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 10 }));

      await waitForInit(channel);

      const pending: Array<void | Promise<void>> = [];

      for (let index = 0; index < 5000; index++) {
        pending.push(channel.log(dataFor({ message: `entry-${index}` })));

        // Yield now and then so writes start while more entries arrive.
        if (index % 50 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      await Promise.all(pending);
      await channel.flush();

      const lines = fs.readFileSync(channel.filePath, "utf-8").trim().split(/\r?\n/);

      expect(lines).toHaveLength(5000);
      expect(new Set(lines.map((line) => line.split(": ").at(-1))).size).toBe(5000);
    });

    it("writes every entry on the grouped path too", async () => {
      const channel = track(
        new FileLog({ storagePath, maxMessagesToWrite: 10, groupBy: ["level"] }),
      );

      await waitForInit(channel);

      const pending: Array<void | Promise<void>> = [];

      for (let index = 0; index < 1000; index++) {
        pending.push(channel.log(dataFor({ message: `entry-${index}` })));

        if (index % 25 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      await Promise.all(pending);
      await channel.flush();

      const filePath = path.join(storagePath, "info", `${channel.fileName}.log`);

      expect(fs.readFileSync(filePath, "utf-8").trim().split(/\r?\n/)).toHaveLength(1000);
    });
  });

  describe("message escaping", () => {
    it("keeps each entry on one line and removes terminal escapes", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(
        dataFor({
          message: "a\n[01-01-2026 10:00:00] [info] [auth][login]: forged\u001b]52;c;eA==\u0007",
        }),
      );
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents.trim().split(/\r?\n/)).toHaveLength(1);
      expect(contents).toContain("a\\n[01-01-2026 10:00:00]");
      expect(contents).not.toContain("\u001b");
      expect(contents).not.toContain("\u0007");
    });

    it("writes an Error's stack trace as is", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000 }));
      const error = new Error("bad\ninput");

      await waitForInit(channel);

      await channel.log(dataFor({ type: "error", message: error }));
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toContain("bad\\ninput");
      expect(contents).toContain(String(error.stack));
    });

    it("writes line breaks raw with escape: false, still removing terminal escapes", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1000, escape: false }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "line one\nline two\u001b[2J" }));
      channel.flushSync();

      const contents = fs.readFileSync(channel.filePath, "utf-8");

      expect(contents).toContain("line one\nline two");
      expect(contents).not.toContain("\u001b");
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

    it("never keeps the process alive through its background flush interval", async () => {
      const channel = track(new FileLog({ storagePath }));

      await waitForInit(channel);

      const handle = (channel as unknown as { flushIntervalHandle?: NodeJS.Timeout })
        .flushIntervalHandle;

      expect(handle).toBeDefined();
      expect(handle?.hasRef()).toBe(false);
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
      const rotatedFiles = filesInStorage.filter(
        (file) => file !== `${channel.fileName}.${channel.extension}`,
      );

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

  describe("lifecycle", () => {
    it("resolves ready once the deferred init has created the directory", async () => {
      const nested = path.join(storagePath, "nested", "logs");
      const channel = track(new FileLog({ storagePath: nested }));

      await channel.ready;

      expect(fs.existsSync(nested)).toBe(true);
      expect(
        (channel as unknown as { flushIntervalHandle?: unknown }).flushIntervalHandle,
      ).toBeDefined();
    });

    it("skips init when disposed before it runs, so no flush timer is armed", async () => {
      const nested = path.join(storagePath, "never-created");
      const channel = new FileLog({ storagePath: nested });

      channel.dispose();
      await channel.ready;

      expect(fs.existsSync(nested)).toBe(false);
      expect(
        (channel as unknown as { flushIntervalHandle?: unknown }).flushIntervalHandle,
      ).toBeUndefined();
    });
  });
});
