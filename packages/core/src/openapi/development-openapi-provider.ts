import type { OpenApiBuildResult } from "./types";

type DevelopmentOpenApiProvider = () => Promise<OpenApiBuildResult>;

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
