import config from "@mongez/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { httpConfig } from "../http/config";
import {
  collectResourceExportMap,
  type ResourceSourceFile,
} from "../router/named-api-routes-with-responses";
import { router } from "../router/router";
import { buildOpenApiDocument } from "./build-openapi-document";
import type { OpenApiChildRequestOptions } from "./openapi-protocol";
import type { OpenApiBuildResult, OpenApiValidationResponseConfig } from "./types";

export type BuildOpenApiForChildOptions = Readonly<{
  /** Application root (the child's cwd). */
  cwd: string;
  /** Every source file the orchestrator knows; `*.resource.ts(x)` ones are mapped to exports. */
  files: Iterable<ResourceSourceFile>;
  request: OpenApiChildRequestOptions;
  onWarn?: (message: string) => void;
}>;

type AppPackage = { name?: unknown; version?: unknown; description?: unknown };

async function readAppPackage(cwd: string): Promise<AppPackage> {
  try {
    return JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")) as AppPackage;
  } catch {
    return {};
  }
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * `http://<host>:<port>` from the `http` config. A wildcard bind address is not a place a
 * client can call, so it becomes `localhost`.
 */
export function resolveDefaultServer(): string {
  const host = stringOr(httpConfig("host"), "localhost");
  const port = httpConfig("port");
  const callable = host === "0.0.0.0" || host === "::" ? "localhost" : host;

  return `http://${callable}${typeof port === "number" || typeof port === "string" ? `:${port}` : ""}`;
}

/**
 * Build the OpenAPI document from the routes registered in THIS process.
 *
 * Runs inside the registration child, after the app's route modules are loaded and config is
 * available. Maps resource classes to their export names, reads `info` from the app
 * `package.json`, the server from the `http` config and the 422 shape from
 * `validation.response`.
 */
export async function buildOpenApiForChild(
  options: BuildOpenApiForChildOptions,
): Promise<OpenApiBuildResult> {
  const routes = router.list();
  const declaresSchema = routes.some((route) => route.handler?.responseSchema);
  const resourceMap = declaresSchema
    ? await collectResourceExportMap(options.files, options.onWarn)
    : undefined;
  const pkg = await readAppPackage(options.cwd);
  const validationResponse = config.get(
    "validation.response",
    {},
  ) as OpenApiValidationResponseConfig;

  return buildOpenApiDocument(routes, {
    info: {
      title: options.request.title ?? stringOr(pkg.name, "Warlock API"),
      version: stringOr(pkg.version, "0.0.0"),
      ...(typeof pkg.description === "string" && pkg.description
        ? { description: pkg.description }
        : {}),
    },
    servers: [options.request.server ?? resolveDefaultServer()],
    includePages: options.request.includePages === true,
    resolveResourceName: (resource) => resourceMap?.get(resource)?.exportName,
    validationResponse,
  });
}
