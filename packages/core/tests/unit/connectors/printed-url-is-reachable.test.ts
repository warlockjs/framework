import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { describeServerAddress } from "../../../src/connectors/describe-server-address";

/**
 * Acceptance criterion 2 of the `warlock dev` ready-output card: *the printed
 * URL, pasted into a browser, loads the app.*
 *
 * `describe-server-address.test.ts` already pins the string transformation —
 * that `[::1]` and the wildcards are displayed as `localhost`. What it cannot
 * show is that the rewritten spelling still REACHES the server, and that is the
 * whole point of the rewrite: swapping the host in a URL for display is only
 * safe if the substitute resolves back to the same listener.
 *
 * So these boot a real Fastify, take the address `listen()` actually returned,
 * put it through `describeServerAddress()` exactly as the connector does, and
 * then fetch the URL that would have been PRINTED. A regression that made the
 * displayed host a lie — a wrong port, a rewrite applied to a non-loopback
 * bind, an IPv6 host mangled rather than replaced — fails here rather than in
 * front of a developer on their first run.
 *
 * Port 0 asks the OS for a free port, so these never collide with a running
 * dev server or with each other.
 */
const servers: Array<{ close: () => Promise<unknown> }> = [];

async function bootAndDescribe(host: string) {
  const server = Fastify();
  servers.push(server);

  server.get("/__probe", async () => ({ reached: true }));

  const boundAddress = await server.listen({ port: 0, host });

  // Third argument mirrors the connector: `listen()` resolves a `0.0.0.0` bind
  // back to `http://127.0.0.1:<port>`, so the wildcard survives only in what we
  // asked for.
  return { boundAddress, report: describeServerAddress(boundAddress, undefined, host) };
}

describe("the URL the dev ready output prints is actually reachable", () => {
  afterEach(async () => {
    while (servers.length) {
      await servers.pop()?.close();
    }
  });

  it("loads over the printed URL when listen() resolved localhost to a raw IPv6 literal", async () => {
    const { boundAddress, report } = await bootAndDescribe("localhost");

    // On a dual-stack machine this is `http://[::1]:<port>` — the literal the
    // card exists to stop us printing. On a v4-only machine it is 127.0.0.1.
    // Either way the DISPLAYED url must be the localhost spelling...
    expect(report.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(report.url).not.toContain("::");
    // ...and it must not have quietly changed the port while changing the host.
    expect(new URL(report.url).port).toBe(new URL(boundAddress).port);

    // The claim that matters: it loads.
    const response = await fetch(`${report.url}/__probe`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reached: true });
  });

  it("loads over the printed URL under a wildcard bind, and still reports the bind as wide", async () => {
    const { report } = await bootAndDescribe("0.0.0.0");

    expect(report.url).toMatch(/^http:\/\/localhost:\d+$/);
    // A wildcard bind is wider than what is printed. Displaying `localhost` is
    // truthful (the wildcard includes loopback) but the caller must still be
    // able to tell the difference, or a status block cannot warn about it.
    expect(report.wildcardBind).toBe(true);

    const response = await fetch(`${report.url}/__probe`);

    expect(response.status).toBe(200);
  });

  it("keeps the untransformed bind address alongside the display URL", async () => {
    const { boundAddress, report } = await bootAndDescribe("127.0.0.1");

    // Presentation must never overwrite the fact. A caller reasoning about
    // which interfaces were bound reads `boundAddress`, not `url`.
    expect(report.boundAddress).toBe(boundAddress);
    expect(report.wildcardBind).toBe(false);

    const response = await fetch(`${report.url}/__probe`);

    expect(response.status).toBe(200);
  });
});
