import { colors } from "@mongez/copper";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CommandActionData } from "../../../../commands/types";
import {
  fileExistsAsync,
  getFileAsync,
  putFileAsync as putEditedFileAsync,
} from "../../../../generations/generation-fs";
import { recordSkippedFile, setGenerationDetail } from "../../../../generations/generation-run";
import { importAppModule } from "../../../../loader/app-module-importer";
import { appPath, srcPath } from "../../../../utils";
import {
  type EndpointAccess,
  type EndpointMethod,
  type EndpointSpec,
  endpointControllerStub,
  endpointLabel,
  endpointLocaleEntries,
  endpointResourceStub,
  endpointRouteImports,
  endpointRouteRegistration,
  endpointRoutesFileStub,
  endpointSchemaStub,
  endpointServiceStub,
  endpointTestStub,
} from "../templates/endpoint-stubs";
import { readEndpointFields } from "../utils/endpoint-schema";
import { parseModulePath, parseName, singularName } from "../utils/name-parser";
import { isDryRun, putFileAsync, setDryRun } from "../utils/writer";

const METHODS: readonly EndpointMethod[] = ["get", "post", "put", "patch", "delete"];

const USAGE =
  "Usage: warlock make endpoint <module>/<name> [--method post] [--path /posts] [--schema ./schema.ts] [--resource Post] [--auth | --public]";

/** Loads the `--schema` file and returns its exports. Replaceable in tests. */
export type SchemaModuleLoader = (absolutePath: string) => Promise<Record<string, unknown>>;

/**
 * Import an app TypeScript file from the CLI: register the framework's
 * loader (path aliases, TypeScript) first, as `warlock dev` does.
 */
const loadSchemaModuleWithAppLoader: SchemaModuleLoader = async (absolutePath) => {
  const { filesOrchestrator } = await import("../../../../dev-server/files-orchestrator");
  const { warlockConfigManager } =
    await import("../../../../warlock-config/warlock-config.manager");

  await warlockConfigManager.load();
  await filesOrchestrator.init();

  return (await importAppModule(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
};

/** A seal object validator, recognised structurally so a second seal copy still counts. */
type SchemaLike = { toJsonSchema(target?: string): unknown; schema: unknown };

function isSchemaLike(value: unknown): value is SchemaLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "toJsonSchema" in value &&
    typeof value.toJsonSchema === "function" &&
    "schema" in value &&
    typeof value.schema === "object"
  );
}

class EndpointInputError extends Error {}

function fail(message: string): never {
  throw new EndpointInputError(message);
}

/** Pick the request schema out of the `--schema` module's exports. */
export function pickSchemaExport(
  exports: Record<string, unknown>,
  preferredName: string,
): { exportName: string; schema: SchemaLike } {
  const preferred = exports[preferredName];

  if (isSchemaLike(preferred)) return { exportName: preferredName, schema: preferred };

  const candidates = Object.entries(exports).filter(
    (entry): entry is [string, SchemaLike] => entry[0] !== "default" && isSchemaLike(entry[1]),
  );

  if (candidates.length === 1 && candidates[0]) {
    return { exportName: candidates[0][0], schema: candidates[0][1] };
  }

  const fallback = exports.default;

  if (candidates.length === 0 && isSchemaLike(fallback)) {
    return { exportName: "default", schema: fallback };
  }

  const names = candidates.map(([name]) => name);

  return fail(
    names.length === 0
      ? `The schema file exports no seal object schema (v.object(...)). Export one, e.g. \`export const ${preferredName} = v.object({ ... })\`.`
      : `The schema file exports several object schemas (${names.join(", ")}). Name the one for this endpoint \`${preferredName}\`.`,
  );
}

/**
 * The `schema/<name>.schema.ts` content for a `--schema` file.
 *
 * A file already under `src/` is imported where it lives (one source of
 * truth). A file outside `src/` — a scratch spec — is copied in, with its
 * relative imports re-pointed at the new location. Either way the module
 * exports `<name>Schema` and its `<Name>Schema` type, the names the
 * controller and service import.
 */
