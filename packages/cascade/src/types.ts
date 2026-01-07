/**
 * Strict mode configuration for handling unknown fields during validation.
 *
 * Controls how the model behaves when encountering fields not defined in the schema.
 *
 * - `"strip"` - Remove unknown fields silently (default, recommended for APIs)
 * - `"fail"` - Throw validation error on unknown fields (strict validation)
 * - `"allow"` - Allow unknown fields to pass through (permissive)
 *
 * @example
 * ```typescript
 * import { Model, type StrictMode } from "@warlock.js/cascade";
 *
 * class User extends Model {
 *   public static strictMode: StrictMode = "fail";
 * }
 * ```
 */
export type StrictMode = "strip" | "fail" | "allow";

/**
 * Delete strategy for model destruction.
 *
 * Controls how models are deleted from the database:
 *
 * - `"trash"` - Moves document to a trash/recycle bin collection, then deletes
 * - `"permanent"` - Actually deletes the document from the database (hard delete)
 * - `"soft"` - Sets a `deletedAt` timestamp instead of deleting (soft delete)
 *
 * Priority order (highest to lowest):
 * 1. destroy() method options
 * 2. Model static property (deleteStrategy)
 * 3. Data source default configuration
 *
 * @example
 * ```typescript
 * class User extends Model {
 *   public static deleteStrategy: DeleteStrategy = "soft";
 * }
 *
 * // Override at call time
 * await user.destroy({ strategy: "permanent" });
 * ```
 */
export type DeleteStrategy = "trash" | "permanent" | "soft";
