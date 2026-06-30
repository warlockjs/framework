import type { DoctorCheck } from "../check.types";
import { configCheck } from "./config.check";
import { connectorsCheck } from "./connectors.check";
import { healthCheck } from "./health.check";
import { optionalPeersCheck } from "./optional-peers.check";
import { releaseHygieneCheck } from "./release-hygiene.check";
import { routesCheck } from "./routes.check";

/**
 * The default, ordered set of checks `warlock doctor` runs. Ordering controls
 * the report layout: runtime-surface checks first (routes, config, connectors,
 * peers, health), release hygiene last.
 */
export const defaultDoctorChecks: DoctorCheck[] = [
  routesCheck,
  configCheck,
  connectorsCheck,
  optionalPeersCheck,
  healthCheck,
  releaseHygieneCheck,
];
