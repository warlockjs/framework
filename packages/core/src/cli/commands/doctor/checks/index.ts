import type { DoctorCheck } from "../check.types";
import { capabilitiesCheck } from "./capabilities.check";
import { authTokensCheck } from "./auth-tokens.check";
import { compressionCheck } from "./compression.check";
import { configAppImportsCheck } from "./config-app-imports.check";
import { configCheck } from "./config.check";
import { connectorsCheck } from "./connectors.check";
import { corsCheck } from "./cors.check";
import { envFilesCheck } from "./env-files.check";
import { handlerSignatureCheck } from "./handler-signature.check";
import { healthCheck } from "./health.check";
import { jwtSecretCheck } from "./jwt-secret.check";
import { localesTsDeprecatedCheck } from "./locales-ts-deprecated.check";
import { memoryCacheCheck } from "./memory-cache.check";
import { optionalPeersCheck } from "./optional-peers.check";
import { productionLoggingCheck } from "./production-logging.check";
import { releaseHygieneCheck } from "./release-hygiene.check";
import { requestTimeoutCheck } from "./request-timeout.check";
import { routesCheck } from "./routes.check";
import { trustProxyCheck } from "./trust-proxy.check";
import { uploadLimitsCheck } from "./upload-limits.check";
import { validationLabelsCheck } from "./validation-labels.check";
import { sitesCheck } from "./sites.check";

/**
 * The default, ordered set of checks `warlock doctor` runs. Ordering controls
 * the report layout: runtime-surface checks first (routes, handler signatures,
 * config, connectors, peers, health, site renders, capabilities), then the
 * deployment settings (upload limits, CORS, token lifetimes, proxy trust,
 * request timeout, production logging, compression, ignored env files, memory
 * cache size), release hygiene last.
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
  configAppImportsCheck,
  connectorsCheck,
  optionalPeersCheck,
  jwtSecretCheck,
  healthCheck,
  validationLabelsCheck,
  sitesCheck,
  capabilitiesCheck,
  localesTsDeprecatedCheck,
  uploadLimitsCheck,
  corsCheck,
  authTokensCheck,
  trustProxyCheck,
  requestTimeoutCheck,
  productionLoggingCheck,
  compressionCheck,
  envFilesCheck,
  memoryCacheCheck,
  releaseHygieneCheck,
];
