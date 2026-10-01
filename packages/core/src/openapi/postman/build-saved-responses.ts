import type { OpenApiOperation } from "../types";
import { exampleFromSchema } from "./example-from-schema";
import { httpStatusText } from "./http-status-text";
import type { PostmanHeader, PostmanOriginalRequest, PostmanResponse } from "./postman-types";
import type { SchemaComponents } from "./schema-refs";

type PreviewLanguage = PostmanResponse["_postman_previewlanguage"];

function previewLanguage(contentType: string): PreviewLanguage {
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    return "json";
  }

  return contentType === "text/html" ? "html" : "text";
}

function stringExample(example: unknown): string {
  return typeof example === "string" ? example : "";
}

function responseBody(
  content: NonNullable<OpenApiOperation["responses"][string]["content"]>,
  components: SchemaComponents,
): { body: string; header: PostmanHeader[]; language: PreviewLanguage } {
  const contentTypes = Object.keys(content);
  const contentType = contentTypes.find((type) => previewLanguage(type) === "json") ?? contentTypes[0];
  const schema = contentType !== undefined ? content[contentType]?.schema : undefined;

  if (contentType === undefined || schema === undefined) {
    return { body: "", header: [], language: "text" };
  }

  const language = previewLanguage(contentType);
  const example = exampleFromSchema(schema, components);
  const body = language === "json" ? JSON.stringify(example, null, 2) : stringExample(example);

  return { body, header: [{ key: "Content-Type", value: contentType, type: "text" }], language };
}

/**
 * One saved Postman response per declared numeric status, with an example body from the
 * response schema. `default` and range keys (`2XX`) have no single status code and are skipped.
 */
export function buildSavedResponses(
  responses: OpenApiOperation["responses"],
  originalRequest: PostmanOriginalRequest,
  components: SchemaComponents,
): PostmanResponse[] {
  return Object.entries(responses).flatMap(([status, response]): PostmanResponse[] => {
    if (!/^\d{3}$/.test(status)) {
      return [];
    }

    const code = Number(status);
    const { body, header, language } = response.content
      ? responseBody(response.content, components)
      : { body: "", header: [], language: "text" as const };

    return [
      {
        name: `${status} ${response.description}`,
        originalRequest,
        status: httpStatusText(code, response.description),
        code,
        _postman_previewlanguage: language,
        header,
        body,
      },
    ];
  });
}
