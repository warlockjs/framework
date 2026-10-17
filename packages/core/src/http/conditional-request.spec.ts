import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";
import {
  evaluateConditionalRequest,
  matchesIfMatch,
  matchesIfNoneMatch,
  parseEntityTagList,
} from "./conditional-request";

describe("entity-tag comparison", () => {
  it("parses lists without splitting on a comma inside a quoted tag", () => {
    expect(parseEntityTagList('"a,b", W/"c" , "d"')).toEqual([
      { weak: false, opaque: '"a,b"' },
      { weak: true, opaque: '"c"' },
      { weak: false, opaque: '"d"' },
    ]);
    expect(parseEntityTagList(" * ")).toBe("*");
    expect(parseEntityTagList("")).toBeUndefined();
    expect(parseEntityTagList(null)).toBeUndefined();
  });

  it("uses weak comparison for If-None-Match", () => {
    expect(matchesIfNoneMatch('W/"v1"', '"v1"')).toBe(true);
    expect(matchesIfNoneMatch('"v1"', 'W/"v1"')).toBe(true);
    expect(matchesIfNoneMatch('W/"v1"', 'W/"v1"')).toBe(true);
    expect(matchesIfNoneMatch('"other", "v1"', '"v1"')).toBe(true);
    expect(matchesIfNoneMatch("*", '"v1"')).toBe(true);
    expect(matchesIfNoneMatch('"v2"', '"v1"')).toBe(false);
    // The weakness indicator is case-sensitive (RFC 9110 §8.8.3).
    expect(matchesIfNoneMatch('w/"v1"', '"v1"')).toBe(false);
  });

  it("uses strong comparison for If-Match", () => {
    expect(matchesIfMatch('"v1"', '"v1"')).toBe(true);
    expect(matchesIfMatch('"other", "v1"', '"v1"')).toBe(true);
    expect(matchesIfMatch('W/"v1"', '"v1"')).toBe(false);
    expect(matchesIfMatch('"v1"', 'W/"v1"')).toBe(false);
    expect(matchesIfMatch('W/"v1"', 'W/"v1"')).toBe(false);
    expect(matchesIfMatch("*", '"v1"')).toBe(true);
    expect(matchesIfMatch("*", undefined)).toBe(false);
    expect(matchesIfMatch(null, '"v1"')).toBe(true);
  });
});

describe("evaluateConditionalRequest", () => {
  const lastModified = new Date("2026-10-01T10:00:00.900Z");

  it("answers 304 for a weakly matching If-None-Match on GET and HEAD only", () => {
    for (const method of ["GET", "HEAD"]) {
      expect(evaluateConditionalRequest({ method, etag: '"v1"', ifNoneMatch: 'W/"v1"' })).toBe(
        "not-modified",
      );
    }

    expect(evaluateConditionalRequest({ method: "PUT", etag: '"v1"', ifNoneMatch: '"v1"' })).toBe(
      "precondition-failed",
    );
  });

  it("answers 412 when If-Match fails, before If-None-Match is read", () => {
    expect(
      evaluateConditionalRequest({
        method: "GET",
        etag: '"v1"',
        ifMatch: 'W/"v1"',
        ifNoneMatch: '"v1"',
      }),
    ).toBe("precondition-failed");
    expect(evaluateConditionalRequest({ method: "GET", etag: '"v1"', ifMatch: '"v1"' })).toBe(
      "proceed",
    );
  });

  it("reads If-Unmodified-Since only without If-Match", () => {
    const before = "Wed, 30 Sep 2026 10:00:00 GMT";

    expect(
      evaluateConditionalRequest({ method: "GET", lastModified, ifUnmodifiedSince: before }),
    ).toBe("precondition-failed");
    expect(
      evaluateConditionalRequest({
        method: "GET",
        etag: '"v1"',
        lastModified,
        ifMatch: '"v1"',
        ifUnmodifiedSince: before,
      }),
    ).toBe("proceed");
  });

  it("ignores If-Modified-Since when If-None-Match is present, and on unsafe methods", () => {
    const after = "Thu, 01 Oct 2026 12:00:00 GMT";

    expect(
      evaluateConditionalRequest({ method: "GET", lastModified, ifModifiedSince: after }),
    ).toBe("not-modified");
    expect(
      evaluateConditionalRequest({
        method: "GET",
        etag: '"v1"',
        lastModified,
        ifNoneMatch: '"v2"',
        ifModifiedSince: after,
      }),
    ).toBe("proceed");
    expect(
      evaluateConditionalRequest({ method: "POST", lastModified, ifModifiedSince: after }),
    ).toBe("proceed");
    expect(
      evaluateConditionalRequest({ method: "GET", lastModified, ifModifiedSince: "not a date" }),
    ).toBe("proceed");
  });
});

describe("response.sendFile conditional requests", () => {
  let harness: HttpHarness | undefined;
  let root: string | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  async function serveFile() {
    root = mkdtempSync(path.join(tmpdir(), "warlock-conditional-"));
    const file = path.join(root, "report.txt");
    writeFileSync(file, "report");
    const stats = statSync(file);
    const etag = `"${stats.size}-${stats.mtime.getTime()}"`;

    harness = await bootHarness((router) => {
      router.get("/report.txt", ({ response }) => {
        response.sendFile(file);
      });
    });

    const get = (headers: Record<string, string>) =>
      (harness as HttpHarness).inject({ method: "GET", url: "/report.txt", headers });

    return { etag, get };
  }

  it("answers 304 to a weak If-None-Match and 200 to a different tag", async () => {
    const { etag, get } = await serveFile();

    expect((await get({ "if-none-match": `W/${etag}` })).statusCode).toBe(304);
    expect((await get({ "if-none-match": '"stale"' })).body).toBe("report");
  });

  it("answers 412 to an If-Match naming the weak form of the current tag", async () => {
    const { etag, get } = await serveFile();

    const weak = await get({ "if-match": `W/${etag}` });
    const strong = await get({ "if-match": etag });

    expect(weak.statusCode).toBe(412);
    expect(weak.body).toBe("");
    expect(strong.statusCode).toBe(200);
    expect(strong.body).toBe("report");
  });
});
