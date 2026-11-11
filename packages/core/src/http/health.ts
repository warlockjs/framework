import config from "@mongez/config";
import { Application } from "../application";

/** Default for `http.health.checkTimeout`: a check slower than this fails. */
const DEFAULT_HEALTH_CHECK_TIMEOUT = 2000;

/** Default for `http.health.cacheTtl`: how long one readiness result is reused. */
const DEFAULT_HEALTH_CACHE_TTL = 1000;

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * A readiness probe registered via `health.addCheck(...)`. Returns whether its
 * dependency is currently usable; throwing is treated as a failed check.
 */
export type HealthCheck = () => boolean | Promise<boolean>;

/**
 * Result of a liveness/readiness probe. `checks` is present on readiness only,
 * mapping each registered check name to its pass/fail.
 */
export type HealthStatus = {
  status: "ok" | "error";
  checks?: Record<string, boolean>;
};

/**
 * Registry behind the built-in `/health` (liveness) and `/ready` (readiness)
 * endpoints. Liveness answers "is the process up?"; readiness answers "should
 * traffic be routed here?" — booted, not shutting down, and every registered
 * dependency check passing. Connectors and app code register checks; the HTTP
 * connector exposes the endpoints.
 */
class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  /** Bumped whenever the set of checks changes, so a cached result is dropped. */
  private checksVersion = 0;

  /** The run every concurrent readiness call shares. */
  private inFlight?: Promise<HealthStatus>;

  /** The last finished run, reused for `http.health.cacheTtl` ms. */
  private cached?: { at: number; version: number; result: HealthStatus };

  /**
   * Register (or replace) a readiness check by name — e.g. a database ping.
   */
  public addCheck(name: string, check: HealthCheck): void {
    this.checks.set(name, check);
    this.checksVersion++;
  }

  /**
   * Remove a previously-registered readiness check.
   */
  public removeCheck(name: string): void {
    this.checks.delete(name);
    this.checksVersion++;
  }

  /**
   * Liveness — the process is up and not tearing down. Orchestrators use it to
   * decide whether to RESTART the instance, so it ignores dependency checks.
   */
  public liveness(): HealthStatus {
    return { status: Application.isShuttingDown ? "error" : "ok" };
  }

  /**
   * Readiness — should this instance receive traffic? Requires a finished boot,
   * no in-progress shutdown, and every registered check passing. Load balancers
   * use it to decide whether to ROUTE to the instance.
   *
   * Probes are cheap and bounded: concurrent calls share one run of the
   * checks, a finished result is reused for `http.health.cacheTtl` ms
   * (default 1000, `0` turns reuse off), and a check that takes longer than
   * `http.health.checkTimeout` ms (default 2000) counts as failed.
   */
  public async readiness(): Promise<HealthStatus> {
    if (!Application.isBooted || Application.isShuttingDown) {
      return { status: "error" };
    }

    const ttl = nonNegativeInteger(config.get("http.health.cacheTtl"), DEFAULT_HEALTH_CACHE_TTL);
    const cached = this.cached;

    if (
      cached &&
      ttl > 0 &&
      cached.version === this.checksVersion &&
      Date.now() - cached.at < ttl
    ) {
      return copyStatus(cached.result);
    }

    if (!this.inFlight) {
      const version = this.checksVersion;

      this.inFlight = this.runChecks()
        .then((result) => {
          if (version === this.checksVersion) {
            this.cached = { at: Date.now(), version, result };
          }

          return result;
        })
        .finally(() => {
          this.inFlight = undefined;
        });
    }

    return copyStatus(await this.inFlight);
  }

  /**
   * Run every registered check once, in registration order.
   */
  private async runChecks(): Promise<HealthStatus> {
    const timeout = nonNegativeInteger(
      config.get("http.health.checkTimeout"),
      DEFAULT_HEALTH_CHECK_TIMEOUT,
    );
    const checks: Record<string, boolean> = {};
    let allPassed = true;

    for (const [name, check] of this.checks) {
      const passed = await this.runCheck(check, timeout);
      checks[name] = passed;

      if (!passed) {
        allPassed = false;
      }
    }

    return { status: allPassed ? "ok" : "error", checks };
  }

  /**
   * Register a readiness check asserting the app has at least one route
   * registered. A booted HTTP app that ends up with zero routes almost always
   * means a route module failed to register silently, so the instance should
   * report not-ready (503) rather than 404 every request.
   *
   * The route count is passed in as a getter so this registry stays decoupled
   * from the router (no import cycle). The HTTP connector wires this in after
   * scanning routes; apps with no HTTP surface simply never register it.
   *
   * @param getRouteCount Returns the number of currently-registered routes.
   * @param name Override the check name (defaults to `"routes"`).
   */
  public addRoutesRegisteredCheck(getRouteCount: () => number, name = "routes"): void {
    this.addCheck(name, () => getRouteCount() > 0);
  }

  /**
   * Run one check. A thrown error, or no answer within `timeoutMs` (`0`
   * waits forever), counts as a failed check rather than crashing
   * the probe. The failure is surfaced in the readiness `checks` map and the
   * 503 status — not logged, since probes poll frequently and a failed check is
   * a normal signal, not an error event.
   */
  private async runCheck(check: HealthCheck, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const run = Promise.resolve().then(check);

      if (timeoutMs === 0) return await run;

      // a check that never settles must not hold the probe
      const timedOut = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      });

      return await Promise.race([run, timedOut]);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** A copy, so a caller changing the result never changes the cached one. */
function copyStatus(result: HealthStatus): HealthStatus {
  return result.checks ? { status: result.status, checks: { ...result.checks } } : { ...result };
}

/**
 * The application's health registry singleton.
 */
export const health = new HealthRegistry();
