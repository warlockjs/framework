/**
 * JSON Schema (draft 2020-12) of the `warlock inspect` report, schema version 1.
 *
 * Shipped twice: as this constant, and as
 * `@warlock.js/core/schemas/inspect-report.schema.json` for tools that are not
 * JavaScript. A test keeps the two identical. Objects allow additional
 * properties on purpose: within schema version 1 fields are only added, and a
 * validator written today must accept tomorrow's reports.
 */

const nullableString = { type: ["string", "null"] };
const stringArray = { type: "array", items: { type: "string" } };
const jsonSchema = { type: "object" };

const authSource = {
  oneOf: [
    { const: "header" },
    {
      type: "object",
      required: ["cookie"],
      properties: { cookie: { type: "string" } },
    },
  ],
};

const route = {
  type: "object",
  required: [
    "method",
    "path",
    "name",
    "sourceFile",
    "handler",
    "description",
    "isPage",
    "middleware",
    "auth",
    "csrf",
    "rateLimit",
    "logging",
    "request",
    "responses",
  ],
  properties: {
    method: { type: "string" },
    path: { type: "string" },
    name: nullableString,
    sourceFile: nullableString,
    handler: { type: "string" },
    description: nullableString,
    isPage: { type: "boolean" },
    middleware: stringArray,
    auth: {
      type: "object",
      required: ["required", "sources", "userTypes"],
      properties: {
        required: { type: "boolean" },
        sources: { type: "array", items: authSource },
        userTypes: stringArray,
      },
    },
    csrf: { type: "boolean" },
    rateLimit: {
      type: "object",
      required: ["source", "max", "timeWindow"],
      properties: {
        source: { enum: ["route", "global", "none"] },
        max: { oneOf: [{ type: "number" }, { const: "dynamic" }, { type: "null" }] },
        timeWindow: { type: ["number", "string", "null"] },
      },
    },
    logging: {
      type: "object",
      required: ["body", "query", "privateRules"],
      properties: {
        body: { type: "boolean" },
        query: { type: "boolean" },
        privateRules: { type: "boolean" },
      },
    },
    request: {
      type: "object",
      required: ["parameters", "body", "customValidation"],
      properties: {
        parameters: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "in", "required", "schema"],
            properties: {
              name: { type: "string" },
              in: { enum: ["path", "query", "header", "cookie"] },
              required: { type: "boolean" },
              schema: jsonSchema,
            },
          },
        },
        body: { type: ["object", "null"] },
        customValidation: { type: "boolean" },
      },
    },
    responses: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["description", "schema"],
        properties: {
          description: { type: "string" },
          schema: { type: ["object", "null"] },
        },
      },
    },
  },
};

const model = {
  type: "object",
  required: [
    "name",
    "table",
    "primaryKey",
    "dataSource",
    "sourceFile",
    "registered",
    "columns",
    "relations",
    "resource",
    "deleteStrategy",
    "createdAtColumn",
    "updatedAtColumn",
    "deletedAtColumn",
  ],
  properties: {
    name: { type: "string" },
    table: nullableString,
    primaryKey: nullableString,
    dataSource: nullableString,
    sourceFile: nullableString,
    registered: { type: "boolean" },
    columns: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "required", "schema"],
        properties: {
          name: { type: "string" },
          required: { type: "boolean" },
          schema: jsonSchema,
        },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type", "model", "foreignKey", "localKey"],
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          model: nullableString,
          foreignKey: nullableString,
          localKey: nullableString,
        },
      },
    },
    resource: nullableString,
    deleteStrategy: nullableString,
    createdAtColumn: nullableString,
    updatedAtColumn: nullableString,
    deletedAtColumn: nullableString,
  },
};

const resource = {
  type: "object",
  required: ["name", "schema", "models"],
  properties: {
    name: { type: "string" },
    schema: jsonSchema,
    models: stringArray,
  },
};

const configKey = {
  type: "object",
  required: ["key", "type", "file"],
  properties: {
    key: { type: "string" },
    type: { type: "string" },
    file: nullableString,
  },
};

const wiringFile = {
  type: "object",
  required: ["type", "role", "file", "module", "order"],
  properties: {
    type: { const: "file" },
    role: { enum: ["config", "locale", "event", "main", "route", "worker"] },
    file: { type: "string" },
    module: { type: "string" },
    order: { type: "integer" },
  },
};

