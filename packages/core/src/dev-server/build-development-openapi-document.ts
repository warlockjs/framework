import type { OpenApiBuildResult } from "../openapi/types";

const warned = new Set<string>();

/**
 * Build the OpenAPI document from the routes registered in THIS process, for the dev server.
 *
 * `warlock dev` has already loaded every route module, so no child process is needed: this
 * runs the same `buildOpenApiForChild` the `generate.openapi` child runs (same resource
 * export map, `package.json` info, `http` server and `validation.response` config), with the
 * dev server's file list. Each distinct warning is logged once per process, not on every
 * request to the docs page.
 *
 * Lives under `dev-server/`, off the production entry: the dev server registers it as the
 * development OpenAPI provider (`registerDevelopmentOpenApiProvider`), and devtools reads it
 * through `getDevelopmentOpenApiDocument()` from the root barrel.
 */
export async function buildDevelopmentOpenApiDocument(): Promise<OpenApiBuildResult> {
  const [{ filesOrchestrator }, { devLogWarn }, { buildOpenApiForChild }] = await Promise.all([
    import("./files-orchestrator"),
    import("./dev-logger"),
    import("../openapi/openapi-child-output"),
  ]);

  return buildOpenApiForChild({
    cwd: process.cwd(),
    files: filesOrchestrator.getFiles().values(),
    request: { version: 1 },
    onWarn: (message) => {
      if (warned.has(message)) return;

      warned.add(message);
      devLogWarn(message);
    },
  });
}
