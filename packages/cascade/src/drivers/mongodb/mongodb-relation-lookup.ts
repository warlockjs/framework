/**
 * Relation-aware pipeline stages for the MongoDB query builder.
 *
 * `has()` / `whereHas()` / `doesntHave()` / `whereDoesntHave()` /
 * `orWhereHas()` and `withCount()` need data from the related collection. They
 * are compiled here into a `$lookup` per relation (placed ahead of the `$match`
 * that reads it) plus a plain `$match` / `$addFields` condition on the looked-up
 * array, so an `orWhereHas` joins the same `$or` as any other condition.
 *
 * The temporary fields the lookups add are removed by a trailing `$unset`.
 */

import { UnsupportedQueryOperationError } from "../../errors/unsupported-query-operation.error";
import { toSafeCount } from "../../query-builder/pagination-limits";
import {
  inferBelongsToForeignKey,
  inferHasForeignKey,
  inferPivotKey,
  inferPivotTable,
  type KeyConventionOptions,
} from "../../relations/key-conventions";
import type { Operation } from "./types";

/** Operation types that filter by the existence (or number) of related documents. */
export const HAS_OPERATION_TYPES: ReadonlySet<string> = new Set([
  "has",
  "whereHas",
  "orWhereHas",
  "doesntHave",
  "whereDoesntHave",
]);

/** The related model facts a lookup needs. */
export type RelatedModelInfo = {
  table: string;
  name: string;
  primaryKey?: string;
  relations?: Record<string, unknown>;
};

/** What the compiler needs from the owning query builder. */
export type RelationOperationsContext = {
  /** Relation definitions of the model the query runs on. */
  relationDefinitions?: Record<string, any>;
  /** The model the query runs on. */
  modelClass?: { name?: string; primaryKey?: string };
  /** Key naming conventions of the data source. */
  conventions?: KeyConventionOptions;
  /** Resolve a relation's related model, or undefined when it cannot be resolved. */
  resolveRelated(definition: Record<string, unknown>): RelatedModelInfo | undefined;
  /**
   * The match filter of a constraint on the related model. `source` is a
   * callback (`whereHas`) or recorded operations (`withCount`).
   */
  constraintFilter(related: RelatedModelInfo, source: unknown): Record<string, unknown>;
};

/** Result of {@link compileRelationOperations}. */
export type CompiledRelationOperations = {
  /** Operations ready for the parser. */
  operations: Operation[];
  /** Stages to run last (removing the temporary lookup fields). */
  trailingStages: Record<string, unknown>[];
};

/** One `withCount()` entry. */
export type CountRelationEntry = {
  relation: string;
  constraintOps?: unknown;
};

const COMPARISON_OPERATORS: Record<string, string> = {
  "=": "$eq",
  "!=": "$ne",
  "<>": "$ne",
  ">": "$gt",
  ">=": "$gte",
  "<": "$lt",
  "<=": "$lte",
};

/** Whether the operations hold a relation-existence filter. */
export function hasRelationExistenceOperations(operations: readonly Operation[]): boolean {
  return operations.some((op) => HAS_OPERATION_TYPES.has(op.type));
}

type LookupMode = "exists" | "count";

type LookupInput = {
  context: RelationOperationsContext;
  relationName: string;
  definition: Record<string, any>;
  related: RelatedModelInfo;
  constraint: Record<string, unknown>;
  mode: LookupMode;
  alias: string;
  method: string;
};

function andMatch(expr: Record<string, unknown>, constraint: Record<string, unknown>) {
  return Object.keys(constraint).length === 0 ? expr : { $and: [expr, constraint] };
}

/** Stages closing the lookup pipeline: stop at the first row, or count the rows. */
function lookupTail(mode: LookupMode): Record<string, unknown>[] {
  return mode === "exists" ? [{ $limit: 1 }, { $project: { _id: 1 } }] : [{ $count: "n" }];
}

/**
 * Build the `$lookup` stage that gathers (the existence of, or the count of)
 * a relation's related documents for each document.
 */
