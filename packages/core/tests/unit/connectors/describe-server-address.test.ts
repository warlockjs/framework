import { describe, expect, it } from "vitest";
import { describeServerAddress } from "../../../src/connectors/describe-server-address";

/*
  The defect this file closes: `http-connector.ts` bound `httpConfig.port` and
  then announced `config.get("app.baseUrl")` — a different value, from a
  different environment variable, with nothing checking the two agreed. On
  2026-08-24 that produced `Server ready at http://localhost:41900` from a
  server listening on 3000. Following the line the server printed gave
  connection refused, on a server that was working perfectly.

  `v5/app/.env:10` carried the constraint as a COMMENT — "must agree with the
  port in BASE_URL above". A rule a comment enforces is not enforced.
*/

describe("describeServerAddress — the ready line names what was bound", () => {
  it("reports the bound address, not the configured base URL", () => {
    const report = describeServerAddress("http://127.0.0.1:3000", "http://localhost:41900");

    expect(report.ready).toContain("http://127.0.0.1:3000");
    expect(report.ready).not.toContain("41900");
  });

  it("says nothing extra when the base URL agrees with the bound address", () => {
    const report = describeServerAddress("http://127.0.0.1:3000", "http://localhost:3000");

    expect(report.ready).toContain("http://127.0.0.1:3000");
    expect(report.warning).toBeUndefined();
    expect(report.publicUrl).toBeUndefined();
  });

  it("treats the loopback spellings as the same host", () => {
    for (const bound of ["http://127.0.0.1:3000", "http://[::1]:3000", "http://0.0.0.0:3000"]) {
      expect(describeServerAddress(bound, "http://localhost:3000").warning).toBeUndefined();
    }
  });
});

describe("describeServerAddress — a local base URL that points at nothing", () => {
  it("warns when the base URL is loopback on a different port", () => {
    const report = describeServerAddress("http://127.0.0.1:3000", "http://localhost:41900");

    expect(report.warning).toBeDefined();
    // The warning has to carry BOTH numbers, or it cannot be acted on.
    expect(report.warning).toContain("41900");
    expect(report.warning).toContain("3000");
  });
});

describe("describeServerAddress — the reverse-proxy case is not a defect", () => {
  /*
    A deployment legitimately binds 0.0.0.0:3000 and publishes
    https://example.com. Warning there would fire on every correct production
    boot, and a warning that always fires is one nobody reads.
  */
  it("reports a non-loopback base URL as the public URL, without warning", () => {
    const report = describeServerAddress("http://0.0.0.0:3000", "https://example.com");

    expect(report.ready).toContain("http://0.0.0.0:3000");
    expect(report.publicUrl).toContain("https://example.com");
    expect(report.warning).toBeUndefined();
  });

  it("does not warn on a non-loopback host even when the port differs", () => {
    expect(describeServerAddress("http://0.0.0.0:3000", "https://example.com:8443").warning)
      .toBeUndefined();
  });
});

describe("describeServerAddress — degenerate inputs", () => {
  it("falls back to the base URL when the bound address is unavailable", () => {
    const report = describeServerAddress(undefined, "http://localhost:3000");

    expect(report.ready).toContain("http://localhost:3000");
    expect(report.warning).toBeUndefined();
  });

  it("still reports the bound address when no base URL is configured", () => {
    const report = describeServerAddress("http://127.0.0.1:3000", undefined);

    expect(report.ready).toContain("http://127.0.0.1:3000");
    expect(report.publicUrl).toBeUndefined();
    expect(report.warning).toBeUndefined();
  });

  it("does not warn on a base URL it cannot parse — it is not evidence of a mismatch", () => {
    const report = describeServerAddress("http://127.0.0.1:3000", "not a url");

    expect(report.ready).toContain("http://127.0.0.1:3000");
    expect(report.warning).toBeUndefined();
  });
});
