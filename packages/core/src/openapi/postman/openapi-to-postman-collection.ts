import type { OpenApiDocument, OpenApiOperation } from "../types";
import { buildRequestBody } from "./build-request-body";
import { buildHeaderParameters, buildRequestUrl } from "./build-request-url";
import { buildSavedResponses } from "./build-saved-responses";
import type {
  PostmanCollection,
  PostmanCollectionOptions,
  PostmanFolder,
  PostmanHeader,
  PostmanItem,
  PostmanRequestItem,
} from "./postman-types";
import { collectionBearerAuth, hasBearerScheme, resolveOperationAuth } from "./resolve-operation-auth";
import { uuidV5 } from "./uuid-v5";

/** `info.schema` of every collection this converter produces. */
export const POSTMAN_COLLECTION_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

/** `{{baseUrl}}` when neither the options nor the document name a server. */
export const DEFAULT_POSTMAN_BASE_URL = "http://localhost:3000";

const OPERATION_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function buildRequestItem(
  path: string,
  method: string,
  operation: OpenApiOperation,
  document: OpenApiDocument,
): PostmanRequestItem {
  const components = document.components?.schemas;
  const parameters = operation.parameters ?? [];
  const body = buildRequestBody(operation.requestBody, components);
  const { auth, note } = resolveOperationAuth(operation, document.components);
  const description = [operation.description, note].filter((line): line is string => Boolean(line)).join("\n\n");

  const header: PostmanHeader[] = [
    ...(body?.contentType ? [{ key: "Content-Type", value: body.contentType, type: "text" as const }] : []),
    ...buildHeaderParameters(parameters, components),
  ];

  const originalRequest = {
    method: method.toUpperCase(),
    header,
    ...(body ? { body: body.body } : {}),
    url: buildRequestUrl(path, parameters, components),
  };

  return {
    name: operation.summary ?? operation.operationId,
    request: {
      ...originalRequest,
      ...(auth ? { auth } : {}),
      ...(description ? { description } : {}),
    },
    response: buildSavedResponses(operation.responses, originalRequest, components),
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Convert an OpenAPI document into a Postman Collection v2.1.0 object.
 *
 * Pure and deterministic (the collection id is a UUIDv5 of the title), derived only from the
 * document so the collection can never disagree with the OpenAPI output. Each tag becomes a
 * folder in order of first appearance and untagged operations stay at the root; each
 * operation becomes a request with example bodies generated from its schemas and a saved
 * response per declared status. `{{baseUrl}}` and `{{token}}` are collection variables; a
 * bearer scheme becomes collection-level bearer auth and public operations opt out of it.
 */
export function openApiToPostmanCollection(
  document: OpenApiDocument,
  options: PostmanCollectionOptions = {},
): PostmanCollection {
  const name = options.title ?? document.info.title;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? document.servers?.[0]?.url ?? DEFAULT_POSTMAN_BASE_URL);
  const root: PostmanItem[] = [];
  const folders = new Map<string, PostmanFolder>();

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!OPERATION_METHODS.includes(method)) {
        continue;
      }

      const item = buildRequestItem(path, method, operation, document);
      const tag = operation.tags?.[0];

      if (tag === undefined) {
        root.push(item);

        continue;
      }

      let folder = folders.get(tag);

      if (!folder) {
        folder = { name: tag, item: [] };
        folders.set(tag, folder);
        root.push(folder);
      }

      folder.item.push(item);
    }
  }

  return {
    info: {
      _postman_id: uuidV5(name),
      name,
      ...(document.info.description ? { description: document.info.description } : {}),
      schema: POSTMAN_COLLECTION_SCHEMA,
    },
    item: root,
    ...(hasBearerScheme(document.components) ? { auth: collectionBearerAuth() } : {}),
    variable: [
      { key: "baseUrl", value: baseUrl, type: "string" },
      { key: "token", value: "", type: "string" },
    ],
  };
}
