import { colors } from "@mongez/copper";
import { command } from "../../../commands/cli-command";
import type { CommandActionData } from "../../../commands/types";
import { runGenerationCommand } from "../../../generations/generation-run";
import { generateController } from "./generators/controller.generator";
import { generateEndpoint } from "./generators/endpoint.generator";
import { generateMigration } from "./generators/migration.generator";
import { generateModel } from "./generators/model.generator";
import { generateModule } from "./generators/module.generator";
import { generateRepository } from "./generators/repository.generator";
import { generateResource } from "./generators/resource.generator";
import { generateService } from "./generators/service.generator";
import { generateUseCase } from "./generators/use-case.generator";
import { generatePage, generateForm, generateCrudUi } from "./generators/web.generator";

const generators: Record<string, (data: CommandActionData) => Promise<void>> = {
  page: generatePage,
  form: generateForm,
  "crud-ui": generateCrudUi,
  module: generateModule,
  endpoint: generateEndpoint,
  controller: generateController,
  service: generateService,
  "use-case": generateUseCase,
  model: generateModel,
  migration: generateMigration,
  repository: generateRepository,
  resource: generateResource,
};

/**
 * Run one generator under the recorder that implements `--dry-run` and
 * `--json` (see `generations/generation-run.ts`).
 */
function recorded(
  commandName: string,
  generator: (data: CommandActionData) => Promise<void>,
): (data: CommandActionData) => Promise<void> {
  return (data) => runGenerationCommand(commandName, data, generator);
}

/** Options every generator accepts. */
const commonOptions = [
  {
    text: "--force, -f",
    description: "Overwrite existing files",
    type: "boolean" as const,
  },
  {
    text: "--dry-run",
    description: "Preview the files that would be written or skipped without writing anything",
    type: "boolean" as const,
  },
  {
    text: "--json",
    description:
      "Print one JSON report on stdout: files written, files skipped because they exist, messages",
    type: "boolean" as const,
  },
];

/** Options of `make endpoint` / `generate.endpoint`. */
const endpointOptions = [
  {
    text: "--method <method>",
    description: "HTTP method: get, post, put, patch or delete (default: post)",
  },
  {
    text: "--path <path>",
    description: "Route path (default: /<module>, or /<module>/:id for put, patch and delete)",
  },
  {
    text: "--schema <file>",
    description:
      "A TypeScript file exporting the request's seal object schema; its fields shape the resource and the test",
  },
  {
    text: "--resource <Name>",
    description: "Resource the endpoint answers with (default: the module's singular name)",
  },
  {
    text: "--auth",
    description: "Guard the route with the auth middleware (the default)",
    type: "boolean" as const,
  },
  {
    text: "--public",
    description: "Register the route without a guard, marked public: true",
    type: "boolean" as const,
  },
];

/** The `generate <generator>` / `make <generator>` dispatcher. */
function dispatchGenerator(label: "generate" | "make") {
  return async (data: CommandActionData) => {
    const generatorName = data.args[0];
    const generator = generatorName ? generators[generatorName] : undefined;

    if (!generatorName || !generator) {
      console.log(
        colors.red(
          generatorName
            ? `Error: Unknown generator "${generatorName}"`
            : "Error: Generator name is required",
        ),
      );
      console.log(colors.yellow("\nAvailable generators:"));
      Object.keys(generators).forEach((name) => {
        console.log(colors.cyan(`  - ${name}`));
      });
      console.log(colors.yellow(`\nUsage: warlock ${label} <generator> <name> [options]`));
      process.exit(1);
    }

    // Remove the generator name from args for the generator
    await runGenerationCommand(
      `${label} ${generatorName}`,
      { ...data, args: data.args.slice(1) },
      generator,
    );
  };
}

const generatorOptionsForDispatch = [
  ...commonOptions,
  {
    text: "--overwrite",
    description:
      "With --force, also replace existing files that differ from the generated output (default: skip and list them)",
    type: "boolean" as const,
  },
  ...endpointOptions,
  { text: "--module <name>", description: "Module owning the generated form" },
  { text: "--endpoint", description: "Generate a guarded form endpoint", type: "boolean" as const },
  { text: "--interactive", description: "Generate a page feature hook", type: "boolean" as const },
];

// Master generate command
export const generateCommand = command({
  name: "generate <generator> [args...]",
  alias: "g", // Allows 'warlock g module ...'
  description: "Scaffold a new component",
  action: dispatchGenerator("generate"),
  options: generatorOptionsForDispatch,
});

