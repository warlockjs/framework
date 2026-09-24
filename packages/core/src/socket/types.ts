import { type ServerOptions } from "node:http";
import type { Server } from "socket.io";

/**
 * Factory that returns a Socket.IO adapter (constructor or instance), exactly
 * what `io.adapter()` accepts. Receives the freshly created server.
 */
export type SocketAdapterFactory = (io: Server) => unknown | Promise<unknown>;

/**
 * Socket options
 */
export type SocketOptions = {
  /**
   * Http Port, use it if the http is not enabled in the project
   */
  port?: number;
  /**
   * Socket.IO options
   */
  options?: ServerOptions;
  /**
   * Adapter factory for multi-server broadcasting (e.g. `@socket.io/redis-adapter`).
   * See ./README.md.
   */
  adapter?: SocketAdapterFactory;
  /**
   * Silence the production "no adapter configured" warning
   */
  silenceSingleServerWarning?: boolean;
};
