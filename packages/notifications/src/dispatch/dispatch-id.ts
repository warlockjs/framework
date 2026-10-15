import { randomUUID } from "node:crypto";

/**
 * A unique id for one (channel, recipient) dispatch. `sending` and its terminal
 * `sent` / `failed` event share it so observers can pair them — for tracing
 * spans, latency, or spotting a `sending` with no terminal (a hung send).
 */
export function newDispatchId(): string {
  return randomUUID();
}
