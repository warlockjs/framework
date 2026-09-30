import {
  buildUnauthorizedResponse,
  buildValidationFailedResponse,
  resolveValidationResponse,
} from "./error-responses";
import {
  buildOperationId,
  expandMethods,
  firstSegmentTag,
  toOpenApiPath,
  type OpenApiMethod,
} from "./paths";
import { buildRequestParts } from "./request-schemas";
import { buildDeclaredResponses } from "./response-schemas";
import { SchemaRegistry } from "./schema-registry";
import { readRouteAuth, SecuritySchemes } from "./security";
import type {
  AuthDescriptor,
  OpenApiBuildResult,
  OpenApiContext,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiResponse,
  OpenApiRouteInput,
} from "./types";

/** `jsonSchemaDialect` of every document: OpenAPI 3.1 schemas are JSON Schema 2020-12. */
export const OPENAPI_JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

const UNSAFE_METHODS: readonly OpenApiMethod[] = ["post", "put", "patch", "delete"];

function describeAuth(auth: AuthDescriptor, method: OpenApiMethod): string[] {
  const lines: string[] = [];

  if (auth.userTypes.length > 0) {
    lines.push(`Requires an authenticated user of type: ${auth.userTypes.join(", ")}.`);
  }

  const usesCookie = auth.sources.some((source) => typeof source !== "string");

  if (usesCookie && UNSAFE_METHODS.includes(method)) {
    lines.push(
      "When authenticating with the cookie, the request must also carry a same-origin Origin or Referer header (CSRF guard).",
    );
  }

  return lines;
}

/**
 * Build an OpenAPI 3.1 document from registered routes.
 *
 * Pure: it reads the routes it is given (`router.list()` in the app), converts Seal schemas
 * with `toJsonSchema("draft-2020-12")` and returns plain JSON plus the gaps it found as
 * `warnings`. It never throws for a single route it cannot document; that route is
 * documented as far as possible and a warning explains what was left out.
 */
export function buildOpenApiDocument(
  routes: readonly OpenApiRouteInput[],
  context: OpenApiContext,
): OpenApiBuildResult {
  const warnings: string[] = [];
  const registry = new SchemaRegistry(context.resolveResourceName, (message) => warnings.push(message));
  const security = new SecuritySchemes();
  const validationShape = resolveValidationResponse(context.validationResponse);
  const paths: OpenApiDocument["paths"] = {};
  const tags = new Set<string>();
  const operationIds = new Set<string>();

  for (const route of routes) {
    if (route.isPage && !context.includePages) {
      continue;
    }

    const methods = expandMethods(route.method);
    const label = `${String(route.method).toUpperCase()} ${route.path}`;
    const warn = (message: string) => warnings.push(`${label}: ${message}`);

    if (methods.length === 0) {
      warn(`unsupported method "${String(route.method)}", route skipped.`);

      continue;
    }

    const handler = route.handler as OpenApiRouteInput["handler"] | undefined;
    const validation = handler?.validation;
    const auth = readRouteAuth(route.middleware, warn);
    const tag = firstSegmentTag(route.path);
    const pathKey = toOpenApiPath(route.path);

    if (validation?.validate) {
      warn("validation.validate is custom middleware and is not documented.");
    }

    for (const method of methods) {
      paths[pathKey] ??= {};

      if (paths[pathKey][method]) {
        warn(`${method.toUpperCase()} ${pathKey} is already documented by an earlier route; this one is skipped.`);

        continue;
      }

      let operationId = buildOperationId(route.name, method, route.path, methods.length > 1);

      if (operationIds.has(operationId)) {
        let suffix = 2;

        while (operationIds.has(`${operationId}_${suffix}`)) {
          suffix++;
        }

        warn(`operationId "${operationId}" is already used; renamed to "${operationId}_${suffix}".`);
        operationId = `${operationId}_${suffix}`;
      }

      operationIds.add(operationId);

      const description = [
        route.description ?? handler?.description,
        ...(auth ? describeAuth(auth, method) : []),
      ].filter((line): line is string => typeof line === "string" && line.length > 0);

      const request = buildRequestParts({ method, path: route.path, validation, warn });

      const responses: Record<string, OpenApiResponse> = route.isPage
        ? { "200": { description: "HTML page", content: { "text/html": { schema: { type: "string" } } } } }
        : buildDeclaredResponses(handler?.responseSchema, registry, warn);

      if (!Object.keys(responses).some((status) => status.startsWith("2"))) {
        responses["200"] = { description: "Successful response" };
      }

      if (validation?.schema) {
        const failed = buildValidationFailedResponse(validationShape, registry);

        responses[failed.status] ??= failed.response;
      }

      if (auth) {
        responses["401"] ??= buildUnauthorizedResponse(registry);
      }

      if (tag) {
        tags.add(tag);
      }

      // Built in reading order: identity, prose, inputs, outputs, security.
      const operation: OpenApiOperation = {
        operationId,
        ...(route.label ? { summary: route.label } : {}),
        ...(description.length > 0 ? { description: description.join("\n\n") } : {}),
        ...(tag ? { tags: [tag] } : {}),
        ...(request.parameters.length > 0 ? { parameters: request.parameters } : {}),
        ...(request.requestBody ? { requestBody: request.requestBody } : {}),
        responses: sortResponses(responses),
        ...(auth ? { security: security.requirementsFor(auth) } : {}),
      };

      paths[pathKey][method] = operation;
    }
  }

  // Keys in reading order: header, servers, tags, paths, components.
  const document: OpenApiDocument = {
    openapi: "3.1.0",
    jsonSchemaDialect: OPENAPI_JSON_SCHEMA_DIALECT,
    info: { ...context.info },
    ...(context.servers && context.servers.length > 0
      ? { servers: context.servers.map((url) => ({ url })) }
      : {}),
    ...(tags.size > 0 ? { tags: [...tags].sort().map((name) => ({ name })) } : {}),
    paths,
  };

  const hasSchemas = Object.keys(registry.schemas).length > 0;

  if (hasSchemas || security.hasSchemes()) {
    document.components = {};

    if (hasSchemas) {
      document.components.schemas = registry.schemas;
    }

    if (security.hasSchemes()) {
      document.components.securitySchemes = security.schemes;
    }
  }

  return { document, warnings: [...new Set(warnings)] };
}

function sortResponses(responses: Record<string, OpenApiResponse>): Record<string, OpenApiResponse> {
  return Object.fromEntries(
    Object.entries(responses).sort(([first], [second]) => first.localeCompare(second)),
  );
}