/**
 * `warlock make <generator>` — the same generators as `generate`, e.g.
 * `warlock make endpoint posts/create-post --schema ./schema.ts --public`.
 */
export const makeCommand = command({
  name: "make <generator> [args...]",
  description: "Scaffold a new component (same generators as generate)",
  action: dispatchGenerator("make"),
  options: generatorOptionsForDispatch,
});

/** `warlock make.endpoint` / `generate.endpoint` — one spec-first endpoint. */
export const generateEndpointCommand = command({
  name: "generate.endpoint <module>/<name>",
  alias: "make.endpoint",
  description:
    "Generate an endpoint: route, controller, validation, service, resource, locale key, OpenAPI response schema and an HTTP test",
  action: recorded("make endpoint", generateEndpoint),
  options: [...endpointOptions, ...commonOptions],
});

// Individual commands
export const generateModuleCommand = command({
  name: "generate.module <name>",
  alias: "gen.m",
  description: "Generate a new module",
  action: recorded("generate.module", generateModule),
  options: [
    {
      text: "--minimal, -m",
      description:
        "Generate a minimal skeleton (routes, main, locales, empty subfolders) instead of the full CRUD scaffold",
      type: "boolean",
    },
    {
      text: "--overwrite",
      description:
        "With --force, also replace existing files that differ from the generated output (default: skip and list them)",
      type: "boolean",
    },
    ...commonOptions,
  ],
});

export const generateControllerCommand = command({
  name: "generate.controller <module>/<name>",
  alias: "gen.c",
  description: "Generate a new controller",
  action: recorded("generate.controller", generateController),
  options: [
    {
      text: "--with-validation, -v",
      description: "Generate a validation schema and bind it to the controller",
      type: "boolean",
    },
    ...commonOptions,
  ],
});

export const generateServiceCommand = command({
  name: "generate.service <module>/<name>",
  alias: "gen.s",
  description: "Generate a new service",
  action: recorded("generate.service", generateService),
  options: commonOptions,
});

export const generateUseCaseCommand = command({
  name: "generate.use-case <module>/<verb-noun>",
  description: "Generate a transport-agnostic use-case and its spec",
  action: recorded("generate.use-case", generateUseCase),
  options: commonOptions,
});

export const generateModelCommand = command({
  name: "generate.model <module>/<name>",
  alias: "gen.md",
  description: "Generate a new model with migration",
  action: recorded("generate.model", generateModel),
  options: [
    {
      text: "--with-resource, -rs",
      description: "Generate resource",
      type: "boolean",
    },
    {
      text: "--table <name>",
      description: "Specify table name",
    },
    {
      text: "--overwrite",
      description:
        "With --force, also replace existing files that differ from the generated output (default: skip and list them)",
      type: "boolean",
    },
    ...commonOptions,
    {
      text: "--timestamps [bool]",
      description: "Include timestamps in migration (default: true)",
      type: "boolean",
    },
    {
      text: "--no-timestamps",
      description: "Disable timestamps (same as --timestamps false)",
      type: "boolean",
    },
  ],
});

export const generateRepositoryCommand = command({
  name: "generate.repository <module>/<name>",
  alias: "gen.r",
  description: "Generate a new repository",
  action: recorded("generate.repository", generateRepository),
  options: commonOptions,
});

export const generateResourceCommand = command({
  name: "generate.resource <module>/<name>",
  alias: "gen.rs",
  description: "Generate a new resource",
  action: recorded("generate.resource", generateResource),
  options: commonOptions,
});

export const generateMigrationCommand = command({
  name: "generate.migration <model-path>",
  alias: "gen.mig",
  description: "Generate a new migration for a model",
  action: recorded("generate.migration", generateMigration),
  options: [
    ...commonOptions,
    {
      text: "--add <columns>",
      description: "Columns to add (DSL: name:type:modifier,...)",
    },
    {
      text: "--drop <columns>",
      description: "Columns to drop (comma-separated names)",
    },
    {
      text: "--rename <columns>",
      description: "Columns to rename (DSL: old:new,...)",
    },
    {
      text: "--timestamps [bool]",
      description: "Include timestamps (default: true)",
      type: "boolean",
    },
    {
      text: "--no-timestamps",
      description: "Disable timestamps (same as --timestamps false)",
      type: "boolean",
    },
  ],
});
