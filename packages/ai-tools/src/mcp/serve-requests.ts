import type { JsonRpcId, JsonRpcRequest, JsonRpcResponse, McpServeCallContext } from "../contracts";
import { isRecord } from "./result";

type PendingRequest = { controller: AbortController; cancellable: boolean };

/**
 * In-flight requests for one transport. HTTP partitions these by credentials;
 * stdio has a single connection. Cancellation never crosses those boundaries.
 * https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation
 * (checked 2026-10-19): ignore unknown/completed ids and never answer cancelled work.
 */
export class McpServeRequests {
  private readonly scopes = new Map<string, Map<JsonRpcId, Set<PendingRequest>>>();

  public cancel(message: unknown, scope = ""): void {
    if (
      !isRecord(message) ||
      message.jsonrpc !== "2.0" ||
      message.method !== "notifications/cancelled" ||
      message.id !== undefined ||
      !isRecord(message.params)
    ) {
      return;
    }

    const { requestId, reason } = message.params;

    if (
      (typeof requestId !== "string" && typeof requestId !== "number") ||
      (reason !== undefined && typeof reason !== "string")
    ) {
      return;
    }

    const pending = this.scopes.get(scope)?.get(requestId);

    // Stateless clients may share credentials and reuse an id. Preserve their
    // calls, but never guess which one an ambiguous notification refers to.
    if (pending?.size === 1) {
      for (const entry of pending) {
        if (entry.cancellable) {
          entry.controller.abort(
            new DOMException(
              typeof reason === "string" ? reason : "Request cancelled.",
              "AbortError",
            ),
          );
        }
      }
    }
  }

  public async run(
    request: JsonRpcRequest,
    context: McpServeCallContext,
    dispatch: (context: McpServeCallContext) => Promise<JsonRpcResponse>,
    scope = "",
  ): Promise<JsonRpcResponse | undefined> {
    let pending = this.scopes.get(scope);

    if (!pending) {
      pending = new Map();
      this.scopes.set(scope, pending);
    }

    const controller = new AbortController();
    // Clients MUST NOT cancel initialize. Other requests share the same registry.
    const entry = { controller, cancellable: request.method !== "initialize" };
    const calls = pending.get(request.id) ?? new Set<PendingRequest>();
    calls.add(entry);
    pending.set(request.id, calls);

    const onAbort = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener("abort", onAbort, { once: true });

    if (context.signal?.aborted) {
      onAbort();
    }

    try {
      if (controller.signal.aborted) {
        return undefined;
      }

      const response = await dispatch({
        ...context,
        requestId: request.id,
        signal: controller.signal,
      });

      return controller.signal.aborted ? undefined : response;
    } catch (cause) {
      if (controller.signal.aborted) {
        return undefined;
      }

      throw cause;
    } finally {
      context.signal?.removeEventListener("abort", onAbort);
      calls.delete(entry);

      if (calls.size === 0) {
        pending.delete(request.id);
      }

      if (pending.size === 0) {
        this.scopes.delete(scope);
      }
    }
  }
}
