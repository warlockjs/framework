import type { JsonRpcRequest, JsonRpcResponse } from "../contracts";

/**
 * Internal contract every concrete MCP transport (stdio / Streamable HTTP)
 * satisfies. Pure declaration — the factories that build transports live
 * in `transport.ts`.
 *
 * A transport is a thin, framing-only layer: it ships one JSON-RPC request
 * out and resolves with the matching response, and it can ship a one-way
 * notification (no response expected). It owns nothing protocol-specific —
 * the `initialize` handshake, `tools/list`, and `tools/call` semantics all
 * live above it in {@link import("./client").mcp}.
 *
 * **`type`, never `kind`.** This package's discriminators are all `type`;
 * any inbound MCP `kind` is translated at the client boundary.
 */
export interface McpTransportClient {
  /**
   * Send a JSON-RPC request and resolve with its matching response.
   *
   * The transport correlates the response by `id`; on a stdio transport
   * that means matching the line whose `id` equals the request's, on HTTP
   * it is the single response to the POST. Honors `signal` to abort an
   * in-flight call (rejecting the returned promise) and `timeoutMs` to
   * bound the wait.
   *
   * @param request - A fully-formed JSON-RPC request (caller assigns `id`).
   * @param options - Optional per-call abort signal and timeout.
   */
  request<TResult = unknown>(
    request: JsonRpcRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<JsonRpcResponse<TResult>>;

  /**
   * Send a JSON-RPC notification — a method call with no `id` that
   * expects no response (e.g. the post-handshake `notifications/initialized`).
   *
   * @param method - The notification method name.
   * @param params - Optional method parameters.
   */
  notify(method: string, params?: unknown): Promise<void>;

  /**
   * Close the transport, releasing its resources — kill the spawned child
   * (stdio) or drop the session (http). Idempotent: closing twice is a
   * no-op.
   */
  close(): Promise<void>;
}
