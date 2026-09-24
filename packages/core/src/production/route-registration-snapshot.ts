import { fork, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NamedApiRoute, RequestMethod } from "../router/types";
import type { Environment, RuntimeStrategy } from "../utils/environment";

const PROTOCOL_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_DIAGNOSTIC_BYTES = 16_384;

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

type RouteRegistrationChildMessage =
  | Readonly<{ type: "route-registration:snapshot"; snapshot: unknown }>
  | Readonly<{ type: "route-registration:error"; message: string }>;

export type RouteRegistrationChildProcess = Pick<
  ChildProcess,
  "send" | "kill" | "disconnect" | "on" | "stdout" | "stderr" | "connected"
>;

export type RouteRegistrationSnapshotOptions = Readonly<{
  cwd?: string;
  environment?: Environment;
  runtimeStrategy?: RuntimeStrategy;
  timeoutMs?: number;
  childEntry?: string;
  forkProcess?: (entry: string, options: { cwd: string }) => RouteRegistrationChildProcess;
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forkProcess = options.forkProcess ?? defaultForkProcess;
  // An injected fork is a protocol seam, not an installation check. Unit
  // fixtures do not have a packaged ESM child and do not need to resolve one.
  const entry =
    options.childEntry ??
    (options.forkProcess ? "<injected-route-registration-child>" : resolveCompiledChildEntry());

  return new Promise<RouteRegistrationSnapshot>((resolve, reject) => {
    const child = forkProcess(entry, { cwd });
    let settled = false;
    let receivedSnapshot: RouteRegistrationSnapshot | undefined;
    let stdout = "";
    let stderr = "";

    const append = (current: string, chunk: Buffer) => {
      const remaining = MAX_DIAGNOSTIC_BYTES - Buffer.byteLength(current);
      return remaining <= 0 ? current : current + chunk.toString("utf8", 0, remaining);
    };

    const finish = (error?: Error, snapshot?: RouteRegistrationSnapshot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (child.connected) child.disconnect?.();
      if (error) {
        child.kill?.();
        reject(error);
      } else {
        resolve(snapshot!);
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Route registration child timed out after ${timeoutMs}ms.${formatDiagnostics(stdout, stderr)}`,
        ),
      );
    }, timeoutMs);
    timeout.unref?.();

    child.on("error", (error) => {
      finish(
        new Error(
          `Could not start route registration child: ${error.message}${formatDiagnostics(stdout, stderr)}`,
        ),
      );
    });

    child.on("message", (message: unknown) => {
      if (!isChildMessage(message)) return;

      if (message.type === "route-registration:error") {
        finish(
          new Error(
            `Route registration child failed: ${message.message}${formatDiagnostics(stdout, stderr)}`,
          ),
        );
        return;
      }

      try {
        const snapshot = validateSnapshot(message.snapshot);
        if (receivedSnapshot) {
          finish(new Error("Route registration child sent more than one snapshot."));
          return;
        }

        receivedSnapshot = snapshot;
      } catch (error) {
        finish(error as Error);
      }
    });

    child.on("close", (code) => {
      if (settled) return;

      if (code === 0 && receivedSnapshot) {
        finish(undefined, receivedSnapshot);
        return;
      }

      finish(
        new Error(
          `Route registration child exited ${code ?? "by signal"} without a valid snapshot.${formatDiagnostics(stdout, stderr)}`,
        ),
      );
    });

    if (!child.send) {
      finish(new Error("Route registration child did not provide an IPC send channel."));
      return;
    }

    child.send({
      version: PROTOCOL_VERSION,
      cwd,
      environment: options.environment,
      runtimeStrategy: options.runtimeStrategy,
    } satisfies RouteRegistrationChildRequest);
  });
}

function defaultForkProcess(
  entry: string,
  options: { cwd: string },
): RouteRegistrationChildProcess {
  const forkOptions: NonNullable<Parameters<typeof fork>[2]> & { windowsHide?: boolean } = {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  };
  return fork(entry, [], forkOptions);
}

/** Resolve from Core's package root, not an assumed bundler-preserved dirname. */
function resolveCompiledChildEntry(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));

  while (directory !== path.dirname(directory)) {
    const packageJson = path.join(directory, "package.json");
    if (existsSync(packageJson)) {
      try {
        if (JSON.parse(readFileSync(packageJson, "utf8")).name === "@warlock.js/core") {
          const child = path.join(directory, "esm", "production", "route-registration-child.mjs");
          if (existsSync(child)) return child;
          throw new Error(
            `@warlock.js/core is missing its compiled route-registration child at ${child}. Reinstall a complete package.`,
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("route-registration child"))
          throw error;
      }
    }
    directory = path.dirname(directory);
  }

  throw new Error(
    "Could not locate @warlock.js/core package root for the route-registration child.",
  );
}

function isChildMessage(value: unknown): value is RouteRegistrationChildMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    ((value as { type?: unknown }).type === "route-registration:snapshot" ||
      (value as { type?: unknown }).type === "route-registration:error")
  );
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

    if (Object.keys(route).length !== 3) {
      throw new Error("Route registration child sent a route record with non-browser-safe fields.");
    }

    return Object.freeze({
      name: route.name,
      path: route.path,
      method: normalizeRequestMethod(route.method),
    });
  });

  return Object.freeze({ version: PROTOCOL_VERSION, routes: Object.freeze(routes) });
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

function formatDiagnostics(stdout: string, stderr: string): string {
  if (!stdout && !stderr) return "";
  return `\nChild stdout:\n${stdout}\nChild stderr:\n${stderr}`;
}
