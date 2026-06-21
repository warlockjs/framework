import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExporterContract, Trace } from "../../contracts";
import type { FileExporterOptions, TraceRecord } from "./file-exporter.type";

const EXPORTER_NAME = "file";

/**
 * Zero-dependency {@link ExporterContract} that appends completed traces
 * to a JSON-Lines file (one JSON record per line by default). Buffers in
 * memory and flushes either every `flushEvery` traces or on an explicit
 * `flush()` / `shutdown()`, so a batch of traces costs one append.
 *
 * Useful as a durable local sink (replay traces later, ship the file to
 * a backend out of band) and as a test fixture for the pipeline without
 * a vendor SDK.
 *
 * @example
 * collector.use(fileExporter({ path: "storage/traces.jsonl" }));
 * // on shutdown:
 * await collector.shutdown(); // drains the buffer
 */
export function fileExporter(options: FileExporterOptions): ExporterContract {
  const writer = new FileTraceWriter(options);

  return {
    name: EXPORTER_NAME,
    async export(trace: Trace): Promise<void> {
      await writer.add(trace);
    },
    async flush(): Promise<void> {
      await writer.flush();
    },
    async shutdown(): Promise<void> {
      await writer.flush();
    },
  };
}

/**
 * Internal buffered writer for {@link fileExporter}. Owns the pending
 * trace buffer and the directory-created guard across the exporter's
 * lifetime; kept unexported so callers only ever see the factory.
 */
class FileTraceWriter {
  private readonly path: string;
  private readonly flushEvery: number;
  private readonly pretty: boolean;
  private buffer: TraceRecord[] = [];
  private directoryReady = false;

  public constructor(options: FileExporterOptions) {
    this.path = options.path;
    this.flushEvery = Math.max(1, options.flushEvery ?? 1);
    this.pretty = options.pretty ?? false;
  }

  /**
   * Buffer one trace and flush when the buffer reaches `flushEvery`.
   */
  public async add(trace: Trace): Promise<void> {
    this.buffer.push({
      type: "trace",
      exportedAt: new Date().toISOString(),
      trace,
    });

    if (this.buffer.length >= this.flushEvery) {
      await this.flush();
    }
  }

  /**
   * Serialize and append every buffered record, then clear the buffer.
   * No-op when nothing is pending so callers can flush defensively.
   */
  public async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const pending = this.buffer;
    this.buffer = [];

    await this.ensureDirectory();

    const payload = pending.map((record) => this.serialize(record)).join("");

    await appendFile(this.path, payload, "utf8");
  }

  /**
   * Create the parent directory once, lazily, on the first write. Stores
   * a guard so subsequent flushes skip the syscall.
   */
  private async ensureDirectory(): Promise<void> {
    if (this.directoryReady) {
      return;
    }

    await mkdir(dirname(this.path), { recursive: true });
    this.directoryReady = true;
  }

  /**
   * Render one record as a newline-terminated JSON string. Pretty mode
   * indents for human reading; compact mode keeps the file valid JSON
   * Lines (exactly one record per physical line).
   */
  private serialize(record: TraceRecord): string {
    const json = this.pretty
      ? JSON.stringify(record, undefined, 2)
      : JSON.stringify(record);

    return `${json}\n`;
  }
}