const wiringCapability = {
  type: "object",
  required: [
    "type",
    "name",
    "description",
    "required",
    "provided",
    "definedIn",
    "providedBy",
    "consumers",
  ],
  properties: {
    type: { const: "capability" },
    name: { type: "string" },
    description: nullableString,
    required: { type: "boolean" },
    provided: { type: "boolean" },
    definedIn: nullableString,
    providedBy: nullableString,
    consumers: stringArray,
  },
};

const event = {
  type: "object",
  required: ["event", "listeners"],
  properties: {
    event: { type: "string" },
    listeners: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "sourceFile"],
        properties: { name: { type: "string" }, sourceFile: { type: "string" } },
      },
    },
  },
};

const page = {
  type: "object",
  required: ["path", "name", "file", "layouts", "loaders", "actions", "guard"],
  properties: {
    path: { type: "string" },
    name: nullableString,
    file: { type: "string" },
    layouts: stringArray,
    loaders: stringArray,
    actions: stringArray,
    guard: nullableString,
  },
};

const job = {
  type: "object",
  required: ["name", "queue", "attempts", "backoff", "removeOnComplete", "removeOnFail"],
  properties: {
    name: { type: "string" },
    queue: { type: "string" },
    attempts: { type: ["number", "null"] },
    backoff: {
      oneOf: [
        { type: "number" },
        { type: "null" },
        {
          type: "object",
          required: ["type", "delay"],
          properties: { type: { type: "string" }, delay: { type: "number" } },
        },
      ],
    },
    removeOnComplete: { type: ["boolean", "number", "null"] },
    removeOnFail: { type: ["boolean", "number", "null"] },
  },
};

const schedule = {
  type: "object",
  required: ["name", "cron", "intervals", "nextRun"],
  properties: {
    name: { type: "string" },
    cron: nullableString,
    intervals: { type: "object" },
    nextRun: nullableString,
  },
};

const installedPackage = {
  type: "object",
  required: ["name", "version"],
  properties: { name: { type: "string" }, version: { type: "string" } },
};

const warning = {
  type: "object",
  required: ["code", "message", "source"],
  properties: {
    code: { oneOf: [{ type: "string", pattern: "^WL[0-9]{4}$" }, { type: "null" }] },
    message: { type: "string" },
    source: nullableString,
  },
};

/** The report's JSON Schema, draft 2020-12. */
export const INSPECT_REPORT_JSON_SCHEMA: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Warlock inspect report",
  description: "Output of `warlock inspect --json`, schema version 1.",
  type: "object",
  required: ["schemaVersion", "generatedAt", "app", "sections", "components", "warnings"],
  properties: {
    schemaVersion: { const: 1 },
    generatedAt: { type: "string" },
    app: {
      type: "object",
      required: ["name", "version", "root", "node", "environment", "runtimeStrategy"],
      properties: {
        name: nullableString,
        version: nullableString,
        root: { type: "string" },
        node: { type: "string" },
        environment: { type: "string" },
        runtimeStrategy: { type: "string" },
      },
    },
    sections: {
      type: "array",
      items: {
        enum: [
          "routes",
          "models",
          "resources",
          "config",
          "events",
          "pages",
          "jobs",
          "schedules",
          "packages",
          "files",
          "wiring",
        ],
      },
    },
    routes: { type: "array", items: route },
    models: { type: "array", items: model },
    resources: { type: "array", items: resource },
    config: { type: "array", items: configKey },
    events: { type: "array", items: event },
    pages: { type: "array", items: page },
    jobs: { type: "array", items: job },
    schedules: { type: "array", items: schedule },
    packages: { type: "array", items: installedPackage },
    wiring: { type: "array", items: { oneOf: [wiringFile, wiringCapability] } },
    files: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "module", "role", "exports", "imports", "importedBy"],
        properties: {
          file: { type: "string" },
          module: { type: "string" },
          role: { type: "string" },
          exports: stringArray,
          importedBy: stringArray,
          imports: {
            type: "array",
            items: {
              type: "object",
              required: ["specifier", "file"],
              properties: { specifier: { type: "string" }, file: nullableString },
            },
          },
        },
      },
    },
    components: {
      type: "object",
      required: ["schemas"],
      properties: {
        schemas: { type: "object", additionalProperties: jsonSchema },
      },
    },
    warnings: { type: "array", items: warning },
  },
};
