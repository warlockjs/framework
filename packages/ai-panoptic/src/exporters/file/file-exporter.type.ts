import type { Trace } from "../../contracts";

/**
 * One JSON-Lines record the {@link fileExporter} appends per trace. A
 * thin envelope around {@link Trace} carrying the wire-format `type` and
 * the time the line was written, so a downstream reader can tell records
 * apart and order them without re-deriving anything from the payload.
 */
export type TraceRecord = {
  /** Discriminator for the record format — always `"trace"` today. */
  type: "trace";
  /** ISO-8601 timestamp the exporter wrote this record. */
  exportedAt: string;
  /** The completed trace, verbatim. */
  trace: Trace;
};

/**
 * Options for {@link fileExporter}.
 */
export type FileExporterOptions = {
  /**
   * Absolute or cwd-relative path of the JSON-Lines file traces are
   * appended to. The parent directory is created on first write if
   * missing. Required.
   */
  path: string;
  /**
   * Flush the in-memory buffer to disk once it reaches this many traces.
   * Lower values mean more frequent, smaller writes; higher values batch
   * for throughput. Defaults to `1` (write every trace immediately).
   */
  flushEvery?: number;
  /**
   * Pretty-print each record across multiple lines instead of one
   * compact JSON line. Defaults to `false` — compact keeps the file
   * valid JSON Lines (one record per line).
   */
  pretty?: boolean;
};
