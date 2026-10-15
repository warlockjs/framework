import { describe, expect, it } from "vitest";
import type { DoctorReport } from "../../../../src/cli/commands/doctor/check.types";
import { formatReportLines } from "../../../../src/cli/commands/doctor/format-report";

/**
 * Unit coverage for the doctor report FORMATTER (the plain-line variant used
 * for color-free assertions): one symbol-prefixed line per check plus a blank
 * spacer and a summary line.
 */

const buildReport = (): DoctorReport => ({
  results: [
    { name: "routes", status: "ok", detail: "42 registered" },
    { name: "optional-peers", status: "warn", detail: "@aws-sdk/client-s3 not installed" },
    { name: "config", status: "fail", detail: "missing required config section(s): http" },
  ],
  summary: { ok: 1, warn: 1, fail: 1 },
  hasFailures: true,
  exitCode: 1,
});

describe("formatReportLines", () => {
  it("renders one status-prefixed line per check", () => {
    const lines = formatReportLines(buildReport());

    expect(lines[0]).toBe("✓ routes: 42 registered");
    expect(lines[1]).toBe("⚠ optional-peers: @aws-sdk/client-s3 not installed");
    expect(lines[2]).toBe("✗ config: missing required config section(s): http");
  });

  it("appends a blank spacer and a summary line with per-status counts", () => {
    const lines = formatReportLines(buildReport());

    expect(lines[lines.length - 2]).toBe("");
    expect(lines[lines.length - 1]).toBe("Summary: 1 ok, 1 warn, 1 fail");
  });
});
