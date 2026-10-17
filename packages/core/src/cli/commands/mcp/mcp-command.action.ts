import type { CommandActionData } from "../../../commands/types";
import { featuresMap } from "../../../generations/features";
import { bootForInspect, inspectOptionsFromBoot } from "../../../tooling/inspect/boot-for-inspect";
import { inspectApp, type InspectOptions } from "../../../tooling/inspect/inspect-app";
import { createMcpContext } from "../../../tooling/mcp/create-mcp-context";
import {
  resolveMcpTransport,
  startWarlockMcpServer,
  type WarlockMcpTransport,
} from "../../../tooling/mcp/start-mcp-server";
import { getWarlockVersion } from "../../../utils/framework-vesion";
import { flushAndExit } from "../../flush-and-exit";

function stringOption(value: string | number | boolean | undefined): string | undefined {
  if (typeof value === "number") return String(value);

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * The transport `warlock mcp` options describe: stdio by default, HTTP with
 * `--http` (and `--host`, `--port`, `--path`, `--token` / `WARLOCK_MCP_TOKEN`).
 * Throws on a port that is not a number.
 */
export function mcpTransportFromOptions(
  options: CommandActionData["options"],
  env: NodeJS.ProcessEnv = process.env,
): WarlockMcpTransport {
  const http =
    options.http === true || stringOption(options.host) !== undefined || options.port !== undefined;

  if (!http) return { type: "stdio" };

  const portText = stringOption(options.port);
  const port = portText === undefined ? 0 : Number(portText);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`--port must be a number from 0 to 65535, got ${JSON.stringify(portText)}.`);
  }

  return {
    type: "http",
    host: stringOption(options.host) ?? "127.0.0.1",
    port,
    path: stringOption(options.path) ?? "/mcp",
    token: stringOption(options.token) ?? stringOption(env.WARLOCK_MCP_TOKEN),
  };
}

/**
 * Send `console.log` / `console.info` / `console.debug` to stderr for the rest
 * of the process: over stdio, stdout carries only JSON-RPC, so a stray log
 * line from the app (or the framework's logger) would corrupt the stream.
 */
export function routeConsoleToStderr(): () => void {
  const { log, info, debug } = console;
  const toStderr = (...args: unknown[]) => console.error(...args);

  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;

  return () => {
    console.log = log;
    console.info = info;
    console.debug = debug;
  };
}

/** The read-only boot, run once on the first tool call that needs the app. */
function lazyInspectOptions(): () => Promise<InspectOptions> {
  let boot: Promise<InspectOptions> | undefined;

  return () => {
    boot ??= bootForInspect().then(inspectOptionsFromBoot);

    return boot;
  };
}

/**
 * Action behind `warlock mcp`.
 *
 * Serves the app's tools over MCP. The app is booted the `warlock inspect`
 * way — connectors booted, none started, no connection, no port — on the
 * first call that needs it, so the server answers `initialize` at once.
 * Runs until stdin closes (stdio) or SIGINT/SIGTERM.
 */
export async function mcpCommandAction({ options }: CommandActionData): Promise<void> {
  const transport = mcpTransportFromOptions(options);

  // Refuse an unsafe bind before anything boots.
  resolveMcpTransport(transport);

  if (transport.type === "stdio") routeConsoleToStderr();

  const allowWrites = options.allowWrites === true;
  const inspectOptions = lazyInspectOptions();
  const context = createMcpContext({
    allowWrites,
    inspect: async (sections) => inspectApp({ ...(await inspectOptions()), sections }),
    ...(process.argv[1] ? { cliEntry: process.argv[1] } : {}),
    devtools: {
      ...(stringOption(options.url) ? { url: stringOption(options.url) } : {}),
      ...(stringOption(options.devtoolsPath)
        ? { devtoolsPath: stringOption(options.devtoolsPath) }
        : {}),
    },
    features: Object.keys(featuresMap),
  });

  const server = await startWarlockMcpServer({
    context,
    transport,
    version: await getWarlockVersion(),
  });

  console.error(
    `warlock mcp: ${server.tools.length} tools on ${server.url ?? "stdio"} (${allowWrites ? "writes allowed" : "read-only"})`,
  );

  let closing = false;

  const stop = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    await flushAndExit(0);
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());

  if (transport.type === "stdio") {
    process.stdin.once("end", () => void stop());
  }
}
