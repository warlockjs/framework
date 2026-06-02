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
import type { RelationDefaults } from "../types";
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
export declare function inferBelongsToForeignKey(relationName: string, options?: RelationDefaults): string;
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
export declare function inferHasForeignKey(selfModelName: string, options?: RelationDefaults): string;
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
export declare function inferPivotKey(modelName: string, options?: RelationDefaults): string;
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
export declare function inferPivotTable(selfModelName: string, relatedModelName: string, options?: RelationDefaults): string;
//# sourceMappingURL=key-conventions.d.ts.map