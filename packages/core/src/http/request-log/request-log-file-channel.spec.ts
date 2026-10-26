import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RequestLogFileChannel,
  selectRequestLogFilesToPrune,
  type RequestLogFile,
} from "./request-log-file-channel";

const MB = 1024 * 1024;
const now = Date.UTC(2026, 9, 24, 12, 0, 0);
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function file(
  name: string,
  sizeMb = 1,
  modifiedAt = Date.parse(name.slice(0, 10)),
): RequestLogFile {
  return { name, sizeBytes: sizeMb * MB, modifiedAt };
}

describe("selectRequestLogFilesToPrune", () => {
  const policy = { maxDays: 3, maxSizeMb: 100 };

  it("deletes files older than maxDays and keeps the rest", () => {
    const files = [
      file("2026-10-24.jsonl"),
      file("2026-10-22.jsonl"),
      file("2026-10-21.jsonl"),
      file("2026-10-20.jsonl"),
      file("2026-09-01.jsonl"),
    ];

    expect(selectRequestLogFilesToPrune(files, policy, "2026-10-24.jsonl", now).sort()).toEqual([
      "2026-09-01.jsonl",
      "2026-10-20.jsonl",
    ]);
  });

  it("deletes the oldest files while the directory exceeds maxSizeMb", () => {
    const files = [
      file("2026-10-24.jsonl", 40),
      file("2026-10-23.jsonl", 40),
      file("2026-10-22.jsonl", 40),
    ];

    expect(selectRequestLogFilesToPrune(files, policy, "2026-10-24.jsonl", now)).toEqual([
      "2026-10-22.jsonl",
    ]);
  });

  it("never deletes the active file, even when it alone is too large", () => {
    const files = [file("2026-10-24.jsonl", 500)];

    expect(selectRequestLogFilesToPrune(files, policy, "2026-10-24.jsonl", now)).toEqual([]);
  });

  it("counts size-rotated files of a day and ignores other files", () => {
    const files = [
      file("2026-10-24.jsonl", 60),
      file("2026-10-24-2026-10-24-1792843200000.jsonl", 60),
      { name: "notes.txt", sizeBytes: 900 * MB, modifiedAt: 0 },
    ];

    expect(selectRequestLogFilesToPrune(files, policy, "2026-10-24.jsonl", now)).toEqual([
      "2026-10-24-2026-10-24-1792843200000.jsonl",
    ]);
  });
});

describe("RequestLogFileChannel", () => {
  function directory(): string {
    const created = fs.mkdtempSync(path.join(os.tmpdir(), "request-log-"));

    directories.push(created);

    return created;
  }

  it("writes one JSON line per record to a daily .jsonl file", async () => {
    const storagePath = directory();
    const channel = new RequestLogFileChannel({
      storagePath,
      retention: { maxDays: 14, maxSizeMb: 256 },
    });

    await channel.ready;

    channel.log({
      type: "info",
      module: "http",
      action: "request",
      message: "GET /a 200 1ms",
      context: { type: "request", id: "a", status: 200 },
    });
    channel.log({
      type: "info",
      module: "http",
      action: "request",
      message: "GET /b 200 1ms",
      context: { type: "request", id: "b", status: 200 },
    });
    channel.flushSync();
    channel.dispose();

    const files = fs.readdirSync(storagePath);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);

    const lines = fs
      .readFileSync(path.join(storagePath, files[0] as string), "utf8")
      .trim()
      .split("\n");

    expect(lines.map((line) => JSON.parse(line).id)).toEqual(["a", "b"]);
  });

  it("prunes old files on demand", async () => {
    const storagePath = directory();
    const old = path.join(storagePath, "2020-01-01.jsonl");

    fs.writeFileSync(old, "{}\n");
    fs.writeFileSync(path.join(storagePath, "keep.txt"), "x");

    const channel = new RequestLogFileChannel({
      storagePath,
      retention: { maxDays: 7, maxSizeMb: 256 },
    });

    await channel.ready;
    await channel.prune();
    channel.dispose();

    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(path.join(storagePath, "keep.txt"))).toBe(true);
  });
});
