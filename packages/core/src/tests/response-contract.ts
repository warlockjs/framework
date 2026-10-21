import { buildDeclaredResponses } from "../openapi/response-schemas";
import { SchemaRegistry } from "../openapi/schema-registry";
import type { OpenApiSchema } from "../openapi/types";
import { router } from "../router/router";
import type { RequestMethod, Route } from "../router/types";
import { testRequest } from "./test-helpers";

export type ResponseContractRoute = Pick<Route, "method" | "path" | "handler">;
export type ResponseContractCase = {
  /** Concrete HTTP method for an `all` route. */
  method?: Exclude<RequestMethod, "all">;
  /** Concrete path, including query values, for parameterized routes. */
  path?: string;
  init?: Omit<RequestInit, "method">;
  /** Assert the intended scenario's status as well as its body. */
  status?: number;
};
export type ResponseContractOptions = {
  /** Defaults to registered routes with responseSchema in this process. */
  routes?: readonly ResponseContractRoute[];
  /** Required for parameterized routes and methods other than GET. No cases are skipped. */
  cases?: (route: ResponseContractRoute) => readonly ResponseContractCase[];
  /** Use an in-process server or an authenticated client; defaults to testRequest. */
  client?: { request(path: string, init?: RequestInit): Promise<Response> };
  /** Require fixtures to exercise every declared status. Defaults to false. */
  requireAllStatuses?: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate the JSON Schema subset emitted by Core's response-schema translator. */
function matches(
  value: unknown,
  schema: OpenApiSchema,
  refs: Record<string, OpenApiSchema>,
): boolean {
  if (typeof schema.$ref === "string") {
    const target = refs[schema.$ref.replace("#/components/schemas/", "")];
    if (!target) throw new Error(`Unresolved response schema reference: ${schema.$ref}`);
    return matches(value, target, refs);
  }
  for (const key of ["oneOf", "anyOf"]) {
    const alternatives = schema[key];
    if (Array.isArray(alternatives)) {
      const count = alternatives.filter(
        (entry: unknown) => record(entry) && matches(value, entry, refs),
      ).length;
      return key === "oneOf" ? count === 1 : count > 0;
    }
  }
  if (Array.isArray(schema.type)) {
    return schema.type.some((type: unknown) => matches(value, { ...schema, type }, refs));
  }
  switch (schema.type) {
    case "null":
      return value === null;
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array": {
      const items = schema.items;
      return (
        Array.isArray(value) &&
        (!record(items) || value.every((item: unknown) => matches(item, items, refs)))
      );
    }
    case "object": {
      if (!record(value)) return false;
      if (
        Array.isArray(schema.required) &&
        schema.required.some(
          (key: unknown) => typeof key === "string" && !Object.hasOwn(value, key),
        )
      )
        return false;
      const properties = schema.properties;
      return (
        !record(properties) ||
        Object.entries(properties).every(
          ([key, child]) =>
            !Object.hasOwn(value, key) || (record(child) && matches(value[key], child, refs)),
        )
      );
    }
    default:
      throw new Error("Response schema has no verifiable static shape.");
  }
}

/**
 * Call real HTTP routes and check their serialized bodies against responseSchema.
 * Throws on undeclared statuses, mismatches, empty discovery or unsupported shapes.
 * Additional response fields are allowed, as in Core's OpenAPI declarations.
 */
export async function assertResponseContracts(
  options: ResponseContractOptions = {},
): Promise<void> {
  const routes = options.routes ?? router.list().filter((route) => route.handler.responseSchema);
  if (routes.length === 0)
    throw new Error("No response contracts found. Load routes in this process first.");
  const plans = routes.map((route) => {
    const label = `${route.method} ${route.path}`;
    if (!route.handler.responseSchema) throw new Error(`${label}: missing responseSchema.`);
    const registry = new SchemaRegistry(undefined, (warning) => {
      throw new Error(`${label}: ${warning}`);
    });
    const responses = buildDeclaredResponses(route.handler.responseSchema, registry, (warning) => {
      throw new Error(`${label}: ${warning}`);
    });
    if (Object.keys(responses).length === 0) throw new Error(`${label}: empty responseSchema.`);
    const cases: readonly ResponseContractCase[] =
      options.cases?.(route) ??
      (route.method.toUpperCase() === "GET" && !/[:*]/.test(route.path) ? [{}] : []);
    if (cases.length === 0) throw new Error(`${label}: provide contract request fixtures.`);
    for (const fixture of cases) {
      if (route.method === "all" && !fixture.method) {
        throw new Error(`${label}: provide a concrete fixture method.`);
      }
      if (/[:*]/.test((fixture.path ?? route.path).split("?")[0] ?? ""))
        throw new Error(`${label}: provide a concrete fixture path.`);
    }
    return { route, label, registry, responses, cases };
  });
  const client = options.client ?? { request: testRequest };
  for (const { route, label, registry, responses, cases } of plans) {
    const covered = new Set<string>();
    for (const fixture of cases) {
      const response = await client.request(fixture.path ?? route.path, {
        ...fixture.init,
        method: route.method === "all" ? fixture.method : route.method,
        redirect: "manual",
      });
      const status = String(response.status);
      if (fixture.status !== undefined && fixture.status !== response.status) {
        throw new Error(`${label}: expected status ${fixture.status}, received ${status}.`);
      }
      const declared = responses[status];
      if (!declared) throw new Error(`${label}: undeclared response status ${status}.`);
      const schema = declared.content?.["application/json"]?.schema;
      if (
        route.method === "HEAD" ||
        (route.method === "all" && fixture.method === "HEAD") ||
        response.status === 204 ||
        response.status === 304
      ) {
        if (await response.text()) throw new Error(`${label}: status ${status} must have no body.`);
      } else {
        if (!schema) throw new Error(`${label}: status ${status} has no body schema.`);
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new Error(`${label}: status ${status} did not return JSON.`);
        }
        if (!matches(body, schema, registry.schemas)) {
          throw new Error(
            `${label}: response body does not match responseSchema for status ${status}.`,
          );
        }
      }
      covered.add(status);
    }
    if (options.requireAllStatuses) {
      const missing = Object.keys(responses).filter((status) => !covered.has(status));
      if (missing.length)
        throw new Error(`${label}: untested declared statuses: ${missing.join(", ")}.`);
    }
  }
}
