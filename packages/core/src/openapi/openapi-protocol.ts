import type { OpenApiDocument } from "./types";

/** Version of the OpenAPI mode of the registration child protocol. */
export const OPENAPI_PROTOCOL_VERSION = 1;

/** `type` of the one message the child answers with in OpenAPI mode. */
export const OPENAPI_RESULT_MESSAGE = "openapi-registration:document";

/**
 * The `openapi` field of the registration child request. Its presence switches the child
 * from "send the route snapshot" to "build the OpenAPI document in this process".
 */
export type OpenApiChildRequestOptions = Readonly<{
  version: typeof OPENAPI_PROTOCOL_VERSION;
  /** Overrides `info.title` (default: the app `package.json` name). */
  title?: string;
  /** Overrides `servers[0].url` (default: built from the `http` config). */
  server?: string;
  includePages?: boolean;
}>;

/** What the child sends back: plain JSON only, never a Seal instance. */
export type OpenApiChildResult = Readonly<{
  version: typeof OPENAPI_PROTOCOL_VERSION;
  document: OpenApiDocument;
  warnings: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the `openapi` request field inside the child. Throws on anything unexpected.
 */
export function parseOpenApiChildOptions(value: unknown): OpenApiChildRequestOptions {
  if (
    !isRecord(value) ||
    value.version !== OPENAPI_PROTOCOL_VERSION ||
    !(value.title === undefined || typeof value.title === "string") ||
    !(value.server === undefined || typeof value.server === "string") ||
    !(value.includePages === undefined || typeof value.includePages === "boolean")
  ) {
    throw new Error("Route registration child received an invalid OpenAPI request.");
  }

  return value as OpenApiChildRequestOptions;
}

/**
 * Validate the result message in the parent. Throws on anything unexpected.
 */
export function parseOpenApiChildResult(value: unknown): OpenApiChildResult {
  if (
    !isRecord(value) ||
    value.version !== OPENAPI_PROTOCOL_VERSION ||
    !isRecord(value.document) ||
    typeof value.document.openapi !== "string" ||
    !isRecord(value.document.paths) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === "string")
  ) {
    throw new Error("Route registration child sent an invalid OpenAPI document payload.");
  }

  return Object.freeze({
    version: OPENAPI_PROTOCOL_VERSION,
    document: value.document as unknown as OpenApiDocument,
    warnings: Object.freeze([...(value.warnings as string[])]),
  });
}
