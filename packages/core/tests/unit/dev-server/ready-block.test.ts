import { describe, expect, it } from "vitest";
import { renderReadyBlock, type ReadyBlockFacts } from "../../../src/dev-server/ready-block";

/*
  Owner report (`warlock dev`, 5.0.2):

      ℹ info    (21:28:36.095) [http] [routes] 14 route(s) registered
      ✓ success (21:28:36.118) [http] [connection] Server ready at http://[::1]:2030

  Two defects in two lines: a URL most terminals will not linkify and which
  reads as broken on a first run, and a "ready screen" whose line order is
  whatever finished first.

  These assertions are about CONTENT, not layout. Colour codes and column widths
  are free to change; the facts on screen are not.
*/

/** Strip ANSI so assertions read the text a human reads. */
const plain = (lines: string[]) => lines.join("\n").replace(/\[[0-9;]*m/g, "");

const facts = (overrides: Partial<ReadyBlockFacts> = {}): ReadyBlockFacts => ({
  http: {
    boundAddress: "http://[::1]:2030",
    url: "http://localhost:2030",
    wildcardBind: false,
    port: 2030,
    routeCount: 14,
  },
  hasWebSurface: false,
  mode: "development",
  bootDurationMs: 660.72,
  ...overrides,
});

describe("ready block — no raw IPv6 literal reaches the screen", () => {
  it("never prints the bracketed address the server reported binding", () => {
    const output = plain(renderReadyBlock(facts()));

    expect(output).not.toContain("[::1]");
    expect(output).not.toMatch(/\[[0-9a-f:]*::[0-9a-f:]*\]/i);
    expect(output).toContain("http://localhost:2030");
  });
});

describe("ready block — one block carrying every fact", () => {
  it("states app URL, port, mode and route count together", () => {
    const output = plain(renderReadyBlock(facts()));

    expect(output).toContain("http://localhost:2030");
    expect(output).toContain("2030");
    expect(output).toContain("development");
    expect(output).toContain("14");
    expect(output).toContain("ready in");
  });

  it("shows the web surface alongside the API URL when the web connector serves", () => {
    const output = plain(renderReadyBlock(facts({ hasWebSurface: true })));

    expect(output).toMatch(/App\s+http:\/\/localhost:2030/);
    expect(output).toMatch(/Web\s+http:\/\/localhost:2030/);
  });

  it("claims no web surface for an API-only app", () => {
    expect(plain(renderReadyBlock(facts()))).not.toContain("Web");
  });

  it("renders without an app URL rather than inventing one when there is no HTTP server", () => {
    const output = plain(renderReadyBlock(facts({ http: undefined })));

    expect(output).not.toContain("http://");
    expect(output).toContain("development");
  });
});

describe("ready block — a rewritten URL must not hide a wider bind", () => {
  /*
    `localhost` is a truthful, reachable spelling of a `0.0.0.0` bind, but it is
    a NARROWER one. Saying only "localhost" for a server reachable from the LAN
    would make the display transform quietly misreport the bind, which is the
    one thing this change was forbidden from doing.
  */
  it("marks a wildcard bind as all interfaces", () => {
    const output = plain(
      renderReadyBlock(
        facts({
          http: {
            boundAddress: "http://0.0.0.0:2030",
            url: "http://localhost:2030",
            wildcardBind: true,
            port: 2030,
            routeCount: 14,
          },
        }),
      ),
    );

    expect(output).toContain("http://localhost:2030");
    expect(output).toContain("all interfaces");
  });

  it("says nothing extra for a loopback bind", () => {
    expect(plain(renderReadyBlock(facts()))).not.toContain("all interfaces");
  });
});

describe("ready block — warnings are structurally unable to enter it", () => {
  /*
    Not a style rule. A warning folded into a status summary is a warning nobody
    reads, so the block cannot receive one: `ReadyBlockFacts` has no field for
    it, and the http connector logs its base-URL warning unconditionally, at the
    moment it is found — which places it ABOVE this block.
  */
  it("has no field through which a warning could be passed", () => {
    const keys = Object.keys(facts());

    expect(keys).not.toContain("warning");
    expect(keys).not.toContain("warnings");
  });
});
