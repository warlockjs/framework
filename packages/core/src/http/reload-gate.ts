import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyInstance } from "./server";

/** How long a request that arrives mid-reload waits for the new generation. */
const DEFAULT_MAX_WAIT_MS = 15_000;

/** How long a reload waits for requests already running to finish. */
const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

/** Seconds a client is told to wait before retrying a refused request. */
export const RELOAD_RETRY_AFTER_SECONDS = 2;

type Waiter = () => void;

/**
 * Orders a dev-server hot reload around the requests being served.
 *
 * A reload used to tear routes and connectors down while requests were running
 * on them, so the in-flight work saw closed connections and half-registered
 * routes, and requests arriving in that window saw a 404. The reload now runs in
 * a fixed order:
 *
 * 1. {@link ReloadGate.begin} closes the gate: new requests wait.
 * 2. {@link ReloadGate.drain} lets the requests already running finish on the
 *    old generation (bounded; a stuck request does not block the reload).
 * 3. The old generation is disposed and the new one imported.
 * 4. {@link ReloadGate.end} opens the gate; waiting requests continue on the
 *    new generation.
 *
 * A request that waits longer than the cap is refused with `503` and a
 * `Retry-After` header, so the client retries instead of failing midway.
 *
 * The gate is always open in production: nothing calls `begin()` there, so the
 * hook is a counter increment and a boolean check.
 */
export class ReloadGate {
  private depth = 0;
  private inFlight = 0;
  private openWaiters = new Set<Waiter>();
  private idleWaiters = new Set<Waiter>();

  /** True while a reload (or another holder) keeps the gate closed. */
  public get closed(): boolean {
    return this.depth > 0;
  }

  /** Number of requests currently running past the gate. */
  public get activeRequests(): number {
    return this.inFlight;
  }

  /** Close the gate. Calls nest: it opens when every `begin()` has an `end()`. */
  public begin(): void {
    this.depth++;
  }

  /** Release one `begin()`; waiting requests continue once the last is released. */
  public end(): void {
    if (this.depth === 0) return;

    this.depth--;

    if (this.depth > 0) return;

    for (const resume of [...this.openWaiters]) resume();
  }

  /**
   * Wait for requests already running to finish.
   *
   * @returns `true` when they all finished, `false` when the timeout hit first.
   */
  public async drain(timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS): Promise<boolean> {
    if (this.inFlight === 0) return true;

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.idleWaiters.delete(onIdle);
        resolve(false);
      }, timeoutMs);

      timer.unref?.();

      const onIdle = () => {
        clearTimeout(timer);
        this.idleWaiters.delete(onIdle);
        resolve(true);
      };

      this.idleWaiters.add(onIdle);
    });
  }

  /**
   * Wait until the gate is open.
   *
   * @returns `true` when open, `false` when `maxWaitMs` passed first.
   */
  public async waitUntilOpen(maxWaitMs = DEFAULT_MAX_WAIT_MS): Promise<boolean> {
    if (!this.closed) return true;

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.openWaiters.delete(onOpen);
        resolve(false);
      }, maxWaitMs);

      timer.unref?.();

      const onOpen = () => {
        clearTimeout(timer);
        this.openWaiters.delete(onOpen);
        resolve(true);
      };

      this.openWaiters.add(onOpen);
    });
  }

  /** Count a request in. Returns the function that counts it out (idempotent). */
  public enter(): () => void {
    this.inFlight++;

    let left = false;

    return () => {
      if (left) return;

      left = true;
      this.inFlight--;

      if (this.inFlight === 0) {
        for (const resume of [...this.idleWaiters]) resume();
      }
    };
  }
}

/** The dev server's single reload gate. */
export const reloadGate = new ReloadGate();

/**
 * Resolve once no reload is in progress. For work that must not count a
 * reload's duration against its own timeout (the page loader timeout).
 */
export async function whenReloadSettled(maxWaitMs?: number): Promise<void> {
  await reloadGate.waitUntilOpen(maxWaitMs);
}

/** Hold new requests while a reload runs; refuse them with 503 past the cap. */
export function registerReloadGate(server: FastifyInstance, maxWaitMs = DEFAULT_MAX_WAIT_MS): void {
  server.addHook("onRequest", async (_request: FastifyRequest, reply: FastifyReply) => {
    if (reloadGate.closed && !(await reloadGate.waitUntilOpen(maxWaitMs))) {
      return reply.code(503).header("Retry-After", String(RELOAD_RETRY_AFTER_SECONDS)).send({
        error: "The development server is reloading. Retry in a moment.",
        code: "DEV_SERVER_RELOADING",
      });
    }

    const leave = reloadGate.enter();

    reply.raw.once("close", leave);
  });
}
