import { describe, expect, it } from "vitest";
import {
  describeServerAddress,
  isWildcardBind,
  toDisplayUrl,
} from "../../../src/connectors/describe-server-address";

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

    expect(report.boundAddress).toBe("http://127.0.0.1:3000");
    expect(report.ready).toContain("http://localhost:3000");
    expect(report.ready).not.toContain("41900");
  });

  it("says nothing extra when the base URL agrees with the bound address", () => {
    const report = describeServerAddress("http://127.0.0.1:3000", "http://localhost:3000");

    expect(report.boundAddress).toBe("http://127.0.0.1:3000");
    expect(report.ready).toContain("http://localhost:3000");
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

    expect(report.boundAddress).toBe("http://0.0.0.0:3000");
    expect(report.ready).toContain("http://localhost:3000");
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

    expect(report.boundAddress).toBe("http://127.0.0.1:3000");
    expect(report.ready).toContain("http://localhost:3000");
    expect(report.publicUrl).toBeUndefined();
    expect(report.warning).toBeUndefined();
  });

  it("does not warn on a base URL it cannot parse — it is not evidence of a mismatch", () => {
    const report = describeServerAddress("http://127.0.0.1:3000", "not a url");

    expect(report.boundAddress).toBe("http://127.0.0.1:3000");
    expect(report.ready).toContain("http://localhost:3000");
    expect(report.warning).toBeUndefined();
  });
});

/*
  ── DISPLAY vs BIND ──────────────────────────────────────────────────────────

  Owner report: `warlock dev` printed `Server ready at http://[::1]:2030`. That
  is exactly what `listen()` returned — `host: "localhost"` on a dual-stack
  machine binds `::1` — and it is exactly what most terminals refuse to linkify.

  `toDisplayUrl` is the ONLY thing that changed. `http-connector.ts` still calls
  `listen({ port, host: httpConfig.host || "localhost" })` with the same host it
  always did, so which interfaces the server accepts on is untouched. These
  tests pin that boundary: the presentation moves, the bind does not, and
  `boundAddress` keeps the untransformed fact available to anyone who needs it.
*/
describe("toDisplayUrl — a reachable spelling, never a different server", () => {
  it("rewrites the loopback literals to localhost", () => {
    expect(toDisplayUrl("http://[::1]:2030")).toBe("http://localhost:2030");
    expect(toDisplayUrl("http://127.0.0.1:2030")).toBe("http://localhost:2030");
  });

  it("rewrites the wildcard binds too — localhost reaches them", () => {
    expect(toDisplayUrl("http://0.0.0.0:2030")).toBe("http://localhost:2030");
    expect(toDisplayUrl("http://[::]:2030")).toBe("http://localhost:2030");
  });

  it("leaves a routable IPv6 address alone — there is no synonym to offer", () => {
    // Printing `localhost` here would be the same class of lie as printing
    // `app.baseUrl` was: a URL that does not reach the server being described.
    expect(toDisplayUrl("http://[2001:db8::1]:2030")).toBe("http://[2001:db8::1]:2030");
  });

  it("leaves a hostname bind alone", () => {
    expect(toDisplayUrl("http://api.internal:2030")).toBe("http://api.internal:2030");
  });

  it("returns unparseable input untouched rather than guessing", () => {
    expect(toDisplayUrl("not a url")).toBe("not a url");
    expect(toDisplayUrl(undefined)).toBe("");
  });

  it("preserves the scheme and does not append a trailing slash", () => {
    expect(toDisplayUrl("https://127.0.0.1:8443")).toBe("https://localhost:8443");
  });
});

describe("isWildcardBind — the rewrite must not hide a wider bind", () => {
  it("is true only for the wildcards", () => {
    expect(isWildcardBind("http://0.0.0.0:2030")).toBe(true);
    expect(isWildcardBind("http://[::]:2030")).toBe(true);
    expect(isWildcardBind("http://[::1]:2030")).toBe(false);
    expect(isWildcardBind("http://127.0.0.1:2030")).toBe(false);
    expect(isWildcardBind(undefined)).toBe(false);
  });
});

describe("describeServerAddress — the report carries the bind, not only its display", () => {
  it("keeps the literal listen() returned next to the URL it shows", () => {
    const report = describeServerAddress("http://[::1]:2030", "http://localhost:2030");

    expect(report.boundAddress).toBe("http://[::1]:2030");
    expect(report.url).toBe("http://localhost:2030");
    expect(report.ready).not.toContain("[::1]");
    expect(report.wildcardBind).toBe(false);
  });

  it("flags a wildcard bind on the report", () => {
    expect(describeServerAddress("http://0.0.0.0:2030", undefined).wildcardBind).toBe(true);
  });
});
