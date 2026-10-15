import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSpan, makeTrace } from "../test-support/make-trace";
import type { TraceRecord } from "./file-exporter.type";
import { fileExporter } from "./file-exporter";

describe("fileExporter", () => {
  let directory: string;
  let path: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "panoptic-file-"));
    path = join(directory, "nested", "traces.jsonl");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function readRecords(): Promise<TraceRecord[]> {
    const contents = await readFile(path, "utf8");

    return contents
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as TraceRecord);
  }

  it("should advertise the file name", () => {
    expect(fileExporter({ path }).name).toBe("file");
  });

  it("should append one JSON-Lines record per trace, creating the directory", async () => {
    const exporter = fileExporter({ path });

    await exporter.export(makeTrace(makeSpan({ traceId: "t1" })));
    await exporter.export(makeTrace(makeSpan({ traceId: "t2", spanId: "s2" })));

    const records = await readRecords();
    expect(records).toHaveLength(2);
    expect(records[0].type).toBe("trace");
    expect(records[0].trace.traceId).toBe("t1");
    expect(records[1].trace.traceId).toBe("t2");
    expect(typeof records[0].exportedAt).toBe("string");
  });

  it("should buffer until flushEvery is reached, then drain on flush", async () => {
    const exporter = fileExporter({ path, flushEvery: 3 });

    await exporter.export(makeTrace(makeSpan({ traceId: "t1" })));
    await exporter.export(makeTrace(makeSpan({ traceId: "t2", spanId: "s2" })));

    await expect(readFile(path, "utf8")).rejects.toThrow();

    await exporter.flush?.();

    expect(await readRecords()).toHaveLength(2);
  });

  it("should drain the buffer on shutdown", async () => {
    const exporter = fileExporter({ path, flushEvery: 100 });

    await exporter.export(makeTrace(makeSpan({ traceId: "t1" })));
    await exporter.shutdown?.();

    expect(await readRecords()).toHaveLength(1);
  });

  it("should keep one record per physical line in compact mode", async () => {
    const exporter = fileExporter({ path });

    await exporter.export(makeTrace(makeSpan({ traceId: "t1" })));

    const contents = await readFile(path, "utf8");
    const lines = contents.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
  });
});
