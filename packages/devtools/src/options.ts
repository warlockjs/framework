import { resolveDevtoolsAiOptions } from "./ai/options";
import type { DevtoolsOptions, ResolvedDevtoolsOptions } from "./types";

/** Resolves dashboard options and rejects invalid capacity or URL-prefix values. */
export function resolveDevtoolsOptions(options: DevtoolsOptions = {}): ResolvedDevtoolsOptions {
  const path = (options.path ?? "/__warlock").replace(/\/+$/, "");
  const maxRequests = options.maxRequests ?? 200;
  const nPlusOneThreshold = options.nPlusOneThreshold ?? 5;

  if (!path || !path.startsWith("/")) {
    throw new Error('Devtools option "path" must be a non-root path starting with "/".');
  }

  if (maxRequests < 1) {
    throw new Error('Devtools option "maxRequests" must be at least 1.');
  }

  if (nPlusOneThreshold < 2) {
    throw new Error('Devtools option "nPlusOneThreshold" must be at least 2.');
  }

  // Validates the AI options; the mode defaults are applied where the mode is known.
  if (options.ai !== undefined) resolveDevtoolsAiOptions(options.ai, "development");

  return {
    path,
    maxRequests,
    nPlusOneThreshold,
    allowedHosts: options.allowedHosts ?? [],
    allowProxied: options.allowProxied ?? false,
    panels: options.panels ?? [],
    ...(options.ai === undefined ? {} : { ai: options.ai }),
    ...(options.production === undefined ? {} : { production: options.production }),
  };
}
