import fs from "fs";
import { randomUUID } from "node:crypto";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../logger";
import type { LoggingData } from "../types";
import { FileLog } from "./file-log";
import { JSONFileLog } from "./json-file-log";

// Own parent directory, so no other spec file's cleanup races this one.
const TEST_ROOT = path.join(os.tmpdir(), "warlock-logger-test-file-naming");

const DAY_MS = 24 * 60 * 60 * 1000;

// Local time, so rendered names do not depend on the machine's time zone.
const NOW = new Date(2026, 2, 5, 10, 30, 0);

async function waitForCondition(predicate: () => boolean, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForInit(channel: FileLog) {
  await waitForCondition(() => (channel as unknown as { isInitialized: boolean }).isInitialized);
}

function dataFor(message = "hello"): LoggingData {
  return { type: "info", module: "mod", action: "act", message };
}

/** Create a file whose modification time is `ageDays` before the fake now. */
function touch(filePath: string, ageDays: number, content = "old") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  const time = new Date(Date.now() - ageDays * DAY_MS);
  fs.utimesSync(filePath, time, time);
}

/** Fill the active file past `maxFileSize`, then log once to rotate it. */
async function rotateOnce(channel: FileLog) {
  await waitForInit(channel);
  fs.writeFileSync(channel.filePath, "x".repeat(100));
  await channel.log(dataFor("after rotation"));
}

