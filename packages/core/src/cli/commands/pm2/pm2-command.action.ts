import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfigurations } from "../../../application/application-config-types";
import type { CommandActionData } from "../../../commands/types";
import { config } from "../../../config/config-getter";
import type { HttpConfigurations } from "../../../http/types";
import { checkDistReadyToStartAsync } from "../../../production/assert-dist-ready-to-start";
import { resolveBuildConfig } from "../../../production/resolve-build-config";
import type { SocketOptions } from "../../../socket/types";
import { createPm2Config, selectPm2Targets, writePm2Config } from "./pm2-config";

/** No shell, no patterns, no import of PM2 or dependency on its daemon for init. */
export function runPm2(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "pm2",
      args,
      { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              `PM2 command failed (CLI pid ${child.pid ?? "unavailable"}). Install PM2 separately and ensure it is on PATH. ${error.message}`,
            ),
          );
        } else {
          resolve(stdout);
        }
      },
    );
    // Retain the child and its PID; this function never stops a daemon or any
    // application process. PM2 reload is invoked only with validated ids.
  });
}

function stringOption(data: CommandActionData, name: string): string | undefined {
  const value = data.options[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`--${name} requires a value.`);
  return value;
}

export async function pm2CommandAction(data: CommandActionData): Promise<void> {
  const [action, ...extra] = data.args;
  if ((action !== "init" && action !== "reload") || extra.length > 0) {
    throw new Error("Usage: warlock pm2 init | warlock pm2 reload [--id <pm2-id>]");
  }
  const allowed = new Set(
    action === "init"
      ? ["project", "app", "cluster", "instances", "listenTimeout"]
      : ["project", "app", "id"],
  );
  for (const key of Object.keys(data.options)) {
    if (!allowed.has(key)) throw new Error(`Unsupported option for pm2 ${action}: ${key}`);
  }
  if (data.options.cluster !== undefined && typeof data.options.cluster !== "boolean") {
    throw new Error("--cluster must be a boolean.");
  }

  const root = process.cwd();
  const packageJson: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const packageName =
    typeof packageJson === "object" &&
    packageJson !== null &&
    "name" in packageJson &&
    typeof packageJson.name === "string"
      ? packageJson.name
      : undefined;
  const project = stringOption(data, "project") ?? packageName;
  if (!project)
    throw new Error("Set package.json name or pass --project to identify this project.");
  const app = config.get<AppConfigurations | undefined>("app") ?? {};
  const appOverride = stringOption(data, "app");
  const build = resolveBuildConfig();
  const input = {
    root,
    project,
    app: appOverride === undefined ? app : { ...app, appName: appOverride },
    environment: process.env.NODE_ENV ?? "development",
    entryPath: build.entryPath,
    sourcemap: build.sourcemap,
    http: config.get<HttpConfigurations | undefined>("http"),
    socket: config.get<SocketOptions | undefined>("socket"),
  };

  if (action === "init") {
    const generated = createPm2Config(input, {
      cluster: data.options.cluster === true,
      instances: stringOption(data, "instances"),
      listenTimeout: stringOption(data, "listenTimeout"),
    });
    const target = await writePm2Config(root, generated.content);
    console.log(`Created ${target} for ${generated.app.name}.`);
    console.log(
      `Readiness URL: ${generated.readinessUrl ?? "unavailable (HTTP/health disabled or ephemeral port)"}`,
    );
    console.log(
      generated.app.exec_mode === "cluster"
        ? "Cluster reload replaces workers in sequence; a PM2 readiness timeout can still cause downtime."
        : "Fork mode uses a restart on reload; use --cluster for rolling HTTP reloads.",
    );
    return;
  }

  const readiness = await checkDistReadyToStartAsync(build.outdir);
  if (!readiness.ready) throw new Error(readiness.reason);
  // jlist is JSON per PM2's API.js. Match exact identity locally, then reload
  // numeric ids only; a name collision never broadens the operation.
  // https://github.com/Unitech/pm2/blob/master/lib/API.js
  const list: unknown = JSON.parse(await runPm2(["jlist"], root));
  const targets = selectPm2Targets(list, input, stringOption(data, "id"));
  if (targets.some((target) => !target.cluster)) {
    console.warn("Fork mode reload falls back to restart; expect a brief interruption.");
  }
  for (const target of targets) {
    const output = await runPm2(["reload", String(target.id)], root);
    if (output) process.stdout.write(output);
  }
}
