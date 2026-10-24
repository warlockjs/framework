import { config } from "../../config/config-getter";
import { buildRateLimitOptions } from "../../http/build-rate-limit-options";
import type { HttpLoggingConfig } from "../../http/request-log-snapshot";
import { expandMethods } from "../../openapi/paths";
import { buildRequestParts } from "../../openapi/request-schemas";
import { buildDeclaredResponses } from "../../openapi/response-schemas";
import type { SchemaRegistry } from "../../openapi/schema-registry";
import { readRouteAuth } from "../../openapi/security";
import { isRequiredGuardRoute } from "../../router/unguarded-route-diagnostics";
import type { Route } from "../../router/types";
import type {
  InspectRoute,
  InspectRouteLogging,
  InspectRouteRateLimit,
  InspectWarning,
  JsonSchema,
} from "./inspect-report.types";

/** Display order of methods within one path, matching `warlock routes`. */
const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "ALL"];

function methodRank(method: string): number {
  const index = METHOD_ORDER.indexOf(method);

  return index === -1 ? METHOD_ORDER.length : index;
}

/** The name of a function, without the `bound ` prefix `bind()` adds. */
export function functionName(value: unknown): string {
  if (typeof value !== "function") return "anonymous";

  const name = value.name.replace(/^bound /, "").trim();

  return name.length > 0 ? name : "anonymous";
}

function limitValue(value: unknown): number | "dynamic" | null {
  if (typeof value === "number") return value;

  return value === undefined || value === null ? null : "dynamic";
}

function windowValue(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") return value;

  return value === undefined || value === null ? null : "dynamic";
}

/**
 * The limiter a route runs under: its own `rateLimit` options, else the global
 * `http.rateLimit` limiter (built with the same defaults the HTTP connector
 * uses), else none. `rateLimit: false` exempts the route from the global
 * limiter; `rateLimit: true` keeps it under the global policy.
 */
function readRateLimit(
  route: Route,
  global: Record<string, unknown> | null,
): InspectRouteRateLimit {
  if (typeof route.rateLimit === "object" && route.rateLimit !== null) {
    return { source: "route", max: route.rateLimit.max, timeWindow: route.rateLimit.timeWindow };
  }

  if (!global || route.rateLimit === false) {
    return { source: "none", max: null, timeWindow: null };
  }

  return {
    source: "global",
    max: limitValue(global.max),
    timeWindow: windowValue(global.timeWindow),
  };
}

/**
 * What the route's request logs keep: the route's `logging` option over
 * `http.logging`, the same precedence `resolveRequestLoggingOptions` applies.
 * Private URL rules can only remove more, per URL, so they are flagged rather
 * than evaluated.
 */
function readLogging(route: Route, global: HttpLoggingConfig): InspectRouteLogging {
  return {
    body: route.logging?.body ?? global.body ?? true,
    query: route.logging?.query ?? global.query ?? true,
    privateRules: (global.private?.length ?? 0) > 0,
  };
}

function globalRateLimit(warnings: InspectWarning[]): Record<string, unknown> | null {
  try {
    const options = buildRateLimitOptions(config.get("http.rateLimit"));

    return options ? { max: options.max, timeWindow: options.timeWindow } : null;
  } catch (error) {
    warnings.push({
      code: null,
      message: `http.rateLimit could not be read: ${error instanceof Error ? error.message : String(error)}`,
      source: "routes",
    });

    return null;
  }
}

/**
 * Describe every route: identity, middleware chain, guard, limits, logging and
 * the request/response schemas the OpenAPI generator derives (the same
 * `buildRequestParts` / `buildDeclaredResponses` code, so `inspect` and
 * `generate.openapi` never disagree). Resource `$ref`s land in `registry`.
 */
export function collectRoutes(
  routes: readonly Route[],
  registry: SchemaRegistry,
  warnings: InspectWarning[],
): InspectRoute[] {
  const rateLimit = globalRateLimit(warnings);
  const logging = (config.get("http.logging") ?? {}) as HttpLoggingConfig;

  const collected = routes.map((route): InspectRoute => {
    const method = String(route.method).toUpperCase();
    const label = `${method} ${route.path}`;
    const warn = (message: string) => {
      warnings.push({
        code: message.includes("JSON Schema") ? "WL4001" : null,
        message: `${label}: ${message}`,
        source: route.sourceFile || null,
      });
    };
    const handler = route.handler as Route["handler"] | undefined;
    const validation = handler?.validation;
    const auth = readRouteAuth(route.middleware, warn);
    const request = buildRequestParts({
      method: expandMethods(route.method)[0] ?? "get",
      path: route.path,
      validation,
      warn,
    });
    const body = request.requestBody?.content["application/json"]?.schema;
    const responses: InspectRoute["responses"] = {};

    for (const [status, response] of Object.entries(
      buildDeclaredResponses(handler?.responseSchema, registry, warn),
    )) {
      const schema: JsonSchema | undefined = response.content?.["application/json"]?.schema;

      responses[status] = { description: response.description, schema: schema ?? null };
    }

    return {
      method,
      path: route.path,
      name: route.name ? route.name : null,
      sourceFile: route.sourceFile ? route.sourceFile : null,
      handler: functionName(handler),
      description: route.description ?? handler?.description ?? null,
      isPage: route.isPage === true,
      middleware: (route.middleware ?? []).map(functionName),
      // A guard that declared itself (`markAuthGuard`) counts even without a
      // `warlock.auth` descriptor; `route.middleware` already carries group middleware.
      auth: auth
        ? {
            required: auth.required !== false || isRequiredGuardRoute(route),
            sources: auth.sources,
            userTypes: auth.userTypes,
          }
        : { required: isRequiredGuardRoute(route), sources: [], userTypes: [] },
      csrf: route.csrf !== false,
      rateLimit: readRateLimit(route, rateLimit),
      logging: readLogging(route, logging),
      request: {
        parameters: request.parameters.map((parameter) => ({
          name: parameter.name,
          in: parameter.in,
          required: parameter.required === true,
          schema: parameter.schema,
        })),
        body: body ?? null,
        customValidation: typeof validation?.validate === "function",
      },
      responses,
    };
  });

  return collected.sort((first, second) => {
    if (first.path !== second.path) return first.path < second.path ? -1 : 1;

    return methodRank(first.method) - methodRank(second.method);
  });
}
