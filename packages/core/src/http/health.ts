import { Application } from "../application";

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

  /**
   * Register (or replace) a readiness check by name — e.g. a database ping.
   */
  public addCheck(name: string, check: HealthCheck): void {
    this.checks.set(name, check);
  }

  /**
   * Remove a previously-registered readiness check.
   */
  public removeCheck(name: string): void {
    this.checks.delete(name);
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
   */
  public async readiness(): Promise<HealthStatus> {
    if (!Application.isBooted || Application.isShuttingDown) {
      return { status: "error" };
    }

    const checks: Record<string, boolean> = {};
    let allPassed = true;

    for (const [name, check] of this.checks) {
      const passed = await this.runCheck(check);
      checks[name] = passed;

      if (!passed) {
        allPassed = false;
      }
    }

    return { status: allPassed ? "ok" : "error", checks };
  }

  /**
   * Run one check. A thrown error counts as a failed check rather than crashing
   * the probe. The failure is surfaced in the readiness `checks` map and the
   * 503 status — not logged, since probes poll frequently and a failed check is
   * a normal signal, not an error event.
   */
  private async runCheck(check: HealthCheck): Promise<boolean> {
    try {
      return await check();
    } catch {
      return false;
    }
  }
}

/**
 * The application's health registry singleton.
 */
export const health = new HealthRegistry();
