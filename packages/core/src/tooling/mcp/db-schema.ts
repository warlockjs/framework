import type { InspectModel, JsonSchema } from "../inspect/inspect-report.types";

/** One column of a {@link DbSchemaTable}. */
export type DbSchemaColumn = {
  name: string;
  /** The JSON Schema `type` (`string`, `integer`, …), `format` appended when set (`string:date-time`). */
  type: string;
  required: boolean;
  primaryKey: boolean;
  /** Set when a `belongsTo` relation uses this column. */
  references: { model: string | null; column: string | null } | null;
  schema: JsonSchema;
};

/** One table, as the app's models declare it. */
export type DbSchemaTable = {
  table: string | null;
  model: string;
  dataSource: string | null;
  sourceFile: string | null;
  primaryKey: string | null;
  columns: DbSchemaColumn[];
  relations: InspectModel["relations"];
  timestamps: { createdAt: string | null; updatedAt: string | null; deletedAt: string | null };
  deleteStrategy: string | null;
};

/** What the `db_schema` tool returns. */
export type DbSchema = {
  /** Where the facts come from: the models' Seal schemas, not the live database. */
  source: "models";
  tables: DbSchemaTable[];
};

function columnType(schema: JsonSchema): string {
  const type = schema.type;
  const name = Array.isArray(type)
    ? type.filter((entry): entry is string => typeof entry === "string").join("|")
    : typeof type === "string"
      ? type
      : "unknown";
  const format = typeof schema.format === "string" ? `:${schema.format}` : "";

  return `${name}${format}`;
}

/**
 * The database schema the models declare: one table per model with its
 * columns (from the model's Seal `schema`), primary key, foreign keys of its
 * `belongsTo` relations, relations, timestamp columns and delete strategy.
 *
 * Built from `inspectApp()`'s `models` section — the declared shape, which is
 * what code is written against. It does not open a database connection, so
 * columns that exist only in a migration are not listed.
 */
export function buildDbSchema(models: readonly InspectModel[], filter?: string): DbSchema {
  const wanted = filter?.toLowerCase();

  const tables = models
    .filter(
      (model) =>
        !wanted ||
        model.name.toLowerCase() === wanted ||
        (model.table ?? "").toLowerCase() === wanted,
    )
    .map((model): DbSchemaTable => {
      const foreignKeys = new Map(
        model.relations
          .filter((relation) => relation.type === "belongsTo" && relation.foreignKey)
          .map((relation) => [relation.foreignKey, relation]),
      );
      const columns = model.columns.map((column): DbSchemaColumn => {
        const relation = foreignKeys.get(column.name);

        return {
          name: column.name,
          type: columnType(column.schema),
          required: column.required,
          primaryKey: column.name === model.primaryKey,
          references: relation
            ? { model: relation.model, column: relation.localKey ?? "id" }
            : null,
          schema: column.schema,
        };
      });

      return {
        table: model.table,
        model: model.name,
        dataSource: model.dataSource,
        sourceFile: model.sourceFile,
        primaryKey: model.primaryKey,
        columns,
        relations: model.relations,
        timestamps: {
          createdAt: model.createdAtColumn,
          updatedAt: model.updatedAtColumn,
          deletedAt: model.deletedAtColumn,
        },
        deleteStrategy: model.deleteStrategy,
      };
    })
    .sort((first, second) =>
      (first.table ?? first.model).localeCompare(second.table ?? second.model),
    );

  return { source: "models", tables };
}
