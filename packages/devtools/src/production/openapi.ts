import { readFile } from "node:fs/promises";

type Core = typeof import("@warlock.js/core");

/**
 * The API tab's documents under `warlock start`. Only `warlock dev` registers
 * core's development provider, so production builds the OpenAPI document
 * itself from the routes this process registered, with core's own builder.
 * Resource schemas keep generic names (`Resource1`, …) because production has
 * no source files to read their export names from. Built once per process: the
 * routes do not change after boot; a failed build is tried again next time.
 */
export function createProductionOpenApi(
  core: Pick<Core, "router" | "buildOpenApiDocument" | "openApiToPostmanCollection" | "config" | "rootPath">,
): { getOpenApiDocument: () => Promise<object>; getPostmanCollection: () => Promise<object> } {
  let built: Promise<object> | undefined;

  const build = async (): Promise<object> => {
    const pkg = await readAppPackage(core.rootPath("package.json"));
    const baseUrl: unknown = core.config.get("app.baseUrl");
    const { document } = core.buildOpenApiDocument(core.router.list(), {
      info: {
        title: typeof pkg.name === "string" && pkg.name ? pkg.name : "Warlock API",
        version: typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0",
        ...(typeof pkg.description === "string" && pkg.description
          ? { description: pkg.description }
          : {}),
      },
      ...(typeof baseUrl === "string" && baseUrl ? { servers: [baseUrl] } : {}),
      validationResponse: core.config.get("validation.response", {}),
    });

    return document;
  };

  const getOpenApiDocument = (): Promise<object> => {
    const current = built ?? build();

    built = current;
    current.catch(() => {
      if (built === current) built = undefined;
    });

    return current;
  };

  return {
    getOpenApiDocument,
    getPostmanCollection: async () =>
      core.openApiToPostmanCollection(
        (await getOpenApiDocument()) as Parameters<Core["openApiToPostmanCollection"]>[0],
      ),
  };
}

async function readAppPackage(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));

    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
