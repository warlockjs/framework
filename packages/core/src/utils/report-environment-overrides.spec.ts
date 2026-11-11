import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { reportEnvironmentOverrides } from "./report-environment-overrides";

describe("reportEnvironmentOverrides credential redaction", () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const printed = () => warn.mock.calls.map((call) => String(call[0])).join("\n");

  it("redacts a connection URL that carries credentials", () => {
    reportEnvironmentOverrides([
      {
        key: "REDIS_URL",
        effectiveValue: "redis://:s3cret@cache:6379",
        fileValue: "redis://:old@h",
      },
      {
        key: "MONGODB_URI",
        effectiveValue: "mongodb://app:pa55@db/app",
        fileValue: "mongodb://app:prev@db/app",
      },
    ]);

    const output = printed();

    expect(output).toContain("REDIS_URL");
    expect(output).toContain("MONGODB_URI");
    for (const secret of ["s3cret", "old", "pa55", "prev"]) {
      expect(output).not.toContain(secret);
    }
  });

  it("redacts *_PASS keys", () => {
    reportEnvironmentOverrides([{ key: "SMTP_PASS", effectiveValue: "hunter2", fileValue: "x1" }]);

    expect(printed()).not.toContain("hunter2");
    expect(printed()).toContain("<redacted>");
  });

  it("masks URL credentials under any key name", () => {
    reportEnvironmentOverrides([
      {
        key: "SENTRY_ENDPOINT",
        effectiveValue: "https://abc123@o1.ingest.example/2",
        fileValue: "https://def456@o1.ingest.example/2",
      },
    ]);

    const output = printed();

    expect(output).not.toContain("abc123");
    expect(output).not.toContain("def456");
    expect(output).toContain("o1.ingest.example");
  });

  it("still prints plain values", () => {
    reportEnvironmentOverrides([{ key: "HTTP_PORT", effectiveValue: "41900", fileValue: "2030" }]);

    expect(printed()).toContain("41900");
    expect(printed()).toContain("2030");
  });
});
