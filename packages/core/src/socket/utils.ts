import { type Server } from "socket.io";
import { container } from "../container";

/**
 * Get socket server instance
 */
export function getSocketServer(): Server | null {
  return container.tryGet("socket") ?? null;
}

/**
 * Broadcast through the socket connector's configured adapter. Returns false
 * without a socket server; true means dispatched, not acknowledged by clients.
 * Socket.IO 4.8.3's BroadcastOperator.emit calls adapter.broadcast (installed
 * socket.io/dist/broadcast-operator.js); do not use `io.local` here.
 */
export function broadcastSocketEvent(event: string, ...args: unknown[]): boolean {
  const socket = getSocketServer();
  if (!socket) return false;
  return socket.emit(event, ...args);
}