export function schemaModuleFromFile(options: {
  sourcePath: string;
  source: string;
  exportName: string;
  targetPath: string;
  valueName: string;
  typeName: string;
}): string {
  const { sourcePath, source, exportName, targetPath, valueName, typeName } = options;
  const targetDirectory = path.dirname(targetPath);

  if (isInside(srcPath(), sourcePath)) {
    const specifier = toImportSpecifier(targetDirectory, sourcePath);
    const header = `import type { Infer } from "@warlock.js/seal";`;
    const footer = `export type ${typeName} = Infer<typeof ${valueName}>;\n`;

    if (exportName === valueName) {
      return `${header}\nimport { ${valueName} } from "${specifier}";\n\nexport { ${valueName} };\n\n${footer}`;
    }

    const local = exportName === "default" ? "source" : exportName;
    const importLine =
      exportName === "default"
        ? `import source from "${specifier}";`
        : `import { ${exportName} } from "${specifier}";`;

    return `${header}\n${importLine}\n\nexport const ${valueName} = ${local};\n\n${footer}`;
  }

  let content = source.replace(
    /(from\s+|import\s*\(\s*|import\s+)(["'])(\.{1,2}\/[^"']+)\2/g,
    (_match, prefix: string, quote: string, specifier: string) => {
      const resolved = path.resolve(path.dirname(sourcePath), specifier);

      return `${prefix}${quote}${toImportSpecifier(targetDirectory, resolved)}${quote}`;
    },
  );

  if (exportName === "default") {
    content = content.replace(/export\s+default\s+/, `export const ${valueName} = `);
  } else if (exportName !== valueName) {
    content = `${content.trimEnd()}\n\nexport const ${valueName} = ${exportName};\n`;
  }

  const hasType = new RegExp(`export\\s+type\\s+${typeName}\\b`).test(content);

  if (!hasType) {
    const importsInfer = /\bInfer\b/.test(
      content
        .split("\n")
        .filter((line) => line.startsWith("import"))
        .join("\n"),
    );

    if (!importsInfer) content = `import type { Infer } from "@warlock.js/seal";\n${content}`;

    content = `${content.trimEnd()}\n\nexport type ${typeName} = Infer<typeof ${valueName}>;\n`;
  }

  return content;
}

function isInside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);

  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** A relative, extensionless, `/`-separated import specifier from `fromDirectory` to `file`. */
function toImportSpecifier(fromDirectory: string, file: string): string {
  const withoutExtension = file.replace(/\.(?:ts|tsx|mts|js|mjs)$/, "");
  const relative = path.relative(fromDirectory, withoutExtension).split(path.sep).join("/");

  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** Parse and check the command input. Throws {@link EndpointInputError} with a fix. */
export function readEndpointInput(data: CommandActionData): {
  module: string;
  name: string;
  method: EndpointMethod;
  path: string;
  access: EndpointAccess;
  resource: string;
  schemaFile?: string;
  force: boolean;
} {
  const input = data.args[0];

  if (!input) fail(`Endpoint name is required.\n${USAGE}`);

  const { module, name } = parseModulePath(input);

  if (!module || !name)
    fail(`Write the endpoint as <module>/<name>, e.g. posts/create-post.\n${USAGE}`);

  const moduleName = parseName(module).kebab;
  const rawMethod = String(data.options.method ?? "post").toLowerCase();
  const method = METHODS.find((candidate) => candidate === rawMethod);

  if (!method) fail(`Unknown --method "${rawMethod}". Use one of: ${METHODS.join(", ")}.`);

  const wantsAuth = data.options.auth === true;
  const wantsPublic = data.options.public === true;

  if (wantsAuth && wantsPublic) fail("Pass either --auth or --public, not both.");

  const rawPath = typeof data.options.path === "string" ? data.options.path : undefined;
  const defaultPath =
    method === "get" || method === "post" ? `/${moduleName}` : `/${moduleName}/:id`;
  const routePath = rawPath ? (rawPath.startsWith("/") ? rawPath : `/${rawPath}`) : defaultPath;
  const resource =
    typeof data.options.resource === "string" && data.options.resource.trim() !== ""
      ? data.options.resource.trim()
      : singularName(moduleName).pascal;
  const schemaFile =
    typeof data.options.schema === "string" && data.options.schema.trim() !== ""
      ? data.options.schema.trim()
      : undefined;

  return {
    module: moduleName,
    name,
    method,
    path: routePath,
    // Guarded unless the caller says, in so many words, that it is public.
    access: wantsPublic ? "public" : "guarded",
    resource,
    schemaFile,
    force: data.options.force === true || data.options.f === true,
  };
}

/**
 * Write a whole generated file unless it exists. Without `--force` an
 * existing file is the app's own code: it is skipped and reported, never
 * overwritten.
 */
async function writeNewFile(target: string, content: string, force: boolean): Promise<void> {
  if (!force && (await fileExistsAsync(target))) {
    recordSkippedFile(target, "exists (pass --force to overwrite)");
    console.log(`${colors.yellow("-")} skipped ${colors.gray(displayPath(target))} (exists)`);
    return;
  }

  await putFileAsync(target, content);
}

function displayPath(target: string): string {
  return path.relative(process.cwd(), target).split(path.sep).join("/");
}

/** Append the endpoint to the module's `routes.ts`, creating the file if needed. */
async function registerRoute(spec: EndpointSpec, routesPath: string): Promise<void> {
  if (!existsSync(routesPath)) {
    await putEditedFileAsync(routesPath, endpointRoutesFileStub(spec));
    logEdit(routesPath, "created");
    return;
  }

  const current = await getFileAsync(routesPath);
  const controller = `${spec.name.camel}Controller`;

  if (new RegExp(`\\b${controller}\\b`).test(current)) {
    recordSkippedFile(routesPath, `${controller} is already registered`);
    console.log(
      `${colors.yellow("-")} skipped ${colors.gray(displayPath(routesPath))} (${controller} is already registered)`,
    );
    return;
  }

  const imports = [...endpointRouteImports(spec)];

  if (!/import\s*\{[^}]*\brouter\b[^}]*\}\s*from\s*["']@warlock\.js\/core["']/.test(current)) {
    imports.unshift(`import { router } from "@warlock.js/core";`);
  }

  if (spec.access === "guarded" && !/\bguarded\b/.test(current)) {
    imports.unshift(`import { guarded } from "app/shared/utils/router";`);
  }

  const lines = current.split("\n");
  let lastImport = -1;
  let inImport = false;

  // An import may span lines; new imports go after the last statement ends.
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";

    if (/^import\s/.test(line)) inImport = true;

    if (inImport && (/;\s*$/.test(line) || /from\s+["'][^"']+["']\s*$/.test(line))) {
      lastImport = index;
      inImport = false;
    }
  }

  lines.splice(lastImport + 1, 0, ...imports);

  const updated = `${lines.join("\n").trimEnd()}\n\n${endpointRouteRegistration(spec)}`;

  await putEditedFileAsync(routesPath, updated);
  logEdit(routesPath, "updated");
}

/** Merge the endpoint's message into `utils/locales.json`; existing keys win. */
async function registerLocales(spec: EndpointSpec, localesPath: string): Promise<void> {
  const entries = endpointLocaleEntries(spec);

  if (!existsSync(localesPath)) {
    await putEditedFileAsync(localesPath, `${JSON.stringify(entries, null, 2)}\n`);
    logEdit(localesPath, "created");
    return;
  }

  let dictionary: Record<string, unknown>;

  try {
    const parsed: unknown = JSON.parse(await getFileAsync(localesPath));

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();

    dictionary = parsed as Record<string, unknown>;
  } catch {
    recordSkippedFile(localesPath, "not a JSON object; add the message key by hand");
    console.log(
      colors.yellow(
        `! ${displayPath(localesPath)} is not a JSON object; add ${Object.keys(entries).join(", ")} by hand.`,
      ),
    );
    return;
  }

  if (dictionary.$group !== undefined && dictionary.$group !== spec.module) {
    recordSkippedFile(localesPath, `declares $group "${String(dictionary.$group)}"`);
    console.log(
      colors.yellow(
        `! ${displayPath(localesPath)} declares another $group; add ${spec.module}.${Object.keys(entries).join(", ")} by hand.`,
      ),
    );
    return;
  }

  const missing = Object.keys(entries).filter((key) => dictionary[key] === undefined);

  if (missing.length === 0) {
    recordSkippedFile(localesPath, "message key already present");
    return;
  }

  for (const key of missing) dictionary[key] = entries[key];

  await putEditedFileAsync(localesPath, `${JSON.stringify(dictionary, null, 2)}\n`);
  logEdit(localesPath, "updated");
}

function logEdit(target: string, verb: "created" | "updated"): void {
  const prefix = isDryRun()
    ? `${colors.cyan("○")} would ${verb === "created" ? "create" : "update"}`
    : `${colors.green("✓")} ${verb}`;

  console.log(`${prefix} ${colors.gray(displayPath(target))}`);
}

/**
 * `warlock make endpoint <module>/<name>` — a spec-first endpoint.
 *
 * Writes, under `src/app/<module>/`: the request schema (from `--schema` or a
 * stub), a service, the resource (unless it exists), one controller with its
 * validation and OpenAPI `responseSchema`, the route (guarded, or
 * `public: true` with `--public`), the success message in `utils/locales.json`,
 * and `tests/<name>.test.ts`, which requests the endpoint over the real HTTP
 * stack. Existing files are skipped and reported unless `--force`.
 */
export function createEndpointGenerator(
  loadSchemaModule: SchemaModuleLoader = loadSchemaModuleWithAppLoader,
): (data: CommandActionData) => Promise<void> {
  return async (data) => {
    let input: ReturnType<typeof readEndpointInput>;

    try {
      input = readEndpointInput(data);
    } catch (error) {
      if (!(error instanceof EndpointInputError)) throw error;

      console.log(colors.red(`Error: ${error.message}`));
      process.exit(1);
    }

    setDryRun(data.options.dryRun === true);

    const name = parseName(input.name);
    const modulePath = appPath(input.module);
    const schemaPath = path.join(modulePath, "schema", `${name.kebab}.schema.ts`);
    const valueName = `${name.camel}Schema`;
    const typeName = `${name.pascal}Schema`;

    let jsonSchema: unknown;
    let schemaContent: string | undefined;

    if (input.schemaFile) {
      const sourcePath = path.resolve(process.cwd(), input.schemaFile);

      if (!existsSync(sourcePath)) {
        console.log(colors.red(`Error: Schema file not found: ${input.schemaFile}`));
        process.exit(1);
      }

      let exports: Record<string, unknown>;

      try {
        exports = await loadSchemaModule(sourcePath);
      } catch (error) {
        console.log(
          colors.red(
            `Error: Could not load ${input.schemaFile} to read its fields: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exit(1);
      }

      let picked: ReturnType<typeof pickSchemaExport>;

      try {
        picked = pickSchemaExport(exports, valueName);
      } catch (error) {
        console.log(colors.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }

      jsonSchema = picked.schema.toJsonSchema("draft-2020-12");

      if (path.resolve(sourcePath) !== path.resolve(schemaPath)) {
        schemaContent = schemaModuleFromFile({
          sourcePath,
          source: readFileSync(sourcePath, "utf8"),
          exportName: picked.exportName,
          targetPath: schemaPath,
          valueName,
          typeName,
        });
      }
    }

    const spec: EndpointSpec = {
      module: input.module,
      name,
      method: input.method,
      path: input.path,
      access: input.access,
      resource: parseName(input.resource),
      fields: readEndpointFields(jsonSchema),
    };

    const resourcePath = path.join(
      modulePath,
      "resources",
      `${spec.resource.singular.kebab}.resource.ts`,
    );
    const testPath = path.join(modulePath, "tests", `${name.kebab}.test.ts`);

    setGenerationDetail("endpoint", {
      method: spec.method.toUpperCase(),
      path: spec.path,
      access: spec.access,
      controller: `${name.camel}Controller`,
      resource: `${spec.resource.pascal}Resource`,
      fields: spec.fields.map((field) => field.name),
      test: displayPath(testPath),
    });

    console.log(colors.cyan(`\nGenerating ${endpointLabel(spec)} in src/app/${spec.module}\n`));

    if (input.schemaFile === undefined) {
      await writeNewFile(schemaPath, endpointSchemaStub(spec), input.force);
    } else if (schemaContent !== undefined) {
      await writeNewFile(schemaPath, schemaContent, input.force);
    }

    await writeNewFile(
      path.join(modulePath, "services", `${name.kebab}.service.ts`),
      endpointServiceStub(spec),
      input.force,
    );
    await writeNewFile(resourcePath, endpointResourceStub(spec), input.force);
    await writeNewFile(
      path.join(modulePath, "controllers", `${name.kebab}.controller.ts`),
      endpointControllerStub(spec),
      input.force,
    );
    await registerRoute(spec, path.join(modulePath, "routes.ts"));
    await registerLocales(spec, path.join(modulePath, "utils", "locales.json"));
    await writeNewFile(testPath, endpointTestStub(spec), input.force);

    console.log(
      colors.cyan(
        `\n${endpointLabel(spec)} ${isDryRun() ? "previewed" : "generated"} (${spec.access === "public" ? "public: true" : "guarded"}).`,
      ),
    );
    console.log(
      colors.gray(
        `Next: fill in services/${name.kebab}.service.ts, then run the test with \`warlock test --related ${displayPath(testPath)}\`.`,
      ),
    );
  };
}

export const generateEndpoint = createEndpointGenerator();
