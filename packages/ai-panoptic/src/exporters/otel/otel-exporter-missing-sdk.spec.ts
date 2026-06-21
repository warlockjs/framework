import { describe, expect, it, vi } from "vitest";
import { makeSpan, makeTrace } from "../test-support/make-trace";

// Simulate @opentelemetry/api NOT being installed: the dynamic import
// rejects, so the loader's flag flips to false and the exporter must
// throw the curated install string — never a raw resolution error.
vi.mock("@opentelemetry/api", () => {
  throw new Error("Cannot find module '@opentelemetry/api'");
});

const { otelExporter } = await import("./otel-exporter");

describe("otelExporter (missing SDK)", () => {
  it("should throw curated install instructions when @opentelemetry/api is absent", async () => {
    const exporter = otelExporter();

    await expect(exporter.export(makeTrace(makeSpan()))).rejects.toThrow(
      /requires the @opentelemetry\/api package/,
    );
  });
});
