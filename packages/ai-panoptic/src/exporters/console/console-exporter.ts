import type { ExporterContract, Trace, TraceSpan } from "../../contracts";
import { walkSpans } from "../utils";
import type { ConsoleExporterOptions, ConsoleLike } from "./console-exporter.type";
import { formatSpanLine } from "./format-span-line";

const EXPORTER_NAME = "console";

/**
 * Zero-dependency {@link ExporterContract} that prints traces to a
 * console-like sink. The simplest exporter — useful in development and
 * as the reference implementation of the contract.
 *
 * By default it prints one summary line per completed trace. Set
 * `tree: true` to print the full indented span tree, and
 * `streaming: true` to also print each span the moment it finalizes
 * (via the optional `exportSpan` hook).
 *
 * @example
 * collector.use(consoleExporter());
 * // ok workflow "checkout" — 2103ms, 1820 tok, $0.0094
 *
 * @example
 * collector.use(consoleExporter({ tree: true }));
 */
export function consoleExporter(options: ConsoleExporterOptions = {}): ExporterContract {
  const sink: ConsoleLike = options.console ?? console;
  const tree = options.tree ?? false;

  const exporter: ExporterContract = {
    name: EXPORTER_NAME,
    export(trace: Trace): void {
      writeTrace(sink, trace, tree);
    },
  };

  if (options.streaming) {
    exporter.exportSpan = (span: TraceSpan): void => {
      sink.log(formatSpanLine(span));
    };
  }

  return exporter;
}

/**
 * Write a completed trace — either a single root summary line or the
 * full indented tree. Failed traces are routed to `console.error` so
 * they surface at the right severity in log aggregators.
 */
function writeTrace(sink: ConsoleLike, trace: Trace, tree: boolean): void {
  if (!tree) {
    const line = formatSpanLine(trace.root);
    writeAtSeverity(sink, trace.root.status, line);
    return;
  }

  for (const span of walkSpans(trace.root)) {
    const depth = spanDepth(trace.root, span.spanId);
    const line = formatSpanLine(span, depth);
    writeAtSeverity(sink, span.status, line);
  }
}

/**
 * Route a line to `error` when the span failed/cancelled, otherwise to
 * `log`. Keeps healthy traces out of the error stream.
 */
function writeAtSeverity(sink: ConsoleLike, status: TraceSpan["status"], line: string): void {
  if (status === "failed" || status === "cancelled") {
    sink.error(line);
    return;
  }

  sink.log(line);
}

/**
 * Depth of `targetSpanId` below `root` for indentation. Walks the tree
 * once; returns 0 when the span is the root or not found.
 */
function spanDepth(root: TraceSpan, targetSpanId: string, depth = 0): number {
  if (root.spanId === targetSpanId) {
    return depth;
  }

  for (const child of root.children) {
    const found = spanDepth(child, targetSpanId, depth + 1);

    if (found > 0) {
      return found;
    }
  }

  return 0;
}