export function buildRelationLookup(input: LookupInput): Record<string, unknown> {
  const { context, relationName, definition, related, constraint, mode, alias, method } = input;
  const type = definition.type as string;
  const self = context.modelClass;
  const conventions = context.conventions;
  const selfName = self?.name ?? "Model";

  if (type === "hasMany" || type === "hasOne") {
    const localKey = (definition.localKey as string | undefined) ?? self?.primaryKey ?? "id";
    const foreignKey =
      (definition.foreignKey as string | undefined) ?? inferHasForeignKey(selfName, conventions);

    return {
      $lookup: {
        from: related.table,
        let: { key: `$${localKey}` },
        pipeline: [
          { $match: andMatch({ $expr: { $eq: [`$${foreignKey}`, "$$key"] } }, constraint) },
          ...lookupTail(mode),
        ],
        as: alias,
      },
    };
  }

  if (type === "belongsTo") {
    const ownerKey = (definition.localKey as string | undefined) ?? related.primaryKey ?? "id";
    const foreignKey =
      (definition.foreignKey as string | undefined) ??
      inferBelongsToForeignKey(relationName, conventions);

    return {
      $lookup: {
        from: related.table,
        let: { key: `$${foreignKey}` },
        pipeline: [
          { $match: andMatch({ $expr: { $eq: [`$${ownerKey}`, "$$key"] } }, constraint) },
          ...lookupTail(mode),
        ],
        as: alias,
      },
    };
  }

  if (type === "belongsToMany") {
    const pivot =
      (definition.pivot as string | undefined) ??
      inferPivotTable(selfName, related.name, conventions);
    const pivotLocalColumn =
      (definition.localKey as string | undefined) ?? inferPivotKey(selfName, conventions);
    const pivotForeignColumn =
      (definition.foreignKey as string | undefined) ?? inferPivotKey(related.name, conventions);
    const selfKey = (definition.pivotLocalKey as string | undefined) ?? self?.primaryKey ?? "id";
    const relatedKey =
      (definition.pivotForeignKey as string | undefined) ?? related.primaryKey ?? "id";
    const pipeline: Record<string, unknown>[] = [
      { $match: { $expr: { $eq: [`$${pivotLocalColumn}`, "$$key"] } } },
    ];

    // A constraint targets the related collection: keep only pivot rows
    // whose related document satisfies it.
    if (Object.keys(constraint).length > 0) {
      pipeline.push(
        {
          $lookup: {
            from: related.table,
            let: { related: `$${pivotForeignColumn}` },
            pipeline: [
              { $match: andMatch({ $expr: { $eq: [`$${relatedKey}`, "$$related"] } }, constraint) },
              { $limit: 1 },
              { $project: { _id: 1 } },
            ],
            as: "__related",
          },
        },
        { $match: { __related: { $ne: [] } } },
      );
    }

    pipeline.push(...lookupTail(mode));

    return { $lookup: { from: pivot, let: { key: `$${selfKey}` }, pipeline, as: alias } };
  }

  throw new UnsupportedQueryOperationError(
    method,
    "mongodb",
    `The relation "${relationName}" has the unsupported type "${type}".`,
  );
}

/** The size of a lookup array, as a number expression. */
function countExpression(alias: string, mode: LookupMode): Record<string, unknown> {
  return mode === "exists"
    ? { $size: `$${alias}` }
    : { $ifNull: [{ $arrayElemAt: [`$${alias}.n`, 0] }, 0] };
}

function resolveRelation(
  context: RelationOperationsContext,
  relationName: string,
  method: string,
): { definition: Record<string, any>; related: RelatedModelInfo } {
  const definition = context.relationDefinitions?.[relationName] as Record<string, any> | undefined;

  if (!definition) {
    throw new Error(
      `${method}: Relation "${relationName}" not found on model ${context.modelClass?.name ?? "unknown"}`,
    );
  }

  const related = context.resolveRelated(definition);

  if (!related?.table) {
    throw new Error(`${method}: Related model not resolvable for "${relationName}"`);
  }

  return { definition, related };
}

