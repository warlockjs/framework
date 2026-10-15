import { pathToFileURL } from "node:url";
import { importAppModule } from "../loader/app-module-importer";
import {
  buildResourceMap,
  createResourceTypeResolver,
  describeResponseSchemaTypes,
  type ResourceModuleExport,
  type ResourceModuleNamespace,
  type ResourceTypeResolver,
} from "./response-schema-types";
import { router } from "./router";
import type { NamedApiRoute } from "./types";

const RESOURCE_FILE_PATTERN = /(^|\/)src\/.*\.resource\.tsx?$/;

export type ResourceSourceFile = Readonly<{
  absolutePath: string;
  relativePath: string;
}>;

export type NamedApiRoutesWithResponsesOptions = Readonly<{
  /**
   * Application root, the folder that contains `.warlock/typings/`.
   */
  appRoot: string;
  /**
   * Every file the orchestrator knows about. `*.resource.ts(x)` files under `src/` are
   * imported to map resource classes back to their exports.
   */
  files: Iterable<ResourceSourceFile>;
  /**
   * Receives a human readable warning (unmapped resource, unreadable resource module).
   */
  onWarn?: (message: string) => void;
}>;

function isResourceFile(file: ResourceSourceFile): boolean {
  return RESOURCE_FILE_PATTERN.test(file.relativePath.replace(/\\/g, "/"));
}

async function importResourceNamespaces(
  files: readonly ResourceSourceFile[],
  onWarn: ((message: string) => void) | undefined,
): Promise<ResourceModuleNamespace[]> {
  const namespaces: ResourceModuleNamespace[] = [];

  for (const file of files) {
    try {
      const namespace = (await importAppModule(pathToFileURL(file.absolutePath).href)) as Record<
        string,
        unknown
      >;

      namespaces.push({ file: file.absolutePath, namespace });
    } catch (error) {
      onWarn?.(
        `Could not import ${file.relativePath} to type API responses: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return namespaces;
}

/**
 * Identity map from every resource class exported by a `*.resource.ts(x)` file under
 * `src/` to the module export it came from.
 *
 * The modules are imported through the same importer the routes used, so a resource class
 * found in a `responseSchema` is the very instance exported by its module. A module that
 * cannot be imported is reported once through `onWarn` and left out of the map.
 */
export async function collectResourceExportMap(
  files: Iterable<ResourceSourceFile>,
  onWarn?: (message: string) => void,
): Promise<Map<unknown, ResourceModuleExport>> {
  const namespaces = await importResourceNamespaces([...files].filter(isResourceFile), onWarn);

  return buildResourceMap(namespaces);
}

/**
 * Named API route snapshots, with a `response` type map on every route whose handler
 * declares `responseSchema`.
 *
 * Resource modules are imported only when at least one route declares a schema, through
 * the same importer the routes used, so a resource class seen in a schema is the very
 * instance exported by its module. Never throws: if anything fails the routes come back
 * without `response` (and the failure is reported once through `onWarn`).
 */
export async function collectNamedApiRoutesWithResponses(
  options: NamedApiRoutesWithResponsesOptions,
): Promise<readonly NamedApiRoute[]> {
  try {
    const declaresSchema = router.list().some((route) => route.handler?.responseSchema);

    if (!declaresSchema) return router.getNamedApiRoutes();

    const resolveResource: ResourceTypeResolver = createResourceTypeResolver(
      await collectResourceExportMap(options.files, options.onWarn),
      options.appRoot,
    );

    return router.getNamedApiRoutes({
      resolveResponse: (schema, route) =>
        describeResponseSchemaTypes(schema, resolveResource, (fieldPath) => {
          options.onWarn?.(
            `Route "${route.name}" (${route.method} ${route.path}): response ${fieldPath} is a resource that is not exported from a *.resource.ts file, typed as unknown.`,
          );
        }),
    });
  } catch (error) {
    options.onWarn?.(
      `Could not type API responses: ${error instanceof Error ? error.message : String(error)}`,
    );

    return router.getNamedApiRoutes();
  }
}
