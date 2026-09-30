import type { SchemaRegistry } from "./schema-registry";
import type { OpenApiResponse, OpenApiSchema, WarningSink } from "./types";

const STATUS_TEXT: Record<string, string> = {
  "200": "Successful response",
  "201": "Created",
  "202": "Accepted",
  "204": "No content",
  "301": "Moved permanently",
  "302": "Found",
  "304": "Not modified",
  "400": "Bad request",
  "401": "Unauthorized",
  "403": "Forbidden",
  "404": "Not found",
  "405": "Method not allowed",
  "409": "Conflict",
  "410": "Gone",
  "422": "Validation failed",
  "429": "Too many requests",
  "500": "Internal server error",
  "503": "Service unavailable",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Human description of a status code for the required `description` of a response.
 */
export function describeStatus(status: string): string {
  return STATUS_TEXT[status] ?? `Status ${status}`;
}

/**
 * JSON Schema of one response body value: a cast string, a resource class, `[Resource]`
 * (array of it) or a nested plain object of those. Anything else (a resolver function, a
 * builder) is `{}` plus a warning.
 */
function bodyValueSchema(value: unknown, path: string, registry: SchemaRegistry, warn: WarningSink): OpenApiSchema {
  if (typeof value === "string") {
    return registry.cast(value, path, warn);
  }

  if (typeof value === "function") {
    if (registry.isResourceClass(value)) {
      return registry.resourceRef(value);
    }

    warn(`${path}: a function that is not a resource class has no static shape and is documented as {}.`);

    return {};
  }

  if (Array.isArray(value)) {
    return { type: "array", items: bodyValueSchema(value[0], `${path}[]`, registry, warn) };
  }

  if (isRecord(value)) {
    return objectSchema(value, path, registry, warn);
  }

  warn(`${path}: unsupported response value is documented as {}.`);

  return {};
}

function objectSchema(
  body: Record<string, unknown>,
  path: string,
  registry: SchemaRegistry,
  warn: WarningSink,
): OpenApiSchema {
  const properties: Record<string, OpenApiSchema> = {};

  for (const [key, member] of Object.entries(body)) {
    properties[key] = bodyValueSchema(member, `${path}.${key}`, registry, warn);
  }

  return { type: "object", properties, required: Object.keys(properties) };
}

/**
 * Map a handler's `responseSchema` to OpenAPI responses, one per declared status code.
 *
 * `routeLabel` prefixes warnings (for example `POST /login`). A status without a usable
 * `body` becomes a description-only response.
 */
export function buildDeclaredResponses(
  responseSchema: unknown,
  registry: SchemaRegistry,
  warn: WarningSink,
): Record<string, OpenApiResponse> {
  const responses: Record<string, OpenApiResponse> = {};

  if (!isRecord(responseSchema)) {
    return responses;
  }

  for (const [status, entry] of Object.entries(responseSchema)) {
    const body = isRecord(entry) ? entry.body : undefined;

    if (!isRecord(body)) {
      responses[status] = { description: describeStatus(status) };

      continue;
    }

    responses[status] = {
      description: describeStatus(status),
      content: {
        "application/json": { schema: objectSchema(body, `response ${status}`, registry, warn) },
      },
    };
  }

  return responses;
}
