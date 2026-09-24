/**
 * @fileoverview Foreign-key naming conventions for relation defaults.
 *
 * Single source of truth for default FK / pivot column names when a relation
 * definition omits an explicit `foreignKey`. Centralised so the three
 * relation-resolution code paths (RelationLoader, applyJoinRelations,
 * applyCountRelations) stay consistent — historically each path defaulted
 * differently, producing silent wrong-column bugs.
 *
 * Convention: snake_case + `_id` suffix. Matches PostgreSQL idiom and the
 * existing column convention used throughout `src/app/**` (`organization_id`,
 * `chat_id`, `image_id`, …).
 *
 * @module @warlock.js/cascade/relations/key-conventions
 */

import { toSnakeCase } from "@mongez/reinforcements";
import type { NamingConvention, RelationDefaults } from "../types";

/**
 * Relation defaults plus the column casing of the owning data source. Callers
 * that omit `namingConvention` keep the historical snake_case behaviour.
 */
export type KeyConventionOptions = RelationDefaults & {
  namingConvention?: NamingConvention;
};

const DEFAULT_FK_SUFFIX = "_id";
const DEFAULT_PIVOT_ORDER: NonNullable<RelationDefaults["pivotTableNamingOrder"]> = "alphabetical";

// ============================================================================
// PRIVATE — STRING NORMALISATION
// ============================================================================

/**
 * Convert a model class name or relation name to snake_case.
 *
 * Wraps `toSnakeCase` from `@mongez/reinforcements` because the lib's regex
 * loses the leading letters in runs of consecutive uppercase
 * (`toSnakeCase("AIModel")` → `"imodel"`). The two pre-normalisation passes
 * here insert separators at run boundaries before delegating, so acronym-
 * prefixed model names (`AIModel`, `AIUsage`, `AITrip`, `HTTPSConnection`)
 * snake correctly.
 *
 * Once an upstream fix lands in `@mongez/reinforcements`, this wrapper can
 * be deleted and `toSnakeCase` called directly at the consumer sites.
 *
 * @example
 * snake("User")            // "user"
 * snake("BlogPost")        // "blog_post"
 * snake("AIModel")         // "ai_model"
 * snake("HTTPSConnection") // "https_connection"
 * snake("organization")    // "organization"  (idempotent)
 * snake("organizationId")  // "organization_id"
 */
function snake(input: string): string {
  const normalised = input
    // Split a run of caps from a final cap+lower:  "AIModel" → "AI_Model"
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    // Split a lower/digit boundary from the next cap: "BlogPost" → "Blog_Post"
    .replace(/([a-z\d])([A-Z])/g, "$1_$2");

  return toSnakeCase(normalised).toLowerCase();
}

/**
 * Build a key column name from a model/relation name, honouring the data
 * source's naming convention: `user_id` (snake_case) or `userId` (camelCase).
 * An explicit `foreignKeySuffix` is always used verbatim.
 */
function keyName(input: string, options?: KeyConventionOptions): string {
  const base = snake(input);

  if (options?.namingConvention === "camelCase") {
    const camel = base.replace(/_([a-z\d])/g, (_, char: string) => char.toUpperCase());

    return `${camel}${options.foreignKeySuffix ?? "Id"}`;
  }

  return `${base}${options?.foreignKeySuffix ?? DEFAULT_FK_SUFFIX}`;
}

// ============================================================================
// PUBLIC — DEFAULT FOREIGN-KEY INFERENCE
// ============================================================================

/**
 * Default foreign-key column name for a `belongsTo` relation.
 *
 * The FK lives on THIS model (the owner of the `belongsTo` def) and is
 * named after the *role* the relation plays — not the target model class.
 * Matches Laravel/Rails convention: `Post.author_id` (not `Post.user_id`)
 * because the relation is named "author".
 *
 * @param relationName - The relation key as declared in `static relations`
 *
 * @example
 * inferBelongsToForeignKey("author")       // "author_id"
 * inferBelongsToForeignKey("organization") // "organization_id"
 * inferBelongsToForeignKey("parentItem")   // "parent_item_id"
 */
export function inferBelongsToForeignKey(
  relationName: string,
  options?: KeyConventionOptions,
): string {
  return keyName(relationName, options);
}

/**
 * Default foreign-key column name for a `hasMany` or `hasOne` relation.
 *
 * The FK lives on the RELATED model's table and points back to THIS model,
 * so the column is named after the self model class.
 *
 * @param selfModelName - The owning model's class name (e.g. `User`)
 *
 * @example
 * inferHasForeignKey("User")    // "user_id"     — used as posts.user_id
 * inferHasForeignKey("AIModel") // "ai_model_id" — used as ai_trips.ai_model_id
 */
export function inferHasForeignKey(
  selfModelName: string,
  options?: KeyConventionOptions,
): string {
  return keyName(selfModelName, options);
}

/**
 * Default column name in a many-to-many pivot table for either side
 * (the side referenced determines the model name passed in).
 *
 * - For the self-side pivot column: pass the self model name.
 * - For the related-side pivot column: pass the related model name.
 *
 * @param modelName - The model class name being referenced from the pivot
 *
 * @example
 * // For `Post.belongsToMany("Tag", { pivot: "post_tags" })`:
 * inferPivotKey("Post") // "post_id" — pivot column post_tags.post_id
 * inferPivotKey("Tag")  // "tag_id"  — pivot column post_tags.tag_id
 */
export function inferPivotKey(modelName: string, options?: KeyConventionOptions): string {
  return keyName(modelName, options);
}

/**
 * Default pivot-table name for a many-to-many relation when none is
 * explicitly configured. Joins the two model snake-names alphabetically
 * with an underscore — matches Laravel/Rails convention.
 *
 * Alphabetical ordering means the same pivot name resolves regardless of
 * which side of the relation declares the `@BelongsToMany`, so
 * `Post.belongsToMany("Tag")` and `Tag.belongsToMany("Post")` both pick
 * the table `post_tag`.
 *
 * @example
 * inferPivotTable("Post", "Tag")         // "post_tag"
 * inferPivotTable("User", "Group")       // "group_user"
 * inferPivotTable("AIModel", "Tenant")   // "ai_model_tenant"
 */
export function inferPivotTable(
  selfModelName: string,
  relatedModelName: string,
  options?: RelationDefaults,
): string {
  const selfSnake = snake(selfModelName);
  const relatedSnake = snake(relatedModelName);
  const order = options?.pivotTableNamingOrder ?? DEFAULT_PIVOT_ORDER;

  if (order === "owner_first") {
    return `${selfSnake}_${relatedSnake}`;
  }

  return [selfSnake, relatedSnake].sort().join("_");
}
