import fs from "fs";
import { randomUUID } from "node:crypto";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggingData } from "../types";
import { JSONFileLog } from "./json-file-log";

// Each spec file owns a distinct parent directory so the parallel test runner
// never lets one file's `afterEach` cleanup (`rmSync` on the parent) race a
// sibling file's deferred channel `init()` (`mkdir` under the same parent) —
// the source of intermittent ENOENT mkdir rejections and the
// "creates the storage directory on init" flake.
const TEST_ROOT = path.join(os.tmpdir(), "warlock-logger-test-json");

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

// Poll the channel's own `isInitialized` flag rather than sleeping a fixed
// interval. The channel runs `init()` via `setTimeout(0)`, and under heavy
// parallel-test load that callback can be pushed well past any fixed deadline
// — a `writeMessagesToFile` call that lands before init returns early
// (`!isInitialized`), so the buffer never reaches disk within the poll window
// and the assertion flakes. Waiting for the real flag removes the race.
async function waitForInit(channel?: JSONFileLog) {
  if (!channel) {
    await new Promise((resolve) => setTimeout(resolve, 50));

    return;
  }

  await waitForCondition(
    () => (channel as unknown as { isInitialized: boolean }).isInitialized,
  );
}

async function waitForFile(filePath: string) {
  await waitForCondition(() => fs.existsSync(filePath));
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

describe("JSONFileLog", () => {
  let storagePath: string;
  // Every channel built in a test is registered here so `afterEach` can
  // `dispose()` it — that clears the 5-second background-flush `setInterval`
  // each channel arms in `init()`. Without disposal the interval (and any
  // deferred `setTimeout(0)` `init()`) fires AFTER the temp dir is removed,
  // writing to a now-missing path and surfacing as an unhandled ENOENT
  // rejection that flakes the whole file.
  let channels: JSONFileLog[];

  function track(channel: JSONFileLog): JSONFileLog {
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

  describe("identity", () => {
    it("is named 'fileJson' with extension 'json'", () => {
      const channel = track(new JSONFileLog({ storagePath }));

      expect(channel.name).toBe("fileJson");
      expect(channel.extension).toBe("json");
    });

    it("ignores attempts to override the extension", () => {
      const channel = track(new JSONFileLog({ storagePath, extension: "txt" }));

      expect(channel.extension).toBe("json");
    });
  });

  describe("writing", () => {
    it("writes a JSON file with a messages array", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "hello" }));
      channel.flushSync();

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(Array.isArray(contents.messages)).toBe(true);
      expect(contents.messages).toHaveLength(1);
      expect(contents.messages[0].content).toBe("hello");
      expect(contents.messages[0].level).toBe("info");
      expect(contents.messages[0].module).toBe("mod");
      expect(contents.messages[0].action).toBe("act");
    });

    it("stores Error stack as an array of strings", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      const error = new Error("boom");
      await channel.log(dataFor({ type: "error", message: error }));
      channel.flushSync();

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(Array.isArray(contents.messages[0].stack)).toBe(true);
      expect(contents.messages[0].stack.length).toBeGreaterThan(0);
      expect(contents.messages[0].content).toBe("boom");
    });

    it("splits the Error stack into one array entry per line", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      const error = new Error("layered");
      error.stack = "Error: layered\n    at one (a.ts:1:1)\n    at two (b.ts:2:2)";

      await channel.log(dataFor({ type: "error", message: error }));
      channel.flushSync();

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(contents.messages[0].stack).toEqual([
        "Error: layered",
        "    at one (a.ts:1:1)",
        "    at two (b.ts:2:2)",
      ]);
      expect(contents.messages[0].content).toBe("layered");
    });

    it("mutates the passed entry's message in place when it is an Error", () => {
      // Characterization: `log()` reassigns `data.message` to the Error's
      // `.message` string before buffering. Pinned so a future refactor that
      // stops mutating the caller's object is a conscious, reviewed change.
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1000 }));

      const error = new Error("mutated");
      const data = dataFor({ type: "error", message: error });

      void channel.log(data);

      expect(data.message).toBe("mutated");
    });

    it("stores a non-Error message verbatim as content", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "plain string content" }));
      channel.flushSync();

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(contents.messages[0].content).toBe("plain string content");
      expect(contents.messages[0].stack).toBeUndefined();
    });

    it("appends across multiple flushes without overwriting previous messages", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "first" }));
      channel.flushSync();

      await channel.log(dataFor({ message: "second" }));
      channel.flushSync();

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(contents.messages).toHaveLength(2);
      expect(contents.messages[0].content).toBe("first");
      expect(contents.messages[1].content).toBe("second");
    });

    it("recovers from a corrupted file by reinitializing the messages array", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      fs.writeFileSync(channel.filePath, "{{not-valid-json");

      await channel.log(dataFor({ message: "after-corruption" }));
      channel.flushSync();

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(contents.messages).toHaveLength(1);
      expect(contents.messages[0].content).toBe("after-corruption");
    });
  });

  describe("context", () => {
    it("retains the context object in the serialized message", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "ctx", context: { userId: 42, role: "admin" } }));
      channel.flushSync();

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(contents.messages[0].context).toEqual({ userId: 42, role: "admin" });
    });

    it("serializes an Error carried inside context with message and stack", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1000 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "had error", context: { cause: new Error("inner") } }));
      channel.flushSync();

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(contents.messages[0].context.cause.message).toBe("inner");
      expect(typeof contents.messages[0].context.cause.stack).toBe("string");
    });
  });

  describe("async buffer write", () => {
    it("writes a valid JSON file when the buffer reaches maxMessagesToWrite", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1 }));

      await waitForInit(channel);

      await channel.log(dataFor({ message: "buffered" }));

      await waitForFile(channel.filePath);

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(contents.messages).toHaveLength(1);
      expect(contents.messages[0].content).toBe("buffered");
    });

    it("recovers from a corrupted file on the async write path", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1 }));

      await waitForInit(channel);

      fs.writeFileSync(channel.filePath, "<<<corrupt>>>");

      await channel.log(dataFor({ message: "recovered" }));

      await waitForCondition(() => {
        try {
          return JSON.parse(fs.readFileSync(channel.filePath, "utf-8")).messages?.[0]?.content === "recovered";
        } catch {
          return false;
        }
      });

      const contents = JSON.parse(fs.readFileSync(channel.filePath, "utf-8"));

      expect(contents.messages).toHaveLength(1);
      expect(contents.messages[0].content).toBe("recovered");
    });

    it("writes grouped JSON files via the async path", async () => {
      const channel = track(
        new JSONFileLog({
          storagePath,
          groupBy: ["module"],
          maxMessagesToWrite: 1,
        }),
      );

      await waitForInit(channel);

      await channel.log(dataFor({ module: "payments", message: "charged" }));

      const filePath = path.join(storagePath, "payments", `${channel.fileName}.json`);

      await waitForFile(filePath);

      const contents = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      expect(contents.messages[0].content).toBe("charged");
    });
  });

  describe("write failures", () => {
    it("reports an async write error without throwing", async () => {
      const channel = track(new JSONFileLog({ storagePath, maxMessagesToWrite: 1 }));

      await waitForInit(channel);

      const errorSpy = vi.spyOn(console, "error");
      vi.spyOn(fs.promises, "writeFile").mockRejectedValue(new Error("disk full"));

      await channel.log(dataFor({ message: "doomed" }));

      await waitForCondition(() => errorSpy.mock.calls.length > 0);

      expect(errorSpy).toHaveBeenCalledWith("Failed to write log:", expect.any(Error));
    });
  });

  describe("grouping", () => {
    it("writes grouped JSON files under the group directory", async () => {
      const channel = track(
        new JSONFileLog({
          storagePath,
          groupBy: ["level"],
          maxMessagesToWrite: 1000,
        }),
      );

      await waitForInit(channel);

      await channel.log(dataFor({ type: "error", message: "boom" }));
      channel.flushSync();

      const filePath = path.join(storagePath, "error", `${channel.fileName}.json`);

      expect(fs.existsSync(filePath)).toBe(true);

      const contents = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      expect(contents.messages).toHaveLength(1);
      expect(contents.messages[0].level).toBe("error");
    });
  });
});
