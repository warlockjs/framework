import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import * as ast from "../../../../tooling/syntax/ast";
import type { CommandActionData } from "../../../../commands/types";
import { getFileAsync, putFileAsync as editFile } from "../../../../generations/generation-fs";
import { srcPath } from "../../../../utils";
import { crudRoutesStub } from "../templates/stubs";
import {
  crudFiles,
  formFiles,
  pageFiles,
  type WebField,
  type WebFiles,
} from "../templates/web-stubs";
import { parseName, pluralName } from "../utils/name-parser";
import {
  ensureDirectoryAsync,
  putFileAsync,
  reportSkippedFiles,
  setDryRun,
  setSkipExisting,
} from "../utils/writer";
import {
  loadSchemaModuleWithAppLoader,
  pickSchemaExport,
  type SchemaModuleLoader,
} from "./endpoint.generator";

/** Refuse traversal, absolute paths and source fragments before computing output paths. */
export function webPath(input: string | undefined): string {
  if (!input || !/^[a-zA-Z][a-zA-Z0-9_-]*(\/[a-zA-Z][a-zA-Z0-9_-]*)*$/.test(input)) {
    throw new Error(
      "Use a relative name such as products or account/settings (letters, numbers, hyphens and underscores).",
    );
  }
  return input
    .split("/")
    .map((part) => parseName(part).kebab)
    .join("/");
}

async function writeFiles(
  directory: string,
  files: WebFiles,
  data: CommandActionData,
): Promise<void> {
  setDryRun(data.options.dryRun === true);
  setSkipExisting(!(data.options.force === true || data.options.f === true));
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(directory, file);
      await ensureDirectoryAsync(path.dirname(target));
      await putFileAsync(target, content);
    }
    reportSkippedFiles();
  } finally {
    setSkipExisting(false);
  }
}

export async function generatePage(data: CommandActionData): Promise<void> {
  const target = webPath(data.args[0]);
  const name = parseName(path.basename(target));
  await writeFiles(
    srcPath("web", path.dirname(target)),
    pageFiles(name, `/${target}`, data.options.interactive === true),
    data,
  );
}

/** Turn a real Seal JSON Schema into controls; unsupported shapes fail before any file is written. */
export function webFields(schema: unknown): WebField[] {
  if (
    !schema ||
    typeof schema !== "object" ||
    !("properties" in schema) ||
    !schema.properties ||
    typeof schema.properties !== "object"
  ) {
    throw new Error("Expected a Seal object schema with properties.");
  }
  return Object.entries(schema.properties).map(([name, raw]: [string, unknown]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || !raw || typeof raw !== "object") {
      throw new Error(`Unsupported form field: ${name}`);
    }
    const node = raw as {
      type?: unknown;
      format?: unknown;
      enum?: unknown;
      anyOf?: unknown;
      oneOf?: unknown;
      contentMediaType?: unknown;
      contentEncoding?: unknown;
    };
    if (
      node.enum ||
      node.anyOf ||
      node.oneOf ||
      Array.isArray(node.type) ||
      node.format === "binary" ||
      node.contentMediaType ||
      node.contentEncoding
    ) {
      throw new Error(
        `Field ${name} needs a custom control; only plain string and boolean fields can be generated.`,
      );
    }
    const formats: Record<string, string> = {
      email: "EmailInput",
      date: "DatePickerInput",
      time: "TimePickerInput",
      "date-time": "DateTimePickerInput",
    };
    const component =
      node.type === "boolean"
        ? "CheckboxInput"
        : node.type === "string"
          ? ((typeof node.format === "string" ? formats[node.format] : undefined) ??
            (/password/i.test(name) ? "PasswordInput" : "TextInput"))
          : undefined;
    if (!component) {
      throw new Error(
        `Field ${name} needs a custom control; only plain string and boolean fields can be generated.`,
      );
    }
    return { name, component };
  });
}

