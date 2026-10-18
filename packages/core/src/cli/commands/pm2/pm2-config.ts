import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { AppConfigurations } from "../../../application/application-config-types";
import { DEFAULT_SHUTDOWN_TIMEOUT } from "../../../connectors/shutdown-timeout";
import { resolveBindPort } from "../../../http/resolve-bind-port";
import type { HttpConfigurations } from "../../../http/types";
import type { SocketOptions } from "../../../socket/types";
import type { ResolvedBuildConfig } from "../../../production/resolve-build-config";

export type Pm2AppInput = {
  root: string;
  project: string;
  app: AppConfigurations;
  environment: string;
  entryPath: string;
  sourcemap: ResolvedBuildConfig["sourcemap"];
  http?: HttpConfigurations;
  socket?: SocketOptions;
};

export type Pm2InitOptions = {
  cluster?: boolean;
  instances?: string;
  listenTimeout?: string;
};

/** Refuse selectors PM2 could interpret as patterns, file names or options. */
function nameComponent(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error(
      `${label} must contain only letters, digits, underscores and hyphens, starting with a letter or digit.`,
    );
  }
  return value;
}

export function pm2AppName(input: Pick<Pm2AppInput, "project" | "app" | "environment">): string {
  // Preserve the npm scope in the project identity instead of dropping it.
  const project = input.project.replace(/^@([^/]+)\/([^/]+)$/, "$1-$2");
  return [
    nameComponent(project, "Project name (--project)"),
    nameComponent(input.app.appName ?? "app", "App name (--app or app.appName)"),
    nameComponent(input.environment, "NODE_ENV"),
  ].join("-");
}

function positiveInteger(value: number | string, label: string): number {
  const number = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number <= 0 || number > 2_147_483_647) {
    throw new Error(`${label} must be a positive integer no greater than 2147483647.`);
  }
  return number;
}

export function assertClusterSockets(socket?: SocketOptions): void {
  if (!socket) return;
  if (typeof socket.adapter !== "function") {
    throw new Error(
      "PM2 cluster mode with sockets requires socket.adapter for broadcasts between workers. Configure an adapter such as @socket.io/redis-adapter, or use fork mode.",
    );
  }
  // A proxy sticky to a shared PM2 port is not sticky to its workers. We do
  // not install primary-process routing. Fail closed for long-polling.
  // https://socket.io/docs/v4/using-multiple-nodes/
  if (socket.options?.transports?.length !== 1 || socket.options.transports[0] !== "websocket") {
    throw new Error(
      'PM2 cluster sockets require socket.options.transports: ["websocket"] and WebSocket-only clients. Polling needs sticky routing to individual workers; use separate fork listeners behind a sticky proxy for polling.',
    );
  }
}

function readinessUrl(http?: HttpConfigurations): string | undefined {
  if (!http || http.health?.enabled === false) return undefined;
  const port = resolveBindPort(http.port);
  if (port === 0) return undefined;
  const bindHost = http.host ?? "localhost";
  const host = bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost === "::" ? "::1" : bindHost;
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const probePath = http.health?.readinessPath ?? "/ready";
  if (!probePath.startsWith("/") || probePath.startsWith("//") || /[\r\n]/.test(probePath)) {
    throw new Error("http.health.readinessPath must be a local absolute URL path.");
  }
  return `${http.serverOptions?.https ? "https" : "http"}://${authority}:${port}${probePath}`;
}

