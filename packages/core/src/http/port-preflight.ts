import { createServer } from "node:net";

/**
 * Host used when the caller has no configured bind host.
 */
const DEFAULT_PROBE_HOST = "localhost";

/**
 * Raised when a port the framework is about to bind is already taken.
 *
 * Carries the port and host so a caller can report them without parsing the
 * message, and its message is the developer-facing instruction — the whole
 * point of preflighting is that nobody has to decode a raw `EADDRINUSE`.
 *
 * The message leads with `EADDRINUSE` on purpose: it is the string a
 * developer greps their terminal for, and the one every other Node tool
 * already trained them to recognize as "something else is on this port".
 * `code` mirrors it as a property so a caller can branch on it without
 * parsing text, the same way `NodeJS.ErrnoException.code` works.
 */
export class PortInUseError extends Error {
  /** Mirrors Node's own `ErrnoException.code` for this failure. */
  public readonly code = "EADDRINUSE";

  public constructor(
    public readonly port: number,
    public readonly host: string,
  ) {
    super(
      `EADDRINUSE: Port ${port} is already in use on ${host}. Stop the dev server (or whatever else is listening on port ${port}) and run again, or start on a free port — e.g. startHttpTestServer({ port: ${port + 1} }).`,
    );

    this.name = "PortInUseError";
  }
}

/**
 * Probe a TCP port by attempting a bind and immediately releasing it.
 *
 * @returns `true` when the port is free, `false` when it is taken or the
 * process is not allowed to bind it. Any other bind failure is re-thrown —
 * an unreadable network error must not be reported as "port in use".
 */
export function isPortAvailable(
  port: number,
  host: string = DEFAULT_PROBE_HOST,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.unref();

    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);

        return;
      }

      reject(error);
    });

    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });

    // `exclusive` refuses a shared bind, which is what makes the probe honest:
    // with load balancing enabled a second bind on a served port can succeed.
    probe.listen({ port, host, exclusive: true });
  });
}

/**
 * Assert a port is free before something binds it.
 *
 * Run this ahead of the actual `listen()` so a collision surfaces as an
 * instruction the developer can act on, instead of a raw `EADDRINUSE` thrown
 * from deep inside the HTTP stack.
 *
 * @throws {PortInUseError} when the port is taken.
 */
export async function assertPortIsAvailable(
  port: number,
  host: string = DEFAULT_PROBE_HOST,
): Promise<void> {
  const available = await isPortAvailable(port, host);

  if (!available) {
    throw new PortInUseError(port, host);
  }
}
