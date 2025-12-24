import config from "@mongez/config";
import { registerHttpPlugins } from "../../http/plugins";
import { getServer, startServer } from "../../http/server";
import { router } from "../../router/router";
import { environment } from "../../utils";
import { setBaseUrl } from "../../utils/urls";
import { devLogError, devLogInfo, devLogSuccess } from "../dev-logger";
import { BaseConnector } from "./base-connector";
import { ConnectorPriority } from "./types";

/**
 * HTTP Connector
 * Manages HTTP server (Fastify) lifecycle
 */
export class HttpConnector extends BaseConnector {
  public readonly name = "http";
  public readonly priority = ConnectorPriority.HTTP;

  /**
   * Files that trigger HTTP server restart
   * Note: routes.ts changes will be handled by HMR with wildcard routing
   */
  protected readonly watchedFiles = ["src/config/http.ts", "src/config/http.tsx"];

  /**
   * Initialize HTTP server
   */
  public async start(): Promise<void> {
    const httpConfig = config.get("http");

    if (!httpConfig) return;

    const port = httpConfig.port;
    devLogInfo("Starting http server on port " + port);

    const server = startServer();

    await registerHttpPlugins(server);

    if (environment() === "production") {
      router.scan(server);
    } else {
      router.scanDevServer(server);
    }

    try {
      // 👇🏻 We can use the url of the server
      await server.listen({
        port,
        host: httpConfig.host || "localhost",
      });

      const baseUrl = config.get("app.baseUrl");

      // update base url
      setBaseUrl(baseUrl);

      devLogSuccess(`Server is listening on ${baseUrl}`);
    } catch (error) {
      devLogError("Error while starting http server", error);

      process.exit(1); // stop the process, exit with error
    }

    this.active = true;
  }

  /**
   * Shutdown HTTP server
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    const server = getServer();

    server?.close();

    this.active = false;
  }

  /**
   * Override shouldRestart to handle routes.ts specially
   * routes.ts changes should NOT restart the server (use HMR instead)
   */
  public shouldRestart(changedFiles: string[]): boolean {
    // Only restart for config changes, not routes
    return changedFiles.some((file) => {
      const relativePath = file.replace(/\\/g, "/");
      return relativePath === "src/config/http.ts" || relativePath === "src/config/http.tsx";
    });
  }
}