export function createPm2Config(input: Pm2AppInput, options: Pm2InitOptions = {}) {
  const cluster = options.cluster === true;
  if (!cluster && options.instances !== undefined) {
    throw new Error("--instances requires --cluster; fork mode runs exactly one process.");
  }
  if (cluster) assertClusterSockets(input.socket);
  const instances = cluster
    ? options.instances === "max"
      ? "max"
      : positiveInteger(options.instances ?? "2", "--instances")
    : 1;
  const app = {
    name: pm2AppName(input),
    cwd: path.resolve(input.root),
    // Run the bundle itself, not the `warlock start` child supervisor: PM2
    // must own the process that listens and sends its readiness message.
    script: path.resolve(input.root, input.entryPath),
    interpreter: process.execPath,
    node_args: input.sourcemap === false ? [] : ["--enable-source-maps"],
    exec_mode: cluster ? "cluster" : "fork",
    instances,
    wait_ready: true,
    listen_timeout: positiveInteger(options.listenTimeout ?? "30000", "--listen-timeout"),
    kill_timeout: positiveInteger(
      input.app.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT,
      "app.shutdownTimeout",
    ),
    // Keep @warlock.js/logger messages intact; leave per-worker log suffixes.
    time: false,
    merge_logs: false,
    env: { NODE_ENV: input.environment },
  };
  const url = readinessUrl(input.http);
  // JSON encoding keeps project/config strings from becoming executable code
  // or escaping a comment in this CommonJS file.
  const content = [
    "// Generated by warlock pm2 init. Rebuild the app before starting PM2.",
    "// PM2 timeouts: https://pm2.keymetrics.io/docs/usage/signals-clean-restart/",
    `// Readiness URL (external probe; PM2 does not poll it): ${JSON.stringify(
      url ?? "unavailable: HTTP/health disabled or ephemeral port",
    )
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029")}`,
    `module.exports = ${JSON.stringify({ apps: [app] }, null, 2)};`,
    "",
  ].join("\n");
  return { app, content, readinessUrl: url };
}

export async function writePm2Config(root: string, content: string): Promise<string> {
  const target = path.resolve(root, "ecosystem.config.cjs");
  // Atomic create: an existing/customized ecosystem is never overwritten.
  await writeFile(target, content, { encoding: "utf8", flag: "wx" });
  return target;
}

export type Pm2Target = { id: number; cluster: boolean };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Validate the entire target set before issuing any mutating PM2 command. */
export function selectPm2Targets(list: unknown, input: Pm2AppInput, id?: string): Pm2Target[] {
  if (!Array.isArray(list)) throw new Error("PM2 jlist did not return a process array.");
  if (id !== undefined && (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))) {
    throw new Error("--id must be a numeric PM2 id.");
  }
  const name = pm2AppName(input);
  const targets: Pm2Target[] = [];
  for (const item of list) {
    const process = record(item);
    if (!process) throw new Error("Invalid PM2 process entry.");
    if (id !== undefined ? process.pm_id !== Number(id) : process.name !== name) continue;
    const env = record(process.pm2_env);
    if (
      process.name !== name ||
      !env ||
      env.pm_cwd !== path.resolve(input.root) ||
      env.pm_exec_path !== path.resolve(input.root, input.entryPath)
    ) {
      throw new Error(
        `Refusing to reload PM2 id ${String(process.pm_id)}: name, working directory or bundle does not belong to this app.`,
      );
    }
    if (
      typeof process.pm_id !== "number" ||
      !Number.isSafeInteger(process.pm_id) ||
      process.pm_id < 0
    ) {
      throw new Error("Invalid PM2 id in process list.");
    }
    if (env.exec_mode !== "fork_mode" && env.exec_mode !== "cluster_mode") {
      throw new Error("Unrecognized PM2 execution mode.");
    }
    const cluster = env.exec_mode === "cluster_mode";
    if (cluster) {
      assertClusterSockets(input.socket);
      if (env.wait_ready !== true || env.status !== "online") {
        throw new Error(
          "Rolling reload requires an online cluster worker with wait_ready: true. Check its PM2 configuration and status.",
        );
      }
    }
    targets.push({ id: process.pm_id, cluster });
  }
  if (targets.length === 0)
    throw new Error(
      `No PM2 process belonging to ${name} was found. Start its ecosystem file first.`,
    );
  if (new Set(targets.map((target) => target.id)).size !== targets.length) {
    throw new Error("Duplicate PM2 ids in process list.");
  }
  return targets;
}
