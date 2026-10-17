import type { WarlockErrorCode } from "../../errors/error-codes";

/**
 * @fileoverview The `warlock inspect` report, schema version 1.
 *
 * STABILITY: within `schemaVersion: 1` fields are only ever ADDED. No field is
 * removed, renamed or retyped, so a consumer written against this file keeps
 * working on every later 5.x release. Consumers must ignore keys they do not
 * know. A change that breaks that promise ships as `schemaVersion: 2` and is
 * listed under BREAKING in the changelog. Free text (warning messages,
 * descriptions) is not part of the contract.
 *
 * The same shape is published as JSON Schema (draft 2020-12) in
 * `@warlock.js/core/schemas/inspect-report.schema.json` and as the
 * `INSPECT_REPORT_JSON_SCHEMA` constant.
 */

/** The version of the report shape. Bumped only for a breaking change. */
export const INSPECT_SCHEMA_VERSION = 1;

/** Every section the report can contain, in output order. */
export const INSPECT_SECTIONS = [
  "routes",
  "models",
  "resources",
  "config",
  "events",
  "pages",
  "jobs",
  "schedules",
  "packages",
] as const;

/** One section name. */
export type InspectSection = (typeof INSPECT_SECTIONS)[number];

/** A JSON Schema (draft 2020-12) fragment. */
export type JsonSchema = Record<string, unknown>;

/** Who guards a route, from the descriptor `authMiddleware()` attaches. */
export type InspectRouteAuth = {
  /** Whether an auth guard runs on the route. */
  required: boolean;
  /** Where the token is read: `"header"` (bearer) or `{ cookie }`. */
  sources: ("header" | { cookie: string })[];
  /** User types the guard accepts; empty means any. */
  userTypes: string[];
};

/** The rate limit a route runs under. */
export type InspectRouteRateLimit = {
  /** `route` = the route's own option, `global` = `http.rateLimit`, `none` = no limiter. */
  source: "route" | "global" | "none";
  /** Max requests per window; `"dynamic"` when configured as a function. */
  max: number | "dynamic" | null;
  /** Window in milliseconds, or the configured string (`"1 minute"`); `"dynamic"` for a function. */
  timeWindow: number | string | null;
};

/** What the route's request log entries keep. */
export type InspectRouteLogging = {
  /** Whether the request body is logged. */
  body: boolean;
  /** Whether the query string is logged. */
  query: boolean;
  /** Whether `http.logging.private` rules exist that may remove more for some URLs. */
  privateRules: boolean;
};

/** One request parameter (path, query or header). */
export type InspectParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: JsonSchema;
};

/** One registered HTTP route. */
export type InspectRoute = {
  /** Uppercase method, `ALL` for `router.all`. */
  method: string;
  path: string;
  name: string | null;
  /** Project-relative file that registered the route. */
  sourceFile: string | null;
  /** Handler function name, `"anonymous"` when it has none. */
  handler: string;
  description: string | null;
  /** Whether a page (SSR) route registered it. */
  isPage: boolean;
  /** Middleware function names in run order. */
  middleware: string[];
  auth: InspectRouteAuth;
  /** `false` when the route opted out of the CSRF origin guard (`csrf: false`). */
  csrf: boolean;
  rateLimit: InspectRouteRateLimit;
  logging: InspectRouteLogging;
  request: {
    parameters: InspectParameter[];
    /** JSON Schema of the request body, or `null`. */
    body: JsonSchema | null;
    /** Whether `validation.validate` (custom middleware, not described) is set. */
    customValidation: boolean;
  };
  /** Declared responses keyed by status code. */
  responses: Record<string, { description: string; schema: JsonSchema | null }>;
};

/** One model column, from the model's Seal `schema`. */
export type InspectModelColumn = {
  name: string;
  required: boolean;
  schema: JsonSchema;
};

/** One model relation. */
export type InspectModelRelation = {
  name: string;
  type: string;
  /** Target model name, or `null` when it could not be resolved. */
  model: string | null;
  foreignKey: string | null;
  localKey: string | null;
};

/** One model class. */
export type InspectModel = {
  name: string;
  table: string | null;
  primaryKey: string | null;
  /** Data source name, when configured by name. */
  dataSource: string | null;
  sourceFile: string | null;
  /** Whether `@RegisterModel()` put it in the registry. */
  registered: boolean;
  columns: InspectModelColumn[];
  relations: InspectModelRelation[];
  /** Name of the model's `static resource`, a key of `components.schemas`. */
  resource: string | null;
  deleteStrategy: string | null;
  createdAtColumn: string | null;
  updatedAtColumn: string | null;
  deletedAtColumn: string | null;
};

/** One resource class reached from a route or a model. */
export type InspectResource = {
  name: string;
  /** Its output shape (JSON Schema; nested resources are `$ref`s into `components.schemas`). */
  schema: JsonSchema;
  /** Models whose `static resource` is this resource. */
  models: string[];
};

/** One config key: its path and value type. Values are never printed. */
export type InspectConfigKey = {
  key: string;
  /** `string`, `number`, `boolean`, `null`, `array`, `object`, `function`, `regexp`, `date`, or a class name. */
  type: string;
  /** The `src/config/*` file the top-level key comes from, when it exists. */
  file: string | null;
};

/** One event and the listeners app modules registered for it. */
export type InspectEvent = {
  event: string;
  listeners: { name: string; sourceFile: string }[];
};

/** One page installed by `@warlock.js/web`. */
export type InspectPage = {
  path: string;
  name: string | null;
  file: string;
  /** Layout files from the outermost to the page's own directory. */
  layouts: string[];
  /** Files on the chain (layouts, then the page) that export a `loader`. */
  loaders: string[];
  /** Action names the page exports (`"default"` for `action`). */
  actions: string[];
  /** `"user"` when the page or a layout statically requires a user. */
  guard: string | null;
};

/** One queue job defined with `defineJob()`. */
export type InspectJob = {
  name: string;
  queue: string;
  attempts: number | null;
  backoff: number | { type: string; delay: number } | null;
  removeOnComplete: boolean | number | null;
  removeOnFail: boolean | number | null;
};

/** One scheduled task on the `@warlock.js/scheduler` scheduler. */
export type InspectSchedule = {
  name: string;
  cron: string | null;
  intervals: Record<string, unknown>;
  nextRun: string | null;
};

/** One installed `@warlock.js/*` package. */
export type InspectPackage = {
  name: string;
  version: string;
};

/** Something inspect could not read, with its code when one applies. */
export type InspectWarning = {
  code: WarlockErrorCode | null;
  message: string;
  /** The section or file it concerns. */
  source: string | null;
};

/** The whole report. Sections not requested are absent. */
export type InspectReport = {
  schemaVersion: typeof INSPECT_SCHEMA_VERSION;
  generatedAt: string;
  app: {
    name: string | null;
    version: string | null;
    /** Absolute project root. */
    root: string;
    node: string;
    environment: string;
    runtimeStrategy: string;
  };
  /** The sections this report contains. */
  sections: InspectSection[];
  routes?: InspectRoute[];
  models?: InspectModel[];
  resources?: InspectResource[];
  config?: InspectConfigKey[];
  events?: InspectEvent[];
  pages?: InspectPage[];
  jobs?: InspectJob[];
  schedules?: InspectSchedule[];
  packages?: InspectPackage[];
  /** Shared schemas that `$ref`s point at (`#/components/schemas/<name>`). */
  components: { schemas: Record<string, JsonSchema> };
  warnings: InspectWarning[];
};
