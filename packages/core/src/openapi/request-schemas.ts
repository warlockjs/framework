import type { RequestHandlerValidation } from "../router/types";
import { extractPathParamNames, isBodylessMethod, type OpenApiMethod } from "./paths";
import type {
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiSchema,
  WarningSink,
} from "./types";

type ValidatingLocation = "body" | "query" | "params" | "headers";

type ObjectSchemaParts = {
  schema: OpenApiSchema;
  properties: Record<string, OpenApiSchema>;
  required: Set<string>;
};

export type RequestParts = {
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
};

export type BuildRequestPartsInput = {
  method: OpenApiMethod;
  /** Warlock path, with `:param` segments. */
  path: string;
  validation: RequestHandlerValidation | undefined;
  warn: WarningSink;
};

const VALIDATING_LOCATIONS: readonly string[] = ["body", "query", "params", "headers"];

/**
 * Convert a Seal validator to a JSON Schema object (`draft-2020-12`, the OpenAPI 3.1 dialect)
 * and split it into properties and required keys. Never throws: a validator that cannot be
 * converted is reported through `warn` and yields `undefined`.
 */
function readObjectSchema(
  validator: unknown,
  what: string,
  warn: WarningSink,
): ObjectSchemaParts | undefined {
  const convert = (validator as { toJsonSchema?: unknown } | undefined)?.toJsonSchema;

  if (typeof convert !== "function") {
    return undefined;
  }

  let schema: unknown;

  try {
    schema = convert.call(validator, "draft-2020-12");
  } catch (error) {
    warn(
      `${what} could not be converted to JSON Schema and is not documented: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return undefined;
  }

  const properties = (schema as { properties?: unknown } | undefined)?.properties;

  if (typeof schema !== "object" || schema === null || !isRecord(properties)) {
    warn(`${what} is not an object schema and is not documented.`);

    return undefined;
  }

  const required = (schema as { required?: unknown }).required;

  return {
    schema: schema as OpenApiSchema,
    properties: properties as Record<string, OpenApiSchema>,
    required: new Set(Array.isArray(required) ? required.filter((key) => typeof key === "string") : []),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeParameter(
  name: string,
  location: OpenApiParameter["in"],
  schema: OpenApiSchema,
  required: boolean,
): OpenApiParameter {
  const parameter: OpenApiParameter = { name, in: location, required, schema };

  if (typeof schema.description === "string") {
    parameter.description = schema.description;
  }

  if (location === "query" && schema.type === "object") {
    parameter.style = "deepObject";
    parameter.explode = true;
  }

  return parameter;
}

/**
 * Where an unscoped or scoped `validating` puts the non-path properties.
 *
 * `validateAll` merges body and query (unset) or exactly the listed sources. The OpenAPI
 * placement follows: unset -> by method, a single source -> that source, `body` + `query`
 * -> body for verbs that carry one, query for the rest (and a warning, it is ambiguous).
 */
function resolvePrimaryLocation(
  method: OpenApiMethod,
  validating: ValidatingLocation[],
  warn: WarningSink,
): "body" | "query" | "header" | undefined {
  if (validating.length === 0) {
    return isBodylessMethod(method) ? "query" : "body";
  }

  const hasBody = validating.includes("body");
  const hasQuery = validating.includes("query");

  if (hasBody && hasQuery) {
    warn(
      `validating lists both "body" and "query"; the properties are documented as ${
        isBodylessMethod(method) ? "query parameters" : "the request body"
      }.`,
    );

    return isBodylessMethod(method) ? "query" : "body";
  }

  if (hasBody) {
    return "body";
  }

  if (hasQuery) {
    return "query";
  }

  if (validating.includes("headers")) {
    return "header";
  }

  return undefined;
}

/**
 * Map a handler's `validation` to OpenAPI parameters and a request body.
 *
 * - `validation.params` -> one required path parameter per property.
 * - Path segments without a declared schema -> required string path parameters.
 * - `validation.schema` -> request body (verbs that carry one) or query parameters, placed by
 *   `validating` exactly as `validateAll` reads the request; a property named like a path
 *   segment is a path parameter whenever `params` is validated (unset counts).
 */
export function buildRequestParts(input: BuildRequestPartsInput): RequestParts {
  const { method, path, validation, warn } = input;
  const validating = (validation?.validating ?? []).filter((location): location is ValidatingLocation =>
    VALIDATING_LOCATIONS.includes(location),
  );
  const pathNames = extractPathParamNames(path);

  const paramsSchema = validation?.params
    ? readObjectSchema(validation.params, "validation.params", warn)
    : undefined;
  const mainSchema = validation?.schema
    ? readObjectSchema(validation.schema, "validation.schema", warn)
    : undefined;

  const pathSchemas = new Map<string, OpenApiSchema>();
  const primary = resolvePrimaryLocation(method, validating, warn);
  const takesPathNames = validating.length === 0 || validating.includes("params");

  const located: Record<"body" | "query" | "header", string[]> = { body: [], query: [], header: [] };

  if (paramsSchema) {
    for (const name of pathNames) {
      if (paramsSchema.properties[name]) {
        pathSchemas.set(name, paramsSchema.properties[name]);
      }
    }
  }

  if (mainSchema) {
    for (const [key, propertySchema] of Object.entries(mainSchema.properties)) {
      if (takesPathNames && pathNames.includes(key)) {
        if (!pathSchemas.has(key)) {
          pathSchemas.set(key, propertySchema);
        }

        continue;
      }

      if (!primary) {
        warn(`validation.schema property "${key}" is not a path parameter and is not documented.`);

        continue;
      }

      located[primary].push(key);
    }
  }

  const parameters: OpenApiParameter[] = pathNames.map((name) =>
    describeParameter(name, "path", pathSchemas.get(name) ?? { type: "string" }, true),
  );

  for (const key of located.query) {
    parameters.push(
      describeParameter(key, "query", mainSchema!.properties[key], mainSchema!.required.has(key)),
    );
  }

  for (const key of located.header) {
    parameters.push(
      describeParameter(
        key.toLowerCase(),
        "header",
        mainSchema!.properties[key],
        mainSchema!.required.has(key),
      ),
    );
  }

  if (located.body.length === 0 || !mainSchema) {
    return { parameters };
  }

  const properties: Record<string, OpenApiSchema> = {};

  for (const key of located.body) {
    properties[key] = mainSchema.properties[key];
  }

  const required = located.body.filter((key) => mainSchema.required.has(key));
  const bodySchema: OpenApiSchema = { ...mainSchema.schema, properties };

  if (required.length > 0) {
    bodySchema.required = required;
  } else {
    delete bodySchema.required;
  }

  return {
    parameters,
    requestBody: {
      required: required.length > 0,
      content: { "application/json": { schema: bodySchema } },
    },
  };
}
