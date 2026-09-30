import type { NamedApiRoute, RequestMethod } from "../router/types";
import type { Environment, RuntimeStrategy } from "../utils/environment";
import {
  runRegistrationChild,
  type RegistrationChildForker,
  type RegistrationChildProcess,
} from "./registration-child-runner";

const PROTOCOL_VERSION = 1;

export type RouteRegistrationSnapshot = Readonly<{
  version: typeof PROTOCOL_VERSION;
  routes: readonly NamedApiRoute[];
}>;

export type RouteRegistrationChildRequest = Readonly<{
  version: typeof PROTOCOL_VERSION;
  cwd: string;
  environment?: Environment;
  runtimeStrategy?: RuntimeStrategy;
}>;

export type RouteRegistrationChildProcess = RegistrationChildProcess;

export type RouteRegistrationSnapshotOptions = Readonly<{
  cwd?: string;
  environment?: Environment;
  runtimeStrategy?: RuntimeStrategy;
  timeoutMs?: number;
  childEntry?: string;
  forkProcess?: RegistrationChildForker;
}>;

/**
 * Collect named application API routes in a fresh process.
 *
 * The child imports application registration modules but deliberately does not
 * register, boot, or start connectors. Application module top-level code can
 * still have arbitrary user-owned side effects; this boundary is framework-only.
 */
export function collectRouteRegistrationSnapshot(
  options: RouteRegistrationSnapshotOptions = {},
): Promise<RouteRegistrationSnapshot> {
  const cwd = options.cwd ?? process.cwd();

  return runRegistrationChild<RouteRegistrationSnapshot>({
    cwd,
    timeoutMs: options.timeoutMs,
    childEntry: options.childEntry,
    forkProcess: options.forkProcess,
    request: {
      version: PROTOCOL_VERSION,
      cwd,
      environment: options.environment,
      runtimeStrategy: options.runtimeStrategy,
    } satisfies RouteRegistrationChildRequest,
    resultMessageType: "route-registration:snapshot",
    resultNoun: "snapshot",
    readResult: (message) => validateSnapshot(message.snapshot),
  });
}

function validateSnapshot(value: unknown): RouteRegistrationSnapshot {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION || !Array.isArray(value.routes)) {
    throw new Error("Route registration child sent an invalid snapshot protocol payload.");
  }

  const routes = value.routes.map((route) => {
    if (
      !isRecord(route) ||
      typeof route.name !== "string" ||
      typeof route.path !== "string" ||
      !isRequestMethod(route.method)
    ) {
      throw new Error("Route registration child sent an invalid route record.");
    }

    const response = route.response;
    const allowedKeys = response === undefined ? 3 : 4;

    if (
      Object.keys(route).length !== allowedKeys ||
      (response !== undefined && !isResponseTypeRecord(response))
    ) {
      throw new Error("Route registration child sent a route record with non-browser-safe fields.");
    }

    const base = {
      name: route.name,
      path: route.path,
      method: normalizeRequestMethod(route.method),
    };

    return Object.freeze(
      response === undefined ? base : { ...base, response: Object.freeze({ ...response }) },
    );
  });

  return Object.freeze({ version: PROTOCOL_VERSION, routes: Object.freeze(routes) });
}

function isResponseTypeRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestMethod(value: unknown): value is RequestMethod {
  return (
    typeof value === "string" &&
    ["get", "post", "put", "delete", "patch", "options", "head", "all"].includes(
      value.toLowerCase(),
    )
  );
}

function normalizeRequestMethod(value: RequestMethod | string): RequestMethod {
  return value.toLowerCase() === "all" ? "all" : (value.toUpperCase() as RequestMethod);
}

