import type { OpenApiParameter, OpenApiSchema } from "../types";
import { isRecord, resolveSchema, type SchemaComponents } from "./schema-refs";
import type { PostmanHeader, PostmanQueryParam, PostmanUrl, PostmanVariable } from "./postman-types";

/** The Postman variable every request URL starts with. */
export const BASE_URL_HOST = "{{baseUrl}}";

const PATH_TEMPLATE_PARAM = /\{([^}]+)\}/g;

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return isRecord(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
}

/**
 * Value a parameter starts with in Postman: its declared `example`, `default`, `const` or
 * first `enum` value, otherwise empty so the caller fills it in.
 */
function parameterValue(schema: OpenApiSchema, components: SchemaComponents): string {
  const resolved = resolveSchema(schema, components);

  for (const key of ["example", "default", "const"]) {
    if (key in resolved) {
      return stringifyValue(resolved[key]);
    }
  }

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return stringifyValue(resolved.enum[0]);
  }

  return "";
}

function withDescription<T extends object>(row: T, parameter: OpenApiParameter): T & { description?: string } {
  return parameter.description ? { ...row, description: parameter.description } : row;
}

function queryRows(parameter: OpenApiParameter, components: SchemaComponents): PostmanQueryParam[] {
  const disabled = parameter.required === true ? {} : { disabled: true as const };
  const schema = resolveSchema(parameter.schema, components);

  if (parameter.style === "deepObject" && isRecord(schema.properties)) {
    return Object.entries(schema.properties).map(([property, propertySchema]) => ({
      key: `${parameter.name}[${property}]`,
      value: isRecord(propertySchema) ? parameterValue(propertySchema, components) : "",
      ...disabled,
    }));
  }

  return [
    {
      key: parameter.name,
      value: parameterValue(parameter.schema, components),
      ...(parameter.description ? { description: parameter.description } : {}),
      ...disabled,
    },
  ];
}

/**
 * Header rows for the `header` parameters of an operation. Optional ones start disabled.
 */
export function buildHeaderParameters(
  parameters: readonly OpenApiParameter[],
  components: SchemaComponents,
): PostmanHeader[] {
  return parameters
    .filter((parameter) => parameter.in === "header")
    .map((parameter) =>
      withDescription(
        {
          key: parameter.name,
          value: parameterValue(parameter.schema, components),
          ...(parameter.required === true ? {} : { disabled: true as const }),
        },
        parameter,
      ),
    );
}

/**
 * The Postman URL of an operation: `{id}` templates become `:id` path variables, query
 * parameters become rows (optional ones disabled, so `raw` carries only the enabled ones).
 */
export function buildRequestUrl(
  path: string,
  parameters: readonly OpenApiParameter[],
  components: SchemaComponents,
): PostmanUrl {
  const segments = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(PATH_TEMPLATE_PARAM, ":$1"));

  const variables: PostmanVariable[] = [...path.matchAll(PATH_TEMPLATE_PARAM)].flatMap((match) => {
    const name = match[1];

    if (name === undefined) {
      return [];
    }

    const description = parameters.find((parameter) => parameter.in === "path" && parameter.name === name)
      ?.description;

    return [{ key: name, value: "", ...(description ? { description } : {}) }];
  });

  const query = parameters
    .filter((parameter) => parameter.in === "query")
    .flatMap((parameter) => queryRows(parameter, components));

  const search = query
    .filter((row) => row.disabled !== true)
    .map((row) => `${row.key}=${row.value}`)
    .join("&");

  return {
    raw: `${BASE_URL_HOST}/${segments.join("/")}${search ? `?${search}` : ""}`,
    host: [BASE_URL_HOST],
    path: segments,
    ...(variables.length > 0 ? { variable: variables } : {}),
    ...(query.length > 0 ? { query } : {}),
  };
}
