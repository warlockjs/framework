import { openApiToPostmanCollection } from "./postman/openapi-to-postman-collection";
import type { PostmanCollection, PostmanCollectionOptions } from "./postman/postman-types";
import type { OpenApiBuildResult } from "./types";

type DevelopmentOpenApiProvider = () => Promise<OpenApiBuildResult>;

export type DevelopmentPostmanResult = {
  collection: PostmanCollection;
  warnings: string[];
};

let provider: DevelopmentOpenApiProvider | undefined;

/**
 * Called by the dev server at startup. The builder lives under `dev-server/`, so the
 * production entry never reaches it; this registry is the only thing the root exports.
 */
export function registerDevelopmentOpenApiProvider(build: DevelopmentOpenApiProvider): void {
  provider = build;
}

/**
 * The OpenAPI document for the routes registered in this process, built by the dev
 * server's provider. Throws outside `warlock dev`, where no provider is registered.
 */
export async function getDevelopmentOpenApiDocument(): Promise<OpenApiBuildResult> {
  if (!provider) {
    throw new Error(
      "No development OpenAPI provider is registered; the API docs are only available under `warlock dev`.",
    );
  }

  return provider();
}

/**
 * The Postman collection (v2.1.0) for the routes registered in this process: the development
 * OpenAPI document run through `openApiToPostmanCollection`, so both always agree. Throws
 * outside `warlock dev`, like `getDevelopmentOpenApiDocument`.
 */
export async function getDevelopmentPostmanCollection(
  options: PostmanCollectionOptions = {},
): Promise<DevelopmentPostmanResult> {
  const { document, warnings } = await getDevelopmentOpenApiDocument();

  return { collection: openApiToPostmanCollection(document, options), warnings };
}
