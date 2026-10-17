import { Application } from "../../application/application";
import { SchemaRegistry } from "../../openapi/schema-registry";
import { router } from "../../router/router";
import type { Route } from "../../router/types";
import { collectConfig } from "./collect-config";
import { collectModels, collectResources, type InspectModelModule } from "./collect-models";
import {
  type AppModuleImporter,
  collectJobs,
  collectPackages,
  collectSchedules,
  createAppModuleImporter,
  readAppPackage,
} from "./collect-packages";
import { collectPages, installedPagesFromConnectors } from "./collect-pages";
import { collectRoutes } from "./collect-routes";
import { groupListeners, type RecordedListener } from "./event-recorder";
import {
  INSPECT_SCHEMA_VERSION,
  INSPECT_SECTIONS,
  type InspectReport,
  type InspectSection,
  type InspectWarning,
} from "./inspect-report.types";

/** Inputs of {@link inspectApp}. Every field is optional. */
export type InspectOptions = {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string;
  /** The sections to include. Default: all of {@link INSPECT_SECTIONS}. */
  sections?: readonly InspectSection[];
  /** The routes to describe. Default: `router.list()`. */
  routes?: readonly Route[];
  /** Model modules the boot pass imported (their exports are scanned for model classes). */
  modelModules?: readonly InspectModelModule[];
  /** Listeners recorded while app modules were imported (see `EventRecorder`). */
  events?: readonly RecordedListener[];
  /** Warnings found before inspecting (by the boot pass); listed first. */
  warnings?: readonly InspectWarning[];
  /** App modules that failed to import; each becomes a `WL2001` warning. */
  moduleFailures?: readonly { file: string; message: string }[];
  /** The `web` connector's installed pages. Default: read from the registered connectors. */
  pages?: readonly unknown[];
  /**
   * Name a resource class in `components.schemas`, usually by its export name
   * (`PostResource`). Unnamed resources fall back to the class name.
   */
  resolveResourceName?: (resource: unknown) => string | undefined;
  /** The loaded config tree. Default: everything `config` holds. */
  config?: Record<string, unknown>;
  /** How packages are imported as the app resolves them (`@warlock.js/queue`, `/scheduler`). */
  importFromApp?: AppModuleImporter;
  /** Clock, for `generatedAt`. */
  now?: () => Date;
};

/** Whether a string is a section name. */
export function isInspectSection(value: string): value is InspectSection {
  return (INSPECT_SECTIONS as readonly string[]).includes(value);
}

/**
 * Parse a `--section routes,models` value. Throws on an unknown name, listing
 * the valid ones. An empty value means every section.
 */
export function parseInspectSections(value: string | undefined): InspectSection[] {
  if (value === undefined || value.trim() === "") return [...INSPECT_SECTIONS];

  const requested = value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const unknown = requested.filter((name) => !isInspectSection(name));

  if (unknown.length > 0) {
    throw new Error(
      `Unknown inspect section(s): ${unknown.join(", ")}. Valid sections: ${INSPECT_SECTIONS.join(", ")}.`,
    );
  }

  return INSPECT_SECTIONS.filter((section) => requested.includes(section));
}

/**
 * Describe the application from its in-process registries: routes, models,
 * resources, config keys, event listeners, pages, queue jobs, scheduled
 * tasks and installed `@warlock.js/*` packages.
 *
 * Reads what is ALREADY registered and boots nothing, so it can run inside a
 * live dev process as well as after the `warlock inspect` boot pass. Never
 * throws for one unreadable item: it becomes an entry in `warnings`.
 *
 * @example
 * const report = await inspectApp({ sections: ["routes"] });
 * report.routes?.filter((route) => !route.auth.required && route.method !== "GET");
 */
export async function inspectApp(options: InspectOptions = {}): Promise<InspectReport> {
  const cwd = options.cwd ?? process.cwd();
  const sections = options.sections ? [...options.sections] : [...INSPECT_SECTIONS];
  const wants = new Set<InspectSection>(sections);
  const warnings: InspectWarning[] = [...(options.warnings ?? [])];
  const registry = new SchemaRegistry(options.resolveResourceName, (message) => {
    warnings.push({ code: null, message, source: "resources" });
  });
  const importFromApp = options.importFromApp ?? createAppModuleImporter(cwd);

  for (const failure of options.moduleFailures ?? []) {
    warnings.push({
      code: "WL2001",
      message: `${failure.file} failed to load: ${failure.message}`,
      source: failure.file,
    });
  }

  const app = readAppPackage(cwd);
  const report: InspectReport = {
    schemaVersion: INSPECT_SCHEMA_VERSION,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    app: {
      name: app.name,
      version: app.version,
      root: cwd,
      node: process.version,
      environment: String(Application.environment ?? "development"),
      runtimeStrategy: String(Application.runtimeStrategy ?? "development"),
    },
    sections: INSPECT_SECTIONS.filter((section) => wants.has(section)),
    components: { schemas: {} },
    warnings,
  };

  // Routes and models register the resources they reference, so `resources`
  // (and `components`) are filled from both even when only one is printed.
  const routes = collectRoutes(options.routes ?? router.list(), registry, warnings);
  const { models, resourceModels } = collectModels(options.modelModules ?? [], registry, warnings);

  if (wants.has("routes")) report.routes = routes;
  if (wants.has("models")) report.models = models;
  if (wants.has("resources")) report.resources = collectResources(registry, resourceModels);
  if (wants.has("config")) report.config = collectConfig(cwd, options.config);
  if (wants.has("events")) report.events = groupListeners(options.events ?? []);

  if (wants.has("pages")) {
    report.pages = collectPages(options.pages ?? installedPagesFromConnectors(), cwd, warnings);
  }

  if (wants.has("jobs")) report.jobs = await collectJobs(importFromApp, warnings);
  if (wants.has("schedules")) report.schedules = await collectSchedules(importFromApp, warnings);
  if (wants.has("packages")) report.packages = collectPackages(cwd);

  report.components.schemas = registry.schemas;

  return report;
}
