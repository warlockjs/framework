import { createServer } from "node:http";
import type { TraceStoreContract } from "../store/trace-store.contract";
import type { DashboardHandle, DashboardOptions } from "./dashboard.type";
import { createRequestHandler } from "./serve";

const DEFAULT_PORT = 4319;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TITLE = "Panoptic";

/**
 * Start the local Panoptic dashboard over a {@link TraceStoreContract} —
 * a zero-dependency `node:http` server that serves a read-only JSON API
 * and one self-contained HTML page polling it. The store is the live
 * object the collector fills, so each poll reflects the latest completed
 * traces with no extra wiring.
 *
 * This is a low-level building block. The documented path is
 * `ai.config({ panoptic: { dashboard } })`, which constructs (or reuses)
 * the store and calls this for you. Use it directly only when you manage
 * the store yourself.
 *
 * Binds loopback-only by default (`127.0.0.1`) so prompt content is never
 * exposed to the LAN. Pass `port: 0` for an ephemeral port — the resolved
 * port comes back on the handle. A port already in use rejects with a
 * clear, actionable `Error` rather than the raw `EADDRINUSE`.
 *
 * @example
 * const store = createInMemoryTraceStore();
 * const handle = await dashboard(store, { port: 4319, open: true });
 * console.log(handle.url); // http://127.0.0.1:4319/
 * // ...later:
 * await handle.close();
 */
export function dashboard(
  store: TraceStoreContract,
  options: DashboardOptions = {},
): Promise<DashboardHandle> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const title = options.title ?? DEFAULT_TITLE;
  const basePath = normalizeBasePath(options.basePath);

  // Secure-by-default off loopback (S4): a non-loopback bind without an
  // auth token would expose raw prompt content to the network, so refuse
  // to start rather than silently exposing it.
  if (!isLoopbackHost(host) && !options.authToken) {
    return Promise.reject(
      new Error(
        `Panoptic dashboard: binding to a non-loopback host ("${host}") requires an \`authToken\` ` +
          "(the dashboard exposes raw prompt content). Pass `authToken`, or bind to 127.0.0.1.",
      ),
    );
  }

  const allowedHosts = (options.allowedHosts ?? defaultAllowedHosts(host)).map(h =>
    h.toLowerCase(),
  );

  const handler = createRequestHandler(store, {
    basePath,
    title,
    authToken: options.authToken,
    allowedHosts,
    evaluate: options.evaluate,
  });
  const server = createServer(handler);

  return new Promise<DashboardHandle>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("error", onError);

      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `Panoptic dashboard: port ${port} in use; pass { port: 0 } for an ephemeral port`,
          ),
        );

        return;
      }

      reject(error);
    };

    server.on("error", onError);

    server.listen(port, host, () => {
      server.off("error", onError);

      const address = server.address();
      const resolvedPort = typeof address === "object" && address !== null ? address.port : port;
      const url = `http://${host}:${resolvedPort}${basePath}`;

      if (options.open) {
        openBrowser(url);
      }

      resolve({
        url,
        port: resolvedPort,
        close(): Promise<void> {
          return new Promise<void>((closeResolve, closeReject) => {
            server.close((closeError) => {
              if (closeError) {
                closeReject(closeError);

                return;
              }

              closeResolve();
            });
          });
        },
      });
    });
  });
}

/** Loopback hosts the dashboard may bind without an auth token. */
function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "[::1]" || h === "localhost";
}

/**
 * Default `Host` allowlist for a given bind host. A loopback bind accepts
 * the loopback names a browser would send; a non-loopback bind defaults to
 * just the bound host (callers can widen via `allowedHosts`).
 */
function defaultAllowedHosts(host: string): string[] {
  if (isLoopbackHost(host)) {
    return ["localhost", "127.0.0.1", "[::1]", "::1"];
  }
  return [host];
}

/**
 * Normalize a caller `basePath` to a leading-and-trailing-slash form the
 * router can prefix routes with. `undefined` / `""` → `"/"`.
 */
function normalizeBasePath(basePath?: string): string {
  if (basePath === undefined || basePath.length === 0 || basePath === "/") {
    return "/";
  }

  const withLeading = basePath.startsWith("/") ? basePath : `/${basePath}`;

  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

/**
 * Best-effort open of the default browser at `url`. Fire-and-forget and
 * fully swallowed — failing to open a browser must never reject the
 * dashboard start. Uses the platform's native opener via a lazy
 * `node:child_process` import so the dependency is paid only when
 * `open: true`.
 */
function openBrowser(url: string): void {
  void import("node:child_process")
    .then(({ spawn }) => {
      const command =
        process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.on("error", () => {
        // Swallow — opening a browser is best-effort.
      });
      child.unref();
    })
    .catch(() => {
      // Swallow — opening a browser is best-effort.
    });
}
