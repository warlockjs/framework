import type { McpToolCallResult } from "../contracts";

const NATIVE_RESULT = Symbol("mcpResult");

/** An explicit native MCP result, unwrapped only by the serving boundary. */
export type McpNativeResult<T extends McpToolCallResult = McpToolCallResult> = {
  readonly [NATIVE_RESULT]: T;
};

/**
 * Opt in to native MCP content, error status, structured output and metadata.
 * Validation happens after invoke(), so malformed payloads become JSON-RPC
 * errors rather than being caught as tool execution errors.
 */
export function mcpResult<T extends McpToolCallResult>(result: T): McpNativeResult<T> {
  return { [NATIVE_RESULT]: result };
}

/** Read a branded value without accepting lookalike application objects. */
export function isMcpResult(value: unknown): value is McpNativeResult {
  return isRecord(value) && NATIVE_RESULT in value;
}

/** Get the original payload; no cloning, normalization or field stripping. */
export function unwrapMcpResult(value: McpNativeResult): McpToolCallResult {
  return value[NATIVE_RESULT];
}

/** Objects with result fields are candidates only when native mode is enabled. */
export function looksLikeMcpResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    ["content", "isError", "structuredContent", "_meta"].some((key) => key in value)
  );
}

/** Non-array object used by the MCP JSON object fields. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function validAnnotations(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;

  return (
    (value.audience === undefined ||
      (Array.isArray(value.audience) &&
        value.audience.every((role) => role === "user" || role === "assistant"))) &&
    (value.priority === undefined ||
      (typeof value.priority === "number" && value.priority >= 0 && value.priority <= 1)) &&
    optionalString(value.lastModified)
  );
}

function validMetadata(value: Record<string, unknown>): boolean {
  return (
    (value["_meta"] === undefined || isRecord(value["_meta"])) &&
    validAnnotations(value.annotations)
  );
}

function validIcon(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.src === "string" &&
    optionalString(value.mimeType) &&
    (value.sizes === undefined ||
      (Array.isArray(value.sizes) && value.sizes.every((size) => typeof size === "string"))) &&
    (value.theme === undefined || value.theme === "light" || value.theme === "dark")
  );
}

function validContent(value: unknown): boolean {
  if (!isRecord(value) || !validMetadata(value)) return false;

  switch (value.type) {
    case "text":
      return typeof value.text === "string";
    case "image":
    case "audio":
      return typeof value.data === "string" && typeof value.mimeType === "string";
    case "resource_link":
      return (
        typeof value.uri === "string" &&
        typeof value.name === "string" &&
        optionalString(value.title) &&
        optionalString(value.description) &&
        optionalString(value.mimeType) &&
        (value.size === undefined || typeof value.size === "number") &&
        (value.icons === undefined || (Array.isArray(value.icons) && value.icons.every(validIcon)))
      );
    case "resource": {
      const resource = value.resource;

      return (
        isRecord(resource) &&
        typeof resource.uri === "string" &&
        optionalString(resource.mimeType) &&
        validMetadata(resource) &&
        (typeof resource.text === "string" || typeof resource.blob === "string")
      );
    }
    default:
      return false;
  }
}

/** Reject values JSON would drop, coerce or fail to encode (including cycles). */
function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;

  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Array.from(value).every((entry) => isJsonValue(entry, ancestors))
    : Object.values(value).every((entry) => entry === undefined || isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

/**
 * MCP 2025-11-25 CallToolResult and ContentBlock fields:
 * https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-result
 * https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts
 * structuredContent is preserved even when tools/list declares outputSchema.
 * Tool authors remain responsible for conformity to that application schema.
 */
export function assertMcpResult(value: unknown): asserts value is McpToolCallResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value.content) ||
    !Array.from(value.content).every(validContent) ||
    (value.isError !== undefined && typeof value.isError !== "boolean") ||
    (value.structuredContent !== undefined && !isRecord(value.structuredContent)) ||
    (value["_meta"] !== undefined && !isRecord(value["_meta"])) ||
    !isJsonValue(value)
  ) {
    throw new TypeError("Invalid native MCP CallToolResult.");
  }
}
