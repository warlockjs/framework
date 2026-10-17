import { connectorsManager } from "../connectors/connectors-manager";
import { getHttpReadyReport } from "../http/ready-report";
import { removeDevServerState, writeDevServerState } from "../tooling/dev-state/dev-server-state";
import { DEFAULT_DEVTOOLS_PATH } from "../tooling/devtools/devtools-client";
import { devLogInfo, devLogWarn } from "./dev-logger";

/** `devServer.mcp` (or `--mcp`) resolved: off, or the HTTP options. */
export type DevMcpOptions = false | { port: number; token?: string; allowWrites: boolean };

/** Resolve `devServer.mcp` and the `--mcp` flag (the flag turns it on with the config's options). */
export function resolveDevMcpOptions(
  flag: boolean | undefined,
  config: boolean | { port?: number; token?: string; allowWrites?: boolean } | undefined,
): DevMcpOptions {
  if (!flag && !config) return false;

  const settings = typeof config === "object" ? config : {};

  return {
    port: settings.port ?? 0,
    ...(settings.token ? { token: settings.token } : {}),
    allowWrites: settings.allowWrites === true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The agent-facing side of `warlock dev`, all best-effort — none of it may
 * stop the app from serving:
 *
 * - records the server's address in `.warlock/dev-server.json` (read by
 *   `warlock trace` and `warlock mcp`), removed on shutdown;
 * - keeps the generated section of `AGENTS.md` fresh (unless
 *   `devServer.agentsMd: false`), on boot and after each reload, debounced;
 * - with `--mcp` / `devServer.mcp`, serves `warlock mcp` over HTTP on
 *   loopback from this process, so `inspect_*` reads the live registries.
 *
 * The tooling modules are imported lazily: they pull in the TypeScript
 * compiler and the generators, which a dev boot without them never needs.
 */
export class DevAgentTooling {
  private refresher?: { schedule(): void; dispose(): void };
  private mcp?: { url?: string; close(): Promise<void> };
  private stateWritten = false;

  /** @param cwd Project root. Default: `process.cwd()`. */
  public constructor(private readonly cwd: string = process.cwd()) {}

  public async start(options: { agentsMd: boolean; mcp: DevMcpOptions }): Promise<void> {
    const http = getHttpReadyReport();
    const devtoolsActive = connectorsManager
      .list()
      .some((connector) => connector.name === "devtools" && connector.isActive());

    if (options.mcp) {
      await this.startMcp(options.mcp, http?.url);
    }

    if (http) {
      try {
        writeDevServerState(
          {
            schemaVersion: 1,
            pid: process.pid,
            url: http.url,
            startedAt: new Date().toISOString(),
            devtools: devtoolsActive ? { path: DEFAULT_DEVTOOLS_PATH } : null,
            mcp: this.mcp?.url ? { url: this.mcp.url } : null,
          },
          this.cwd,
        );
        this.stateWritten = true;
      } catch (error) {
        devLogWarn(`Could not record the dev server address: ${errorMessage(error)}`);
      }
    }

    if (options.agentsMd) {
      await this.startAgentsMd();
    }
  }

  /** Called after every hot reload: routes or modules may have changed. */
  public afterReload(): void {
    this.refresher?.schedule();
  }

  public async shutdown(): Promise<void> {
    this.refresher?.dispose();
    this.refresher = undefined;

    if (this.mcp) {
      const server = this.mcp;
      this.mcp = undefined;

      try {
        await server.close();
      } catch (error) {
        devLogWarn(`MCP server did not close cleanly: ${errorMessage(error)}`);
      }
    }

    if (this.stateWritten) {
      this.stateWritten = false;
      removeDevServerState(process.pid, this.cwd);
    }
  }

  private async startAgentsMd(): Promise<void> {
    try {
      const [{ createAgentsMdRefresher }, { inspectApp }] = await Promise.all([
        import("../tooling/agents-md"),
        import("../tooling/inspect/inspect-app"),
      ]);

      this.refresher = createAgentsMdRefresher({
        cwd: this.cwd,
        collect: () => inspectApp({ sections: ["routes", "models", "packages"] }),
        onWrite: (result) => {
          if (result.status === "created" || result.status === "updated") {
            devLogInfo(`AGENTS.md generated section ${result.status}`);
          }
        },
        onError: (error) => devLogWarn(`AGENTS.md not refreshed: ${errorMessage(error)}`),
      });
      this.refresher.schedule();
    } catch (error) {
      devLogWarn(`AGENTS.md refresh is off: ${errorMessage(error)}`);
    }
  }

  private async startMcp(
    options: Exclude<DevMcpOptions, false>,
    serverUrl?: string,
  ): Promise<void> {
    try {
      const [{ createMcpContext }, { startWarlockMcpServer }, { inspectApp }, { featuresMap }] =
        await Promise.all([
          import("../tooling/mcp/create-mcp-context"),
          import("../tooling/mcp/start-mcp-server"),
          import("../tooling/inspect/inspect-app"),
          import("../generations/features"),
        ]);
      const context = createMcpContext({
        cwd: this.cwd,
        allowWrites: options.allowWrites,
        inspect: (sections) => inspectApp({ sections }),
        ...(process.argv[1] ? { cliEntry: process.argv[1] } : {}),
        devtools: serverUrl ? { url: serverUrl } : {},
        features: Object.keys(featuresMap),
      });

      this.mcp = await startWarlockMcpServer({
        context,
        transport: {
          type: "http",
          host: "127.0.0.1",
          port: options.port,
          ...(options.token ? { token: options.token } : {}),
        },
      });

      devLogInfo(
        `MCP server at ${this.mcp.url ?? "?"} (${options.allowWrites ? "writes allowed" : "read-only"}${options.token ? ", token required" : ""})`,
      );
    } catch (error) {
      devLogWarn(`MCP server not started: ${errorMessage(error)}`);
    }
  }
}
