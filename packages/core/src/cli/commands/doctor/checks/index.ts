import type { DoctorCheck } from "../check.types";
import { configCheck } from "./config.check";
import { connectorsCheck } from "./connectors.check";
import { handlerSignatureCheck } from "./handler-signature.check";
import { healthCheck } from "./health.check";
import { optionalPeersCheck } from "./optional-peers.check";
import { releaseHygieneCheck } from "./release-hygiene.check";
import { routesCheck } from "./routes.check";

/**
 * The default, ordered set of checks `warlock doctor` runs. Ordering controls
 * the report layout: runtime-surface checks first (routes, handler signatures,
 * config, connectors, peers, health), release hygiene last.
 *
 * Every check is handed the same boot context, and any of them may return
 * `undefined` to opt out of a project it does not apply to — so this list is
 * the set of checks that COULD run, not the set of lines a given project will
 * print.
 */
export const defaultDoctorChecks: DoctorCheck[] = [
  routesCheck,
  handlerSignatureCheck,
  configCheck,
  connectorsCheck,
  optionalPeersCheck,
  healthCheck,
  releaseHygieneCheck,
];
