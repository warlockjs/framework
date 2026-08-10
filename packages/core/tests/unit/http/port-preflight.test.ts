import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPortIsAvailable,
  isPortAvailable,
  PortInUseError,
} from "../../../src/http/port-preflight";

const host = "127.0.0.1";

/**
 * Bind a real socket and hand back the port it took, so the preflight is
 * tested against an actually occupied port rather than a stub.
 */
function holdPort(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen({ port: 0, host }, () => {
      const address = server.address();

      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

function releasePort(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe("port preflight", () => {
  let holder: Server | undefined;

  afterEach(async () => {
    if (holder) {
      await releasePort(holder);
      holder = undefined;
    }
  });

  it("reports a free port as available", async () => {
    holder = createServer();

    const port = await holdPort(holder);

    await releasePort(holder);
    holder = undefined;

    expect(await isPortAvailable(port, host)).toBe(true);
  });

  it("reports a held port as unavailable", async () => {
    holder = createServer();

    const port = await holdPort(holder);

    expect(await isPortAvailable(port, host)).toBe(false);
  });

  it("passes silently when the port is free", async () => {
    holder = createServer();

    const port = await holdPort(holder);

    await releasePort(holder);
    holder = undefined;

    await expect(assertPortIsAvailable(port, host)).resolves.toBeUndefined();
  });

  it("throws an actionable message naming the port instead of EADDRINUSE", async () => {
    holder = createServer();

    const port = await holdPort(holder);

    const error = await assertPortIsAvailable(port, host).catch(
      (thrown: unknown) => thrown as PortInUseError,
    );

    expect(error).toBeInstanceOf(PortInUseError);
    expect(error.port).toBe(port);
    expect(error.host).toBe(host);
    expect(error.message).toContain(`Port ${port} is already in use`);
    expect(error.message).toContain("Stop the dev server");
    expect(error.message).not.toContain("EADDRINUSE");
  });
});
