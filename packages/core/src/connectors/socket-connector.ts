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
    // 1. http is used, then use it
    // 2. http is not used, then create a new server
    let server;
    if (container.has("http.server")) {
      const fastify = container.get("http.server");
      server = fastify.server;
    } else {
      server = socketConfig.ssl ? createHttpsServer() : createHttpServer();
      server.listen(socketConfig.port);
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
   * Shutdown HTTP server
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    if (container.has("socket")) {
      const socket = container.get("socket");
      socket.close();
    }

    if (container.has("socket.rawServer")) {
      const server = container.get("socket.rawServer");
      server.close();
    }

    this.active = false;
  }
}