export async function generateForm(data: CommandActionData): Promise<void> {
  const target = webPath(data.args[0]);
  if (target.includes("/"))
    throw new Error("Use a form name and --module <name> for a module-scoped form.");
  const name = parseName(target);
  const module = typeof data.options.module === "string" ? webPath(data.options.module) : undefined;
  if (module?.includes("/")) throw new Error("The module must be a single folder name.");
  if (data.options.endpoint && !module) throw new Error("--endpoint requires --module <name>.");
  if (module && !existsSync(srcPath("app", module)))
    throw new Error(`Module ${module} does not exist. Generate the module first.`);
  const schemaImport = `shared/schema/${module ? `${module}/` : ""}${name.kebab}.schema`;
  const files = formFiles(
    name,
    schemaImport,
    `${name.camel}Schema`,
    [{ name: "name", component: "TextInput" }],
    `/${module ? `${module}/` : ""}${name.kebab}`,
  );
  const rootFiles: WebFiles = {};
  const formDirectory = `web/${module ? `${module}/` : "forms/"}`;
  for (const [file, content] of Object.entries(files))
    rootFiles[`${formDirectory}${file}`] = content;
  rootFiles[`${schemaImport}.ts`] = `import type { Infer } from "@warlock.js/seal";
import { v } from "@warlock.js/seal";

export const ${name.camel}Schema = v.object({ name: v.string().min(1) });
export type ${name.pascal}Schema = Infer<typeof ${name.camel}Schema>;
`;
  let routesPath: string | undefined;
  let routes: string | undefined;
  if (data.options.endpoint && module) {
    rootFiles[`app/${module}/controllers/${name.kebab}.controller.ts`] =
      `import type { Request, RequestHandler } from "@warlock.js/core";
import type { ${name.pascal}Schema } from "${schemaImport}";
import { ${name.camel}Schema } from "${schemaImport}";

export const ${name.camel}Controller: RequestHandler<Request<${name.pascal}Schema>> = async ({ request, response }) => {
  return response.success({ data: request.validated() });
};

${name.camel}Controller.validation = { schema: ${name.camel}Schema };
${name.camel}Controller.responseSchema = { 200: { body: { data: { name: "string" } } } };
`;
    routesPath = srcPath("app", module, "routes.ts");
    const current = existsSync(routesPath) ? await getFileAsync(routesPath) : "";
    const importLine = `import { ${name.camel}Controller } from "./controllers/${name.kebab}.controller";`;
    if (!current.includes(importLine)) {
      routes = `import { router as formRouter } from "@warlock.js/core";\nimport { guarded as guardForm } from "app/shared/utils/router";\n${importLine}\n${current.trimEnd()}\n\nguardForm(() => {\n  formRouter.post("/${module}/${name.kebab}", ${name.camel}Controller);\n});\n`;
      // Reuse aliases when several form endpoints are added to the same module.
      if (current.includes("import { router as formRouter }"))
        routes = routes.replace('import { router as formRouter } from "@warlock.js/core";\n', "");
      if (current.includes("import { guarded as guardForm }"))
        routes = routes.replace(
          'import { guarded as guardForm } from "app/shared/utils/router";\n',
          "",
        );
    }
  }
  await writeFiles(srcPath(), rootFiles, data);
  if (routesPath && routes !== undefined) await editFile(routesPath, routes);
}

/** Read inline query fields from the conventional generated list controller. */
export function listFilters(source: string, schemaName: string): string[] {
  const parsed = parseSync("controller.ts", source);
  if (parsed.errors.length) throw new Error("Cannot parse list controller.");
  let fields: string[] | undefined;
  const visit = (node: ast.Node): void => {
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.id.name === schemaName &&
      node.init?.type === "CallExpression"
    ) {
      const object = node.init.arguments[0];
      if (object?.type === "ObjectExpression") {
        fields = object.properties.map((property) => {
          if (
            property.type !== "Property" ||
            property.computed ||
            property.method ||
            property.shorthand ||
            !(
              property.key.type === "Identifier" ||
              (property.key.type === "Literal" && typeof property.key.value === "string")
            )
          )
            throw new Error("List filters require literal field names.");
          return property.key.type === "Identifier"
            ? property.key.name
            : String(property.key.value);
        });
      }
    }
    ast.forEachChild(node, visit);
  };
  visit(parsed.program);
  if (!fields)
    throw new Error(
      `Export or declare ${schemaName} as an inline Seal object schema in the list controller.`,
    );
  return fields.filter((field) => field !== "page" && field !== "limit");
}

export function createCrudUiGenerator(
  loadSchema: SchemaModuleLoader = loadSchemaModuleWithAppLoader,
) {
  return async (data: CommandActionData): Promise<void> => {
    const input = webPath(data.args[0]);
    if (input.includes("/")) throw new Error("Use a single module name.");
    const module = pluralName(input);
    const entity = module.singular;
    const directory = srcPath("app", module.kebab);
    const routesPath = path.join(directory, "routes.ts");
    if (!existsSync(routesPath))
      throw new Error("Generate a full CRUD module before generating its UI.");
    const routes = readFileSync(routesPath, "utf8");
    // Custom authorization cannot safely be inferred. Refuse rather than silently weaken it.
    const normalized = (source: string) => {
      const parsed = parseSync("routes.ts", source);
      if (parsed.errors.length)
        throw new Error("CRUD UI requires the standard guarded module routes.");
      // Compare syntax, ignoring source positions, comments and literal spelling.
      return JSON.stringify(parsed.program, (key, value: unknown) =>
        ["start", "end", "loc", "range", "raw", "comments"].includes(key) ? undefined : value,
      );
    };
    if (normalized(routes) !== normalized(crudRoutesStub(module))) {
      throw new Error(
        "CRUD UI requires the standard guarded module routes. Custom routes and guards need a hand-written UI.",
      );
    }
    const controller = readFileSync(
      path.join(directory, "controllers", `list-${module.kebab}.controller.ts`),
      "utf8",
    );
    const filters = listFilters(controller, `list${module.pascal}QuerySchema`);
    const forms: WebFiles = {};
    for (const action of ["create", "update"]) {
      const name = parseName(`${action}-${entity.kebab}`);
      const schemaName = `${name.camel}Schema`;
      const picked = pickSchemaExport(
        await loadSchema(path.join(directory, "schema", `${name.kebab}.schema.ts`)),
        schemaName,
      );
      if (picked.exportName !== schemaName) {
        throw new Error(`Export the module schema as ${schemaName} before generating its UI.`);
      }
      const fields = webFields(picked.schema.toJsonSchema("draft-2020-12"));
      Object.assign(
        forms,
        formFiles(
          name,
          `app/${module.kebab}/schema/${name.kebab}.schema`,
          schemaName,
          fields,
          `/${module.kebab}`,
        ),
      );
    }
    await writeFiles(
      srcPath("web", module.kebab),
      { ...forms, ...crudFiles(module, filters) },
      data,
    );
  };
}

export const generateCrudUi = createCrudUiGenerator();
