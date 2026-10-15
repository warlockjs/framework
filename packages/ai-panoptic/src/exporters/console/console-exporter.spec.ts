import { describe, expect, it, vi } from "vitest";
import { makeSpan, makeTrace } from "../test-support/make-trace";
import type { ConsoleLike } from "./console-exporter.type";
import { consoleExporter } from "./console-exporter";

type SinkMock = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

function makeSink(): ConsoleLike & { log: SinkMock; error: SinkMock } {
  return {
    log: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  };
}

describe("consoleExporter", () => {
  it("should advertise the console name", () => {
    expect(consoleExporter().name).toBe("console");
  });

  it("should print one summary line per completed trace to log", async () => {
    const sink = makeSink();
    const exporter = consoleExporter({ console: sink });

    await exporter.export(makeTrace(makeSpan({ name: "checkout", type: "workflow" })));

    expect(sink.log).toHaveBeenCalledTimes(1);
    expect(sink.error).not.toHaveBeenCalled();
    expect(sink.log.mock.calls[0][0]).toContain('workflow "checkout"');
    expect(sink.log.mock.calls[0][0]).toContain("300 tok");
  });

  it("should route failed traces to error", async () => {
    const sink = makeSink();
    const exporter = consoleExporter({ console: sink });

    await exporter.export(
      makeTrace(
        makeSpan({
          status: "failed",
          error: { type: "ToolError", message: "boom" },
        }),
      ),
    );

    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(sink.error.mock.calls[0][0]).toContain("ToolError: boom");
  });

  it("should print the full indented tree when tree=true", async () => {
    const sink = makeSink();
    const exporter = consoleExporter({ console: sink, tree: true });

    const root = makeSpan({
      spanId: "a",
      name: "router",
      children: [makeSpan({ spanId: "b", name: "search-tool", type: "tool" })],
    });

    await exporter.export(makeTrace(root));

    const lines = sink.log.mock.calls.map((call) => call[0] as string);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('agent "router"');
    expect(lines[1]).toMatch(/^ {2}ok tool "search-tool"/);
  });

  it("should omit exportSpan unless streaming is enabled", () => {
    expect(consoleExporter().exportSpan).toBeUndefined();
    expect(consoleExporter({ streaming: true }).exportSpan).toBeTypeOf("function");
  });

  it("should print live spans via exportSpan when streaming", () => {
    const sink = makeSink();
    const exporter = consoleExporter({ console: sink, streaming: true });

    exporter.exportSpan?.(makeSpan({ name: "live", type: "tool" }));

    expect(sink.log).toHaveBeenCalledTimes(1);
    expect(sink.log.mock.calls[0][0]).toContain('tool "live"');
  });

  it("should print in:/out: lines beneath a span when io=true", async () => {
    const sink = makeSink();
    const exporter = consoleExporter({ console: sink, tree: true, io: true });

    await exporter.export(
      makeTrace(
        makeSpan({ name: "market-research", input: "Research the market", output: "Demand is steady" }),
      ),
    );

    const lines = sink.log.mock.calls.map((call) => call[0] as string);
    expect(lines.some((line) => line.includes('agent "market-research"'))).toBe(true);
    expect(lines.some((line) => line.includes("in:  Research the market"))).toBe(true);
    expect(lines.some((line) => line.includes("out: Demand is steady"))).toBe(true);
  });

  it("should omit io lines by default", async () => {
    const sink = makeSink();
    const exporter = consoleExporter({ console: sink, tree: true });

    await exporter.export(makeTrace(makeSpan({ input: "x", output: "y" })));

    const lines = sink.log.mock.calls.map((call) => call[0] as string);
    expect(lines.some((line) => line.includes("in:"))).toBe(false);
  });

  it("should truncate captured content to ioMaxChars", async () => {
    const sink = makeSink();
    const exporter = consoleExporter({ console: sink, io: true, ioMaxChars: 5 });

    await exporter.export(makeTrace(makeSpan({ output: "abcdefghij" })));

    const outLine = sink.log.mock.calls
      .map((call) => call[0] as string)
      .find((line) => line.includes("out:"));
    expect(outLine).toContain("out: abcde…");
  });

  it("should JSON-stringify non-string captured content", async () => {
    const sink = makeSink();
    const exporter = consoleExporter({ console: sink, io: true });

    await exporter.export(makeTrace(makeSpan({ type: "tool", input: { q: "x" } })));

    const inLine = sink.log.mock.calls
      .map((call) => call[0] as string)
      .find((line) => line.includes("in:"));
    expect(inLine).toContain('in:  {"q":"x"}');
  });

  it("should print io live when streaming + io", () => {
    const sink = makeSink();
    const exporter = consoleExporter({ console: sink, streaming: true, io: true });

    exporter.exportSpan?.(makeSpan({ name: "live", output: "done" }));

    const lines = sink.log.mock.calls.map((call) => call[0] as string);
    expect(lines.some((line) => line.includes("out: done"))).toBe(true);
  });
});