/**
 * Compile the relation-existence operations (and, when `counts` is given, the
 * `withCount()` entries) of a query into lookup stages and plain conditions.
 *
 * - Each `has*` operation becomes a `$lookup` placed first, and a `whereRaw` /
 *   `orWhereRaw` condition on the looked-up array in its original position.
 * - Count entries become a `$lookup` and an `$addFields` placed last (so they
 *   run for the page of documents a `limit()` keeps), or first when a filter or
 *   sort reads the count field.
 */
export function compileRelationOperations(
  operations: readonly Operation[],
  context: RelationOperationsContext,
  counts?: ReadonlyMap<string, CountRelationEntry>,
): CompiledRelationOperations {
  const leading: Operation[] = [];
  const trailing: Operation[] = [];
  const temporaryFields: string[] = [];
  let lookupIndex = 0;

  const nextAlias = (): string => {
    const alias = `__rel_${lookupIndex++}`;

    temporaryFields.push(alias);

    return alias;
  };

  const compiled = operations.map((op): Operation => {
    if (!HAS_OPERATION_TYPES.has(op.type)) {
      return op;
    }

    const relationName = op.data.relation as string;
    const { definition, related } = resolveRelation(context, relationName, op.type);
    const constraint = op.data.callback
      ? context.constraintFilter(related, op.data.callback)
      : ({} as Record<string, unknown>);

    const negate = op.type === "doesntHave" || op.type === "whereDoesntHave";
    const comparison = op.type === "has" ? hasComparison(op.data) : undefined;
    const mode: LookupMode = comparison ? "count" : "exists";
    const alias = nextAlias();

    leading.push({
      stage: "$lookup",
      mergeable: false,
      type: "relationLookup",
      data: {
        stageDefinition: buildRelationLookup({
          context,
          relationName,
          definition,
          related,
          constraint,
          mode,
          alias,
          method: op.type,
        }),
      },
    });

    const size = countExpression(alias, mode);
    const condition = comparison
      ? { $expr: { [comparison.operator]: [size, comparison.count] } }
      : { $expr: { [negate ? "$eq" : "$gt"]: [size, 0] } };

    return {
      stage: "$match",
      mergeable: true,
      type: op.type === "orWhereHas" ? "orWhereRaw" : "whereRaw",
      data: { expression: condition },
    };
  });

  if (counts && counts.size > 0) {
    const countAliases = new Set(counts.keys());
    const referenced = compiled.some((op) => countAliases.has(op.data?.field as string));

    for (const [outputField, entry] of counts) {
      const { definition, related } = resolveRelation(context, entry.relation, "withCount");
      const constraint = entry.constraintOps
        ? context.constraintFilter(related, entry.constraintOps)
        : ({} as Record<string, unknown>);
      const alias = nextAlias();
      const target = referenced ? leading : trailing;

      target.push(
        {
          stage: "$lookup",
          mergeable: false,
          type: "relationLookup",
          data: {
            stageDefinition: buildRelationLookup({
              context,
              relationName: entry.relation,
              definition,
              related,
              constraint,
              mode: "count",
              alias,
              method: "withCount",
            }),
          },
        },
        {
          stage: "$addFields",
          mergeable: false,
          type: "relationCount",
          data: { [outputField]: countExpression(alias, "count") },
        },
      );
    }
  }

  return {
    operations: [...leading, ...compiled, ...trailing],
    trailingStages: temporaryFields.length > 0 ? [{ $unset: temporaryFields }] : [],
  };
}

/** The comparison of a `has(relation, operator, count)` call, or undefined for plain existence. */
function hasComparison(
  data: Record<string, unknown>,
): { operator: string; count: number } | undefined {
  const operator = data.operator as string | undefined;
  const count = data.count as number | undefined;

  if ((operator === undefined || operator === ">=") && (count === undefined || count === 1)) {
    return undefined;
  }

  const token = typeof operator === "string" ? operator.trim() : ">=";
  const mongoOperator = COMPARISON_OPERATORS[token];

  if (!mongoOperator) {
    throw new Error(
      `has(): unsupported comparison operator ${JSON.stringify(String(operator).slice(0, 40))}. ` +
        `Use one of =, !=, <>, >, >=, <, <=.`,
    );
  }

  return { operator: mongoOperator, count: toSafeCount(count ?? 1, 'has(): "count"') };
}
