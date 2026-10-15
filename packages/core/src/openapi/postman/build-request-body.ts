import type { OpenApiRequestBody, OpenApiSchema } from "../types";
import { exampleFromSchema } from "./example-from-schema";
import type { PostmanBody, PostmanFormParam } from "./postman-types";
import { isRecord, primaryType, resolveSchema, type SchemaComponents } from "./schema-refs";

export type RequestBodyParts = {
  body: PostmanBody;
  /** Set when the request needs an explicit `Content-Type` header; Postman adds the form ones itself. */
  contentType?: string;
};

const MULTIPART = "multipart/form-data";
const URL_ENCODED = "application/x-www-form-urlencoded";

function isJsonContentType(contentType: string): boolean {
  return contentType === "application/json" || contentType.endsWith("+json");
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return isRecord(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
}

function isFileSchema(schema: OpenApiSchema, components: SchemaComponents): boolean {
  const resolved = resolveSchema(schema, components);

  if (resolved.format === "binary" || typeof resolved.contentMediaType === "string") {
    return true;
  }

  return primaryType(resolved) === "array" && isRecord(resolved.items)
    ? isFileSchema(resolved.items, components)
    : false;
}

function formFields(schema: OpenApiSchema, components: SchemaComponents): PostmanFormParam[] {
  const resolved = resolveSchema(schema, components);
  const properties = isRecord(resolved.properties) ? resolved.properties : {};

  return Object.entries(properties).flatMap(([key, property]): PostmanFormParam[] => {
    if (!isRecord(property)) {
      return [];
    }

    const description = typeof property.description === "string" ? { description: property.description } : {};

    if (isFileSchema(property, components)) {
      return [{ key, type: "file", src: [], ...description }];
    }

    return [{ key, value: stringifyValue(exampleFromSchema(property, components)), type: "text", ...description }];
  });
}

function pickContentType(contentTypes: string[]): string | undefined {
  return (
    contentTypes.find(isJsonContentType) ??
    contentTypes.find((contentType) => contentType === MULTIPART) ??
    contentTypes.find((contentType) => contentType === URL_ENCODED) ??
    contentTypes[0]
  );
}

/**
 * The Postman body of an operation's request body: JSON becomes a raw JSON example, multipart
 * becomes `formdata` (binary properties as file rows), url-encoded becomes `urlencoded`.
 *
 * @returns `undefined` when the operation has no usable body.
 */
export function buildRequestBody(
  requestBody: OpenApiRequestBody | undefined,
  components: SchemaComponents,
): RequestBodyParts | undefined {
  if (!requestBody) {
    return undefined;
  }

  const contentType = pickContentType(Object.keys(requestBody.content));
  const schema = contentType !== undefined ? requestBody.content[contentType]?.schema : undefined;

  if (contentType === undefined || schema === undefined) {
    return undefined;
  }

  if (contentType === MULTIPART) {
    return { body: { mode: "formdata", formdata: formFields(schema, components) } };
  }

  if (contentType === URL_ENCODED) {
    const urlencoded = formFields(schema, components).flatMap((field) =>
      field.type === "text" ? [{ key: field.key, value: field.value, type: "text" as const }] : [],
    );

    return { body: { mode: "urlencoded", urlencoded } };
  }

  const example = exampleFromSchema(schema, components);

  if (isJsonContentType(contentType)) {
    return {
      contentType,
      body: {
        mode: "raw",
        raw: JSON.stringify(example, null, 2),
        options: { raw: { language: "json" } },
      },
    };
  }

  return {
    contentType,
    body: {
      mode: "raw",
      raw: typeof example === "string" ? example : "",
      options: { raw: { language: "text" } },
    },
  };
}
