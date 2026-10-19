/** An application-defined JSON-RPC error thrown by MCP serving policy hooks. */
export class McpError extends Error {
  public readonly code: number;

  public readonly data: unknown;

  public constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

/**
 * Recognize our error and the SDK's McpError without a runtime SDK dependency.
 * SDK source (checked 2026-10-19):
 * https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/types.ts
 * Only explicitly named errors with an integer code opt in; ordinary throws
 * retain the existing mapping. Preserve the error's message verbatim.
 */
export function isMcpError(cause: unknown): cause is Error & { code: number; data?: unknown } {
  return (
    cause instanceof Error &&
    cause.name === "McpError" &&
    "code" in cause &&
    typeof cause.code === "number" &&
    Number.isInteger(cause.code)
  );
}
