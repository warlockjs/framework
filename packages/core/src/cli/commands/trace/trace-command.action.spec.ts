import path from "node:path";
import { describe, expect, it } from "vitest";
import { WarlockError } from "../../../errors/warlock-error";
import {
  collectHeaderValues,
  formatTraceSummary,
  parseHeaderValues,
  parseTraceBody,
  traceFailureExitCode,
} from "./trace-command.action";
import { buildTraceReport } from "../../../tooling/trace/trace-request";

describe("warlock trace argument helpers", () => {
  it("collects every --header / -H value in order", () => {
    expect(
      collectHeaderValues([
        "node",
        "warlock",
        "trace",
        "GET",
        "/posts",
        "--header",
        "Accept: application/json",
        "-H",
        "x-tenant:acme",
        "--header=authorization: Bearer t",
        "-H=x-a:1",
        "--json",
      ]),
    ).toEqual(["Accept: application/json", "x-tenant:acme", "authorization: Bearer t", "x-a:1"]);
  });

  it("parses name:value headers and refuses a value without a name", () => {
    expect(parseHeaderValues(["Accept: application/json", "x-url: http://a:1"])).toEqual({
      Accept: "application/json",
      "x-url": "http://a:1",
    });
    expect(() => parseHeaderValues(["no-colon"])).toThrow(/name:value/);
  });

  it("reads --body as JSON, text or @file", () => {
    expect(parseTraceBody(undefined)).toBeUndefined();
    expect(parseTraceBody('{"title":"Hi"}')).toEqual({ title: "Hi" });
    expect(parseTraceBody("plain text")).toBe("plain text");

    const read: string[] = [];
    const body = parseTraceBody("@payload.json", "/project", (file) => {
      read.push(file);
      return '{"from":"file"}';
    });

    expect(read).toEqual([path.resolve("/project", "payload.json")]);
    expect(body).toEqual({ from: "file" });
  });

  it("exits 2 for this machine and 1 otherwise", () => {
    expect(traceFailureExitCode(new WarlockError("WL8008", "down"))).toBe(2);
    expect(traceFailureExitCode(new WarlockError("WL8009", "no devtools"))).toBe(2);
    expect(traceFailureExitCode(new WarlockError("WL5004", "no record"))).toBe(1);
    expect(traceFailureExitCode(new Error("usage"))).toBe(1);
  });

  it("summarises the timeline for humans", () => {
    const report = buildTraceReport({
      requestId: "r1",
      server: "http://localhost:1",
      request: { method: "POST", url: "http://localhost:1/posts", headers: {}, body: null },
      response: {
        status: 422,
        headers: { "content-type": "application/json" },
        text: '{"errors":[]}',
      },
      record: {
        id: "r1",
        method: "POST",
        path: "/posts",
        route: "/posts",
        startedAt: 0,
        durationMs: 3,
        phases: [
          { name: "middleware", startedAt: 0, durationMs: 1, attrs: { name: "auth", index: 0 } },
          { name: "validation", startedAt: 1, durationMs: 1 },
        ],
        queries: [],
        cache: [],
        logs: [],
        mails: [],
        warnings: [],
      },
      clientMs: 4,
    });

    const lines = formatTraceSummary(report);

    expect(lines[0]).toBe("POST http://localhost:1/posts → 422  (/posts, id r1)");
    expect(lines).toContain("  middleware   auth  1.0ms");
    expect(lines).toContain("  validation   failed  1.0ms");
  });
});
