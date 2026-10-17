/**
 * MCP protocol versions the `ai.mcp.serve` server speaks, newest first.
 * `initialize` echoes the client's requested version when it is listed
 * here and otherwise answers with the newest one (lifecycle, version
 * negotiation). The HTTP transport rejects any other value in the
 * `MCP-Protocol-Version` header with 400.
 *
 * Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
 * and https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
 * (checked 2026-10-17).
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
];

/** The newest MCP protocol version the server speaks. */
export const LATEST_PROTOCOL_VERSION = "2025-11-25";
