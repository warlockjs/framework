import { type Server } from "socket.io";
import { container } from "../container";

/**
 * Get socket server instance
 */
export function getSocketServer(): Server | null {
  return container.tryGet("socket") ?? null;
}
