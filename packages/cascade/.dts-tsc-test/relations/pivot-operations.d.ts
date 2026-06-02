/**
 * @fileoverview Pivot table operations for many-to-many relationships.
 *
 * This module provides methods for managing the pivot table in
 * belongsToMany relationships: attach, detach, sync, and toggle.
 *
 * @module @warlock.js/cascade/relations/pivot-operations
 */
import type { ChildModel, Model } from "../model/model";
import type { PivotData, PivotIds, RelationDefinition } from "./types";
/**
 * Manages pivot table operations for many-to-many relationships.
 *
 * Provides attach, detach, sync, and toggle operations for managing
 * the connections between two models through a pivot table.
 *
 * @example
 * ```typescript
 * const pivotOps = new PivotOperations(post, "tags", tagsDefinition);
 *
 * // Attach tags
 * await pivotOps.attach([1, 2, 3]);
 *
 * // Attach with pivot data
 * await pivotOps.attach([4], { addedBy: userId });
 *
 * // Detach specific tags
 * await pivotOps.detach([2]);
 *
 * // Sync (replace all)
 * await pivotOps.sync([1, 5, 6]);
 *
 * // Toggle (attach if missing, detach if present)
 * await pivotOps.toggle([1, 7]);
 * ```
 */
export declare class PivotOperations {
    /**
     * The model instance performing the pivot operation.
     */
    private readonly model;
    /**
     * The name of the relation.
     */
    private readonly relationName;
    /**
     * The relation definition with pivot table configuration.
     */
    private readonly definition;
    /**
     * The model class of the source model.
     */
    private readonly modelClass;
    /**
     * Creates a new PivotOperations instance.
     *
     * @param model - The model instance performing the operation
     * @param relationName - The name of the belongsToMany relation
     * @param definition - The relation definition
     * @param modelClass - The model class constructor
     */
    constructor(model: Model, relationName: string, definition: RelationDefinition, modelClass: ChildModel<Model>);
    /**
     * Read the configured relation conventions from this pivot's owning
     * data source. Returns `undefined` when no overrides are set.
     */
    private get relationDefaults();
    /**
     * Attaches one or more related models via the pivot table.
     *
     * Creates new records in the pivot table linking this model to the
     * specified related model IDs. Existing attachments are not duplicated.
     *
     * @param ids - The IDs of the related models to attach
     * @param pivotData - Optional additional data to store in the pivot record
     *
     * @example
     * ```typescript
     * // Attach tags to a post
     * await post.attach("tags", [1, 2, 3]);
     *
     * // Attach with additional pivot data
     * await post.attach("tags", [4], { addedBy: currentUserId });
     * ```
     */
    attach(ids: PivotIds, pivotData?: PivotData): Promise<void>;
    /**
     * Detaches one or more related models from the pivot table.
     *
     * Removes records from the pivot table. If no IDs are specified,
     * all attachments for this model are removed.
     *
     * @param ids - Optional IDs to detach. If omitted, detaches all.
     *
     * @example
     * ```typescript
     * // Detach specific tags
     * await post.detach("tags", [2, 3]);
     *
     * // Detach all tags
     * await post.detach("tags");
     * ```
     */
    detach(ids?: PivotIds): Promise<void>;
    /**
     * Synchronizes the pivot table to match the specified IDs.
     *
     * Attaches any new IDs and detaches any IDs not in the list.
     * After sync, the pivot table will contain exactly the specified IDs.
     *
     * @param ids - The IDs that should be attached after sync
     * @param pivotData - Optional data for newly attached records
     *
     * @example
     * ```typescript
     * // Set tags to exactly [1, 3, 5], removing any others
     * await post.sync("tags", [1, 3, 5]);
     * ```
     */
    sync(ids: PivotIds, pivotData?: PivotData): Promise<void>;
    /**
     * Toggles the attachment status of the specified IDs.
     *
     * For each ID: if attached, detaches it; if not attached, attaches it.
     *
     * @param ids - The IDs to toggle
     * @param pivotData - Optional data for newly attached records
     *
     * @example
     * ```typescript
     * // Toggle tags - attached become detached, detached become attached
     * await post.toggle("tags", [1, 4]);
     * ```
     */
    toggle(ids: PivotIds, pivotData?: PivotData): Promise<void>;
    /**
     * Gets the pivot table configuration.
     *
     * @returns The pivot configuration object
     */
    private getPivotConfig;
    /**
     * Gets all currently attached IDs from the pivot table.
     *
     * @returns A set of attached foreign key values
     */
    private getExistingPivotIds;
}
/**
 * Creates a PivotOperations instance for a model and relation.
 *
 * @param model - The model instance
 * @param relationName - The name of the belongsToMany relation
 * @returns A PivotOperations instance
 * @throws Error if the relation is not a belongsToMany or not defined
 */
export declare function createPivotOperations(model: Model, relationName: string): PivotOperations;
//# sourceMappingURL=pivot-operations.d.ts.map