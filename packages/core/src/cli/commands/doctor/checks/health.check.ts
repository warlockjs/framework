import { config } from "../../../../config/config-getter";
import { container } from "../../../../container";
import { router } from "../../../../router/router";
import type { DoctorCheck } from "../check.types";

/**
 * Ask the booted Fastify instance whether a GET route exists at this path.
 *
 * `hasRoute` is the instance's own answer, not a re-derivation of the config
 * that was supposed to produce it — which is the entire point of asking it.
 * Guarded because it is the one part of this check that depends on a Fastify
 * API: if the instance cannot answer, the check says so instead of inventing a
 * verdict from the config flag it is meant to be verifying.
 */
function fastifyHasGet(path: string): boolean | undefined {
  const http = container.has("http.server") ? container.get<any>("http.server") : undefined;

  if (!http || typeof http.hasRoute !== "function") return undefined;

  try {
    return Boolean(http.hasRoute({ method: "GET", url: path }));
  } catch {
    return undefined;
  }
}

/**
 * Whether an app route already claims this path. The HTTP connector puts the
 * probes on the Fastify instance directly and the router scans app routes onto
 * the same instance at `start()`, so a collision is a duplicate registration:
 * Fastify refuses it and the server does not start.
 */
function appRouteClaims(path: string): boolean {
  return router.list().some((route) => {
    const method = String(route.method).toUpperCase();

    return route.path === path && (method === "GET" || method === "ALL");
  });
}

/**
 * Confirms the liveness (`/health`) and readiness (`/ready`) endpoints are
 * really there.
 *
 * NEEDS A BOOTED APP: the HTTP connector registers the probes during `boot()`,
 * which the boot pass runs. Previously this check read `http.health.enabled`
 * and reported the endpoints as "registered" on that basis alone — in the same
 * report where `routes` said zero, because nothing had been booted at all. It
 * was reporting an intention as a fact, and the two lines contradicted each
 * other in the owner's own run.
 *
 * Verdicts:
 * - no `http` config → not applicable, no line;
 * - `http.health.enabled = false` → `ok`. Turning the probes off is a supported
 *   choice, and a warning that fires on a deliberate setting every single run
 *   is not read by the time it matters;
 * - an app route already claims a probe's path → `fail`: Fastify will refuse
 *   the duplicate and the server will not start;
 * - the instance says the route is absent → `fail`;
 * - otherwise → `ok`, with the paths that are actually registered.
 */
export const healthCheck: DoctorCheck = {
  name: "health",
  run: (context) => {
    if (!config.get("http")) {
      return undefined;
    }

    const healthConfig = config.get("http.health");

    if (healthConfig?.enabled === false) {
      return {
        name: "health",
        status: "ok",
        detail: "probes disabled by config (http.health.enabled = false)",
      };
    }

    const livenessPath = healthConfig?.path ?? "/health";
    const readinessPath = healthConfig?.readinessPath ?? "/ready";

    const collisions = [livenessPath, readinessPath].filter(appRouteClaims);

    if (collisions.length > 0) {
      return {
        name: "health",
        status: "fail",
        detail:
          `an app route already claims ${collisions.join(" and ")} — Fastify refuses the ` +
          "duplicate registration and the server will not start. Move the app route, or " +
          "rename the probe via http.health.path / http.health.readinessPath",
      };
    }

    // The HTTP connector is what registers the probes. If it did not boot, the
    // connectors check already says so with the reason — reporting the same
    // defect a second time here as a health failure would inflate one problem
    // into two.
    if (!context.connectors.booted.includes("http")) {
      return undefined;
    }

    const registered = [livenessPath, readinessPath].map(fastifyHasGet);

    if (registered.some((answer) => answer === undefined)) {
      return {
        name: "health",
        status: "warn",
        detail:
          "could not read the http server's route table — " +
          `${livenessPath} + ${readinessPath} unverified`,
      };
    }

    const missing = [livenessPath, readinessPath].filter((_path, index) => !registered[index]);

    if (missing.length > 0) {
      return {
        name: "health",
        status: "fail",
        detail: `enabled in config but not registered on the http server: ${missing.join(", ")}`,
      };
    }

    return {
      name: "health",
      status: "ok",
      detail: `liveness ${livenessPath} + readiness ${readinessPath} registered`,
    };
  },
};
