import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import type { Server } from "socket.io";
import { container } from "../container";
import { environment } from "../utils/environment";
import { BaseConnector } from "./base-connector";
import { ConnectorLifecyclePhase, type ConnectorName, ConnectorPriority } from "./types";

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

const SINGLE_SERVER_WARNING =
  "socket: no adapter configured — broadcasts only reach clients connected to this server. Use @socket.io/redis-adapter (socket.adapter) behind a load balancer, with sticky sessions for the polling transport.";

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
   * The shared server socket.io attached to, kept for the detach.
   */
  protected sharedServer?: any;

  /**
   * Listener changes socket.io/engine.io made on the shared server at attach:
   * the listeners they added, and the ones they removed (engine.io lifts the
   * existing `request` listeners into its own wrapper). Undone on detach so
   * repeated dev restarts don't stack engines on Fastify's server.
   */
  protected attachedListeners: {
    added: Array<[string, (...args: any[]) => void]>;
    removed: Array<[string, (...args: any[]) => void]>;
  } = { added: [], removed: [] };

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
    const fastify = container.tryGet("http.server");
    if (fastify) {
      server = fastify.server;
      this.ownsRawServer = false;
    } else {
      server = socketConfig.ssl
        ? createHttpsServer({ key: socketConfig.ssl.key, cert: socketConfig.ssl.cert })
        : createHttpServer();
      // Without a handler, EADDRINUSE is an unhandled 'error' event that crashes
      // the process with no context.
      server.on("error", (error: Error) => {
        log.error("socket", "connection", error, { port: socketConfig.port });
      });
      server.listen(socketConfig.port);
      this.ownsRawServer = true;
    }

    container.set("socket.rawServer", server);

    const before = this.snapshotListeners(server);

    this.socket = new SocketServer(server, {
      // The shared raw server may carry OTHER `upgrade` consumers — Vite's HMR
      // websocket does exactly that when `WebConnector` is registered
      // (`web/src/server/web-connector.ts`, `server.hmr.server = fastify.server`).
      // engine.io's default `destroyUpgrade: true` schedules a destroy for every
      // upgrade whose path is not `/socket.io`
      // (`engine.io/build/server.js:676-695`: `setTimeout(… socket.end(), 1000)`),
      // and the only thing saving a foreign websocket today is that it wrote its
      // handshake bytes synchronously and so trips the `bytesWritten <= 0` guard
      // before the 1s timer fires. That is an undocumented race, not a contract.
      // Turning the destroy off removes the coupling outright and makes the
      // shared server safe for any app-owned websocket route.
      // A project can still override it via `socket.options`.
      destroyUpgrade: false,
      ...socketConfig.options,
    });

    if (!this.ownsRawServer) {
      this.sharedServer = server;
      this.attachedListeners = this.diffListeners(before, this.snapshotListeners(server));
    }

    if (socketConfig.adapter) {
      this.socket.adapter((await socketConfig.adapter(this.socket)) as never);
    } else if (environment() === "production" && !socketConfig.silenceSingleServerWarning) {
      log.warn("socket", "adapter", SINGLE_SERVER_WARNING);
    }

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
   * Restart re-boots too: the closed `io` must be replaced and the new
   * `socket` config read, otherwise a config edit in dev restarts nothing.
   */
  public async restart(): Promise<void> {
    await this.shutdown();
    await this.boot();
    await this.start();
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

    const socket = container.tryGet("socket");
    if (socket) {
      if (this.ownsRawServer) {
        // We own the raw server: `io.close()` closes it too, so it is the only
        // close needed (a second `rawServer.close()` always rejects with
        // ERR_SERVER_NOT_RUNNING).
        await new Promise<void>((resolve) => {
          socket.close(() => resolve());
        });
      } else {
        // Shared mode: `io.close()` calls `httpServer.close()`, which would close
        // Fastify's server from here and bypass its graceful drain. Detach
        // instead: disconnect the clients and close the engine only.
        socket.of("/").disconnectSockets(true);
        socket.engine.close();
        this.restoreListeners();
      }
    }

    this.active = false;
  }

  /**
   * Current listeners of the events socket.io touches on a node server.
   */
  private snapshotListeners(server: any): Map<string, Array<(...args: any[]) => void>> {
    const snapshot = new Map<string, Array<(...args: any[]) => void>>();

    for (const event of ["request", "upgrade", "close", "listening"]) {
      snapshot.set(event, server?.listeners?.(event)?.slice() ?? []);
    }

    return snapshot;
  }

  private diffListeners(
    before: Map<string, Array<(...args: any[]) => void>>,
    after: Map<string, Array<(...args: any[]) => void>>,
  ) {
    const added: Array<[string, (...args: any[]) => void]> = [];
    const removed: Array<[string, (...args: any[]) => void]> = [];

    for (const [event, listeners] of before) {
      const now = after.get(event) ?? [];

      for (const listener of now) if (!listeners.includes(listener)) added.push([event, listener]);
      for (const listener of listeners) if (!now.includes(listener)) removed.push([event, listener]);
    }

    return { added, removed };
  }

  /**
   * Undo what attaching did to the shared server, leaving listeners other
   * consumers added since (e.g. Vite's HMR upgrade handler) untouched.
   */
  private restoreListeners(): void {
    const server = this.sharedServer;

    if (!server) return;

    const { added, removed } = this.attachedListeners;

    for (const [event, listener] of added) server.removeListener(event, listener);
    for (const [event, listener] of removed) server.on(event, listener);

    this.attachedListeners = { added: [], removed: [] };
    this.sharedServer = undefined;
  }
}
