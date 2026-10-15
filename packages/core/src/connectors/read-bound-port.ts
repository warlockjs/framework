/**
 * The port actually bound, read back from the address `listen()` resolved
 * with — never the port that was asked for.
 *
 * `http.port: 0` is the case that makes the distinction load-bearing: it asks
 * the OS for any free port, so the CONFIGURED value stays `0` forever.
 * Publishing that produces the "Server ready at a URL that gives connection
 * refused" defect, and downstream `http://host:0`.
 *
 * `fallback` only fires if `boundAddress` turns out unparseable as a URL,
 * which does not happen in practice — Fastify's resolved address is always a
 * well-formed `http://host:port` (or `https://`) string with an explicit
 * port — but a best-effort read of a socket address must never throw.
 *
 * Lives in its own file so it can be exercised directly. It used to be a
 * module-private function inside `http-connector.ts`, where reaching it from a
 * test meant importing the whole connector graph, and the central claim of the
 * `port: 0` fix consequently had no test at all.
 */
export function readBoundPort(boundAddress: string, fallback: number): number {
  try {
    const port = new URL(boundAddress).port;

    return port ? Number(port) : fallback;
  } catch {
    return fallback;
  }
}
