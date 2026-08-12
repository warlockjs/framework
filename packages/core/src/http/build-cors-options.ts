import type { FastifyCorsOptions } from "@fastify/cors";
import config from "@mongez/config";

/**
 * Framework CORS defaults, applied only where the application has said nothing.
 *
 * `origin: "*"` is deliberately NOT paired with `credentials: true` here —
 * browsers reject that combination for credentialed requests, so shipping both
 * would break the legitimate case while appearing permissive.
 */
const defaultCorsOptions: FastifyCorsOptions = {
  origin: "*",
  methods: "*",
};

/**
 * Resolve the CORS options handed to `@fastify/cors`.
 *
 * The application's `http.cors` is spread LAST so a configured allow-list wins.
 * Spreading the framework defaults last instead made `http.cors` unreachable —
 * every app got `origin: "*"` no matter what it configured, in every release up
 * to 4.12.0. Keep this order.
 */
export function buildCorsOptions(): FastifyCorsOptions {
  return {
    ...defaultCorsOptions,
    ...config.get("http.cors", {}),
  };
}