describe("FileLog naming and retention", () => {
  let storagePath: string;
  let channels: FileLog[];

  function track<T extends FileLog>(channel: T): T {
    channels.push(channel);

    return channel;
  }

  const list = (directory = storagePath) => fs.readdirSync(directory).sort();

  beforeEach(() => {
    storagePath = path.join(TEST_ROOT, randomUUID());
    fs.mkdirSync(storagePath, { recursive: true });
    channels = [];
    // Only the clock is fake: the channel's init and the polling stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await waitForCondition(() =>
      channels.every((channel) => (channel as unknown as { isInitialized: boolean }).isInitialized),
    );

    for (const channel of channels) {
      try {
        channel.dispose();
      } catch {
        // A test that broke the filesystem must not mask its assertion.
      }
    }

    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(storagePath, { recursive: true, force: true });
  });

  describe("file names", () => {
    it("names a daily chunk by sortable ISO date", () => {
      expect(track(new FileLog({ storagePath, chunk: "daily" })).fileName).toBe("2026-03-05");
    });

    it("names an hourly chunk by ISO date and hour", () => {
      expect(track(new FileLog({ storagePath, chunk: "hourly" })).fileName).toBe("2026-03-05-10");
    });

    it("renders a fileName pattern with date and name tokens", () => {
      const channel = track(
        new FileLog({ storagePath, name: "api", fileName: "{name}-{YYYY}-{MM}-{DD}T{HH}{mm}" }),
      );

      expect(channel.fileName).toBe("api-2026-03-05T1030");
      expect(channel.filePath).toBe(path.join(storagePath, "api-2026-03-05T1030.log"));
    });

    it("keeps the previous daily name through a pattern", () => {
      const channel = track(
        new FileLog({ storagePath, chunk: "daily", fileName: "{DD}-{MM}-{YYYY}" }),
      );

      expect(channel.fileName).toBe("05-03-2026");
    });

    it("calls a fileName function with the current date", () => {
      const fileName = vi.fn((date: Date) => `audit-${date.getFullYear()}`);
      const channel = track(new FileLog({ storagePath, fileName }));

      expect(channel.fileName).toBe("audit-2026");
      expect(fileName).toHaveBeenCalledWith(expect.any(Date));
    });

    it("recovers from a fileName function that throws", async () => {
      let broken = true;
      const channel = track(
        new FileLog({
          storagePath,
          maxMessagesToWrite: 1,
          fileName: () => {
            if (broken) throw new Error("no name");
            return "recovered";
          },
        }),
      );
      await waitForInit(channel);

      await channel.log(dataFor("first"));
      expect(console.error).toHaveBeenCalledWith("Failed to write log:", expect.any(Error));

      broken = false;
      await channel.log(dataFor("second"));

      const content = fs.readFileSync(path.join(storagePath, "recovered.log"), "utf-8");
      expect(content).toContain("first");
      expect(content).toContain("second");
    });

    it("keeps a single chunk's name as is", () => {
      expect(track(new FileLog({ storagePath, name: "{odd}" })).fileName).toBe("{odd}");
    });

    it("starts a new file when the dated name rolls over", async () => {
      const channel = track(new FileLog({ storagePath, chunk: "daily", maxMessagesToWrite: 1 }));
      await waitForInit(channel);

      await channel.log(dataFor("day one"));
      vi.setSystemTime(new Date(NOW.getTime() + DAY_MS));
      await channel.log(dataFor("day two"));

      expect(list()).toEqual(["2026-03-05.log", "2026-03-06.log"]);
      expect(fs.readFileSync(path.join(storagePath, "2026-03-06.log"), "utf-8")).toContain(
        "day two",
      );
    });
  });

  describe("rotateFileName", () => {
    it("defaults the rotated name's date part to an ISO date", async () => {
      const channel = track(new FileLog({ storagePath, maxMessagesToWrite: 1, maxFileSize: 50 }));
      await rotateOnce(channel);

      expect(list()).toEqual(["app-2026-03-05-" + NOW.getTime() + ".log", "app.log"]);
    });

    it("renders a rotateFileName pattern at rotation time", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          maxMessagesToWrite: 1,
          maxFileSize: 50,
          rotateFileName: "part-{HH}{mm}",
        }),
      );
      await rotateOnce(channel);

      expect(list()).toContain(`app-part-1030-${NOW.getTime()}.log`);
    });

    it("calls a rotateFileName function and keeps plain text as is", async () => {
      const fn = track(
        new FileLog({
          storagePath,
          name: "fn",
          maxMessagesToWrite: 1,
          maxFileSize: 50,
          rotateFileName: (date) => `y${date.getFullYear()}`,
        }),
      );
      const plain = track(
        new FileLog({
          storagePath,
          name: "plain",
          maxMessagesToWrite: 1,
          maxFileSize: 50,
          rotateFileName: "archive",
        }),
      );
      await rotateOnce(fn);
      await rotateOnce(plain);

      expect(list()).toEqual(
        expect.arrayContaining([
          `fn-y2026-${NOW.getTime()}.log`,
          `plain-archive-${NOW.getTime()}.log`,
        ]),
      );
    });

    it("rotates a grouped file inside its group directory", async () => {
      const channel = track(
        new FileLog({ storagePath, groupBy: ["level"], maxMessagesToWrite: 1, maxFileSize: 50 }),
      );
      await waitForInit(channel);
      const groupDirectory = path.join(storagePath, "info");
      fs.mkdirSync(groupDirectory, { recursive: true });
      fs.writeFileSync(path.join(groupDirectory, "app.log"), "x".repeat(100));

      await channel.log(dataFor("grouped"));

      expect(list(groupDirectory)).toEqual([`app-2026-03-05-${NOW.getTime()}.log`, "app.log"]);
      expect(list()).toEqual(["info"]);
    });
  });

  describe("retention", () => {
    it("keeps the newest maxFiles matching files on boot and never touches others", async () => {
      for (let day = 1; day <= 5; day++) {
        touch(path.join(storagePath, `2026-03-0${day}.log`), 5 - day);
      }
      touch(path.join(storagePath, "notes.txt"), 30);
      touch(path.join(storagePath, "backup-2026-01-01.log"), 30);
      touch(path.join(storagePath, "2026-03.log"), 30);
      fs.mkdirSync(path.join(storagePath, "2026-02-01.log"));

      const channel = track(
        new FileLog({ storagePath, chunk: "daily", retention: { maxFiles: 2 } }),
      );
      await waitForInit(channel);

      // The 5th is today's file (the one being written), so one more is kept.
      expect(list()).toEqual([
        "2026-02-01.log",
        "2026-03-04.log",
        "2026-03-05.log",
        "2026-03.log",
        "backup-2026-01-01.log",
        "notes.txt",
      ]);
    });

    it("removes matching files older than maxAgeDays on boot", async () => {
      touch(path.join(storagePath, "2026-02-01.log"), 32);
      touch(path.join(storagePath, "2026-02-27.log"), 6);
      touch(path.join(storagePath, "2026-03-04.log"), 1);
      touch(path.join(storagePath, "keep-me.log"), 90);

      const channel = track(
        new FileLog({ storagePath, chunk: "daily", retention: { maxAgeDays: 5 } }),
      );
      await waitForInit(channel);

      expect(list()).toEqual(["2026-03-04.log", "keep-me.log"]);
    });

    it("never removes the file being written, however old", async () => {
      touch(path.join(storagePath, "app.log"), 400);
      touch(path.join(storagePath, `app-2025-01-01-${NOW.getTime() - 400 * DAY_MS}.log`), 400);

      const channel = track(
        new FileLog({ storagePath, retention: { maxAgeDays: 1, maxFiles: 1 } }),
      );
      await waitForInit(channel);

      expect(list()).toEqual(["app.log"]);
    });

    it("prunes when the dated name rolls over", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          fileName: "app-{YYYY}-{MM}-{DD}",
          maxMessagesToWrite: 1,
          retention: { maxFiles: 2 },
        }),
      );
      await waitForInit(channel);

      for (let day = 0; day < 4; day++) {
        vi.setSystemTime(new Date(NOW.getTime() + day * DAY_MS));
        await channel.log(dataFor(`day ${day}`));
        // Distinct modification times, newest last.
        const written = path.join(storagePath, `${channel.fileName}.log`);
        const time = new Date(NOW.getTime() + day * DAY_MS);
        fs.utimesSync(written, time, time);
      }

      expect(list()).toEqual(["app-2026-03-07.log", "app-2026-03-08.log"]);
    });

    it("prunes size-rotated archives after a rotation", async () => {
      const channel = track(
        new FileLog({
          storagePath,
          maxMessagesToWrite: 1,
          maxFileSize: 50,
          retention: { maxFiles: 3 },
        }),
      );
      await waitForInit(channel);

      for (let round = 0; round < 5; round++) {
        vi.setSystemTime(new Date(NOW.getTime() + round * 1000));
        fs.writeFileSync(channel.filePath, "x".repeat(100));
        await channel.log(dataFor(`round ${round}`));
        for (const name of list()) {
          const stamp = Number(name.match(/-(\d{13})\.log$/)?.[1] ?? Date.now());
          fs.utimesSync(path.join(storagePath, name), new Date(stamp), new Date(stamp));
        }
      }

      const base = NOW.getTime();
      expect(list()).toEqual([
        `app-2026-03-05-${base + 3000}.log`,
        `app-2026-03-05-${base + 4000}.log`,
        "app.log",
      ]);
    });

    it("applies retention in each group directory", async () => {
      for (const level of ["info", "error"]) {
        touch(path.join(storagePath, level, "2026-03-01.log"), 4);
        touch(path.join(storagePath, level, "2026-03-02.log"), 3);
        touch(path.join(storagePath, level, "readme.md"), 9);
      }

      const channel = track(
        new FileLog({
          storagePath,
          chunk: "daily",
          groupBy: ["level"],
          retention: { maxFiles: 1 },
        }),
      );
      await waitForInit(channel);

      expect(list(path.join(storagePath, "info"))).toEqual(["2026-03-02.log", "readme.md"]);
      expect(list(path.join(storagePath, "error"))).toEqual(["2026-03-02.log", "readme.md"]);
    });

    it("applies to JSONFileLog files by their json extension", async () => {
      touch(path.join(storagePath, "2026-03-01.json"), 4);
      touch(path.join(storagePath, "2026-03-02.json"), 3);
      touch(path.join(storagePath, "2026-03-01.log"), 4);

      const channel = track(
        new JSONFileLog({ storagePath, chunk: "daily", retention: { maxFiles: 1 } }),
      );
      await waitForInit(channel);

      expect(list()).toEqual(["2026-03-01.log", "2026-03-02.json"]);
    });

    it("uses retention.match for a function fileName", async () => {
      touch(path.join(storagePath, "audit-2024.log"), 400);
      touch(path.join(storagePath, "audit-2025.log"), 60);
      touch(path.join(storagePath, "other-2024.log"), 400);

      const channel = track(
        new FileLog({
          storagePath,
          fileName: (date) => `audit-${date.getFullYear()}`,
          retention: { maxFiles: 1, match: /^audit-\d{4}\.log$/g },
        }),
      );
      await waitForInit(channel);
      await channel.prune();

      expect(list()).toEqual(["audit-2025.log", "other-2024.log"]);
    });

    it("reports, once, a function fileName without retention.match and removes nothing", async () => {
      touch(path.join(storagePath, "audit-2024.log"), 400);
      const onChannelError = vi.fn();
      const channel = new FileLog({
        storagePath,
        fileName: (date) => `audit-${date.getFullYear()}`,
        retention: { maxAgeDays: 1 },
      });
      new Logger().configure({ channels: [channel], onChannelError });
      track(channel);
      await waitForInit(channel);
      await channel.prune();

      expect(list()).toEqual(["audit-2024.log"]);
      expect(onChannelError).toHaveBeenCalledTimes(1);
      expect(onChannelError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("retention.match") }),
        channel,
        expect.objectContaining({ module: "logger", action: "retention" }),
      );
    });

    it("reports a failed removal to onChannelError and keeps logging", async () => {
      touch(path.join(storagePath, "2026-03-01.log"), 4);
      touch(path.join(storagePath, "2026-03-02.log"), 3);
      const onChannelError = vi.fn();
      const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
      vi.spyOn(fs.promises, "unlink").mockRejectedValue(denied);

      const channel = new FileLog({
        storagePath,
        chunk: "daily",
        maxMessagesToWrite: 1,
        retention: { maxFiles: 1 },
      });
      const logger = new Logger().configure({ channels: [channel], onChannelError });
      track(channel);
      await waitForInit(channel);

      expect(onChannelError).toHaveBeenCalledTimes(1);
      expect(onChannelError).toHaveBeenCalledWith(denied, channel, expect.any(Object));

      logger.info("mod", "act", "still logging");
      await logger.flush();

      expect(fs.readFileSync(channel.filePath, "utf-8")).toContain("still logging");
    });

    it("routes failures of channels added by addChannel or setChannels", async () => {
      const onChannelError = vi.fn();
      const logger = new Logger().onChannelError(onChannelError);
      const added = track(
        new FileLog({ storagePath, fileName: () => "a", retention: { maxFiles: 1 } }),
      );
      const set = track(
        new FileLog({ storagePath, fileName: () => "b", retention: { maxFiles: 1 } }),
      );
      logger.addChannel(added);
      logger.setChannels([set]);
      await waitForInit(added);
      await waitForInit(set);

      expect(onChannelError.mock.calls.map(([, channel]) => channel)).toEqual(
        expect.arrayContaining([added, set]),
      );
    });

    it("writes a stderr line when the channel has no logger", async () => {
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const channel = track(
        new FileLog({
          storagePath,
          fileName: () => "fixed",
          retention: { maxFiles: 1 },
        }),
      );
      await waitForInit(channel);

      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('channel "file" failed'));
    });

    it("rejects a retention that cannot work", () => {
      expect(() => new FileLog({ storagePath, retention: { maxFiles: 0 } })).toThrow(TypeError);
      expect(() => new FileLog({ storagePath, retention: { maxFiles: 1.5 } })).toThrow(TypeError);
      expect(() => new FileLog({ storagePath, retention: { maxAgeDays: -1 } })).toThrow(TypeError);
    });
  });
});
