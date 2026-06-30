import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import type { Server } from "socket.io";
import { container } from "../container";
import { BaseConnector } from "./base-connector";
import { ConnectorLifecyclePhase, ConnectorName, ConnectorPriority } from "./types";

/**
 * Shown when a project enables sockets (a `socket` config is present) but the
 * optional `socket.io` peer is not installed.
 */
const SOCKET_INSTALL_INSTRUCTIONS = `
Realtime socket server requires the socket.io package.
Install it with:

  warlock add socket

Or manually:

  npm install socket.io
  pnpm add socket.io
  yarn add socket.io
`.trim();

/**
 * Socket Connector
 * Manages Socket server (Socket.IO) lifecycle
 */
export class SocketConnector extends BaseConnector {
  public readonly name: ConnectorName = "socket";
  public readonly priority = ConnectorPriority.SOCKET;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Late;

  /**
   * Files that trigger Socket server restart
   * Note: routes.ts changes will be handled by HMR with wildcard routing
   * Connectors receive config file paths directly (not .env) thanks to layer-executor
   */
  protected readonly watchedFiles = ["src/config/socket.ts"];

  protected socket?: Server;

  /**
   * Whether this connector created the underlying node HTTP(S) server.
   *
   * When `http` is present, socket binds onto the HTTP connector's shared
   * `fastify.server` and must NOT close it on shutdown — the HTTP connector
   * owns the graceful drain. Socket only closes the node server when it
   * created one itself (http absent). See {@link shutdown}.
   */
  protected ownsRawServer = false;

  /**
   * Boot the connector
   */
  public async boot() {
    const socketConfig = config.get("socket");

    if (!socketConfig) return;

    // socket.io is an optional peer — load it lazily so projects that don't use
    // realtime sockets never need it installed (mirrors the mail/storage drivers).
    let SocketServer: typeof import("socket.io").Server;
    try {
      ({ Server: SocketServer } = await import("socket.io"));
    } catch {
      throw new Error(SOCKET_INSTALL_INSTRUCTIONS);
    }

    log.info("socket", "connection", "Starting Socket.IO server");

    // now we have two cases
    // 1. http is used, then use it (shared — the HTTP connector owns it)
    // 2. http is not used, then create a new server (we own it)
    let server;
    if (container.has("http.server")) {
      const fastify = container.get("http.server");
      server = fastify.server;
      this.ownsRawServer = false;
    } else {
      server = socketConfig.ssl ? createHttpsServer() : createHttpServer();
      server.listen(socketConfig.port);
      this.ownsRawServer = true;
    }

    container.set("socket.rawServer", server);

    this.socket = new SocketServer(server, socketConfig.options);

    container.set("socket", this.socket);
  }

  /**
   * Initialize Socket server
   */
  public async start(): Promise<void> {
    const socketConfig = config.get("socket");

    // `this.socket` is only set by boot() once a socket config is present —
    // use it (not a never-assigned field) to detect a successful boot.
    if (!socketConfig || !this.socket) return;

    log.success("socket", "connection", "Established Socket.IO server");

    this.active = true;
  }

  /**
   * Shutdown Socket server
   *
   * Always closes the Socket.IO layer (and awaits the drain). The underlying
   * node HTTP(S) server is only closed here when this connector created it
   * ({@link ownsRawServer}); when `http` owns the shared server, we leave it
   * for the HTTP connector to drain and close, so the two connectors don't
   * race to `close()` the same socket.
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    if (container.has("socket")) {
      const socket = container.get("socket");
      // socket.io's close() takes a callback — await it so shutdown doesn't
      // report done while sockets are still draining.
      await new Promise<void>((resolve) => {
        socket.close(() => resolve());
      });
    }

    if (this.ownsRawServer && container.has("socket.rawServer")) {
      const server = container.get("socket.rawServer");
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }

    this.active = false;
  }
}
