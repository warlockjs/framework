import { RepositoryAdapterContract } from "./contracts/repository-adapter.contract.mjs";
import { AllRepositoryOptions, ChunkCallback, CursorPaginationResult, FilterRules, PaginationResult, RepositoryOptions, SaveMode, TypedAllRepositoryOptions, TypedRepositoryOptions, TypedRepositoryOptionsWithCursor, TypedRepositoryOptionsWithPages } from "./contracts/types.mjs";
import { QueryBuilderContract } from "./contracts/query-builder.contract.mjs";
import { CacheDriver, CacheKey } from "@warlock.js/cache";

//#region ../../@warlock.js/core/src/repositories/repository.manager.d.ts
/**
 * Base repository manager class
 * Provides ORM-agnostic data access layer with support for listing, filtering,
 * caching, pagination, and CRUD operations
 *
 * @template T - The type of records managed by this repository
 *
 * @example
 * // Extend with source
 * class UserRepository extends RepositoryManager<User> {
 *   protected source = User;
 *   protected filterBy = { email: "=", role: ["in", "role"] };
 * }
 *
 * @example
 * // Direct instantiation with adapter
 * const userRepo = new RepositoryManager<User>(new PrismaAdapter(prisma.user));
 */
declare class RepositoryManager<T = unknown, F = Record<string, any>> {
  /**
   * Adapter instance (lazy-loaded)
   * @private
   */
  protected _adapter?: RepositoryAdapterContract<T>;
  /**
   * Data source reference (Model, Prisma client, table name, etc.)
   * Used by createDefaultAdapter to instantiate the appropriate adapter
   * @protected
   */
  protected source?: any;
  /**
   * Filter definitions
   * Maps filter keys to filter rules
   * @protected
   */
  protected filterBy: FilterRules;
  /**
   * Get adapter instance (lazy-loaded)
   * Resolution order:
   * 1. Use injected adapter from constructor
   * 2. Use config-based resolver if available
   * 3. Use createDefaultAdapter
   *
   * @returns Adapter instance
   * @protected
   */
  protected get adapter(): RepositoryAdapterContract<T>;
  /**
   * Default repository options
   * @protected
   */
  protected defaultOptions: Partial<RepositoryOptions>;
  /**
   * Simple select columns (used with simple filter)
   * @protected
   */
  protected simpleSelectColumns: string[];
  /**
   * Active column name
   * @default "isActive"
   * @protected
   */
  protected isActiveColumn?: string;
  /**
   * Active column value
   * @default true
   * @protected
   */
  protected isActiveValue?: any;
  /**
   * Repository name (for events)
   * @protected
   */
  protected name?: string;
  /**
   * Whether caching is enabled
   * @default true
   * @protected
   */
  protected isCacheable: any;
  /**
   * Cache driver instance
   * @protected
   */
  protected cacheDriver: CacheDriver<any, any>;
  /**
   * List of all events callbacks
   */
  protected eventsCallbacks: any[];
  /**
   * Constructor
   * @param adapter - Optional adapter instance for direct injection
   */
  constructor(adapter?: RepositoryAdapterContract<T>);
  /**
   * Register events
   */
  registerEvents(): void;
  /**
   * Unregister events
   */
  cleanuEvents(): void;
  /**
   * Create default adapter instance
   * Override this method to provide custom adapter creation logic
   *
   * @returns Adapter instance
   * @throws Error if no source is configured
   * @protected
   */
  protected createDefaultAdapter(): RepositoryAdapterContract<T>;
  /**
   * Get repository name
   * @returns Repository name
   * @public
   */
  getName(): string;
  /**
   * Get is active column
   */
  protected getIsActiveColumn(): string;
  /**
   * Get is active value
   */
  protected getIsActiveValue(): any;
  /**
   * Create new query builder instance
   * @returns Query builder
   * @public
   */
  newQuery(): QueryBuilderContract<T>;
  /**
   * Create new model instance
   * @param data - Model data
   * @returns Model instance
   * @public
   */
  newModel(data?: any): T;
  /**
   * Get active filter object
   * @returns Filter object for active records
   * @protected
   */
  protected getIsActiveFilter(): {
    [x: string]: any;
  };
  /**
   * Find a record by ID
   * @param id - Record ID or model instance
   * @returns Promise resolving to record or null
   * @public
   */
  find(id: string | number | T): Promise<T | null>;
  /**
   * Find a record by column value
   * @param column - Column name
   * @param value - Value to search for
   * @returns Promise resolving to record or null
   * @public
   */
  findBy(column: string, value: any): Promise<T | null>;
  /**
   * Find active record by ID
   * @param id - Record ID or model instance
   * @returns Promise resolving to active record or null
   * @public
   */
  findActive(id: string | number | T): Promise<T | null>;
  /**
   * Find active record by column value
   * @param column - Column name
   * @param value - Value to search for
   * @returns Promise resolving to active record or null
   * @public
   */
  findByActive(column: string, value: any): Promise<T | null>;
  /**
   * Get first record matching options
   * @param options - Repository options
   * @returns Promise resolving to first record or null
   * @public
   */
  first(options?: TypedRepositoryOptions<F>): Promise<T | null>;
  /**
   * Get id by the given filter
   */
  firstId(options?: TypedRepositoryOptions<F>): Promise<string | number | undefined>;
  /**
   * Get first active id
   */
  firstActiveId(options?: TypedRepositoryOptions<F>): Promise<string | number | undefined>;
  /**
   * Get first cached id
   */
  firstCachedId(options?: TypedRepositoryOptions<F>): Promise<string | number | undefined>;
  /**
   * Get first active cached id
   */
  firstActiveCachedId(options?: TypedRepositoryOptions<F>): Promise<string | number | undefined>;
  /**
   * Get first uuid
   */
  firstUuid(options?: TypedRepositoryOptions<F>): Promise<string | undefined>;
  /**
   * Get first active uuid
   */
  firstActiveUuid(options?: TypedRepositoryOptions<F>): Promise<string | undefined>;
  /**
   * Get first cached uuid
   */
  firstCachedUuid(options?: TypedRepositoryOptions<F>): Promise<string | undefined>;
  /**
   * Get first active cached uuid
   */
  firstActiveCachedUuid(options?: TypedRepositoryOptions<F>): Promise<string | undefined>;
  /**
   * Get first cached record
   */
  firstCached(options?: TypedRepositoryOptions<F>): Promise<T | null>;
  /**
   * Get first active record
   * @param options - Repository options
   * @returns Promise resolving to first active record or null
   * @public
   */
  firstActive(options?: TypedRepositoryOptions<F>): Promise<T | null>;
  /**
   * Get first active cached record
   * @param options - Repository options
   * @returns Promise resolving to first active cached record or null
   * @public
   */
  firstActiveCached(options?: TypedRepositoryOptions<F>): Promise<T | null>;
  /**
   * Get last record matching options
   * @param options - Repository options
   * @returns Promise resolving to last record or null
   * @public
   */
  last(options?: TypedRepositoryOptions<F>): Promise<T | null>;
  /**
   * Get last cached record
   */
  lastCached(options?: TypedRepositoryOptions<F>): Promise<T | null>;
  /**
   * Get last active record
   * @param options - Repository options
   * @returns Promise resolving to last active record or null
   * @public
   */
  lastActive(options?: TypedRepositoryOptions<F>): Promise<T | null>;
  /**
   * Get last active cached record
   * @param options - Repository options
   * @returns Promise resolving to last active cached record or null
   * @public
   */
  lastActiveCached(options?: TypedRepositoryOptions<F>): Promise<T | null>;
  /**
   * List records with pagination
   * Supports both traditional page-based and cursor-based pagination
   *
   * @param options - Repository options
   * @returns Promise resolving to pagination result
   *
   * @example
   * // Traditional pagination (default)
   * const result = await repo.list({ page: 2, limit: 10 });
   *
   * @example
   * // Cursor pagination
   * const result = await repo.list({
   *   paginationMode: "cursor",
   *   limit: 20,
   *   cursor: lastId,
   *   direction: "next"
   * });
   *
   * @public
   */
  list(options?: TypedRepositoryOptionsWithPages<F>): Promise<PaginationResult<T>>;
  list(options: TypedRepositoryOptionsWithCursor<F>): Promise<CursorPaginationResult<T>>;
  /**
   * Internal list implementation - no overloads, handles union type
   * @param options - Repository options
   * @returns Promise resolving to pagination result
   * @private
   */
  private _listImpl;
  /**
   * List all records without pagination
   * @param options - Repository options
   * @returns Promise resolving to array of records
   * @public
   */
  all(options?: TypedAllRepositoryOptions<F>): Promise<T[]>;
  /**
   * List active records with pagination
   * Supports both page-based and cursor-based pagination
   *
   * @param options - Repository options
   * @returns Promise resolving to pagination result
   * @public
   */
  listActive(options?: TypedRepositoryOptionsWithPages<F>): Promise<PaginationResult<T>>;
  listActive(options: TypedRepositoryOptionsWithCursor<F>): Promise<CursorPaginationResult<T>>;
  /**
   * List all active records without pagination
   * @param options - Repository options
   * @returns Promise resolving to array of active records
   * @public
   */
  allActive(options?: TypedAllRepositoryOptions<F>): Promise<T[]>;
  /**
   * Check if record exists matching filter
   * @param filter - Repository options
   * @returns Promise resolving to true if exists
   * @public
   */
  exists(filter?: TypedRepositoryOptions<F>): Promise<boolean>;
  /**
   * Check if active record exists matching filter
   * @param filter - Repository options
   * @returns Promise resolving to true if active record exists
   * @public
   */
  existsActive(filter?: TypedRepositoryOptions<F>): Promise<boolean>;
  /**
   * Check if record exists by ID
   * @param id - Record ID
   * @returns Promise resolving to true if exists
   * @public
   */
  idExists(id: number | string): Promise<boolean>;
  /**
   * Check if active record exists by ID
   * @param id - Record ID
   * @returns Promise resolving to true if active record exists
   * @public
   */
  idExistsActive(id: number | string): Promise<boolean>;
  /**
   * Prepare options — merges defaultOptions with caller options.
   * Returning as TypedRepositoryOptions<F> ensures internal composition
   * (spread + forward) satisfies the typed public API without per-call casts.
   */
  protected prepareOptions(options?: TypedRepositoryOptions<F>): TypedRepositoryOptions<F>;
  /**
   * Cast a plain `RepositoryOptions` spread to the typed variant.
   * Used internally when composing options across method calls where the
   * spread breaks the F-generic inference chain.
   */
  protected asTyped(opts: RepositoryOptions): TypedRepositoryOptions<F>;
  protected asTypedAll(opts: AllRepositoryOptions): TypedAllRepositoryOptions<F>;
  /**
   * Apply repository options to query
   * @param query - Query builder instance
   * @param options - Repository options
   * @protected
   */
  protected applyOptionsToQuery(query: QueryBuilderContract<T>, options: RepositoryOptions): RepositoryOptions;
  /**
   * Create a new record
   * @param data - Record data
   * @returns Promise resolving to created record
   * @public
   */
  create(data: any): Promise<T>;
  /**
   * Update a record by ID
   * @param id - Record ID
   * @param data - Updated data
   * @returns Promise resolving to updated record
   * @public
   */
  update(id: string | number | any, data: any): Promise<T>;
  /**
   * Delete a record by ID
   * @param id - Record ID
   * @returns Promise that resolves when deletion is complete
   * @public
   */
  delete(id: string | number): Promise<void>;
  /**
   * Update multiple records matching filter
   * @param filter - Filter criteria
   * @param data - Updated data
   * @returns Promise resolving to number of updated records
   * @public
   */
  updateMany(filter: any, data: any): Promise<number>;
  /**
   * Delete multiple records matching filter
   * @param filter - Filter criteria
   * @returns Promise resolving to number of deleted records
   * @public
   */
  deleteMany(filter: any): Promise<number>;
  /**
   * Process records in chunks
   * @param size - Chunk size
   * @param callback - Function called for each chunk
   * @param options - Repository options
   * @returns Promise that resolves when chunking is complete
   * @public
   */
  chunk(size: number, callback: ChunkCallback<T>, options?: TypedRepositoryOptions<F>): Promise<void>;
  /**
   * Process active records in chunks
   * @param size - Chunk size
   * @param callback - Function called for each chunk
   * @param options - Repository options
   * @returns Promise that resolves when chunking is complete
   * @public
   */
  chunkActive(size: number, callback: ChunkCallback<T>, options?: TypedRepositoryOptions<F>): Promise<void>;
  /**
   * Get latest records (ordered by ID descending)
   * Supports both pagination modes
   *
   * @param options - Repository options
   * @returns Promise resolving to pagination result
   * @public
   */
  latest(options?: TypedRepositoryOptionsWithPages<F>): Promise<PaginationResult<T>>;
  latest(options: TypedRepositoryOptionsWithCursor<F>): Promise<CursorPaginationResult<T>>;
  /**
   * Get oldest records (ordered by ID ascending)
   * Supports both pagination modes
   *
   * @param options - Repository options
   * @returns Promise resolving to pagination result
   * @public
   */
  oldest(options?: TypedRepositoryOptionsWithPages<F>): Promise<PaginationResult<T>>;
  oldest(options: TypedRepositoryOptionsWithCursor<F>): Promise<CursorPaginationResult<T>>;
  /**
   * Get latest active records
   * Supports both pagination modes
   *
   * @param options - Repository options
   * @returns Promise resolving to pagination result
   * @public
   */
  latestActive(options?: TypedRepositoryOptionsWithPages<F>): Promise<PaginationResult<T>>;
  latestActive(options: TypedRepositoryOptionsWithCursor<F>): Promise<CursorPaginationResult<T>>;
  /**
   * Get oldest active records
   * Supports both pagination modes
   *
   * @param options - Repository options
   * @returns Promise resolving to pagination result
   * @public
   */
  oldestActive(options?: TypedRepositoryOptionsWithPages<F>): Promise<PaginationResult<T>>;
  oldestActive(options: TypedRepositoryOptionsWithCursor<F>): Promise<CursorPaginationResult<T>>;
  /**
   * Called before listing records
   * @param options - Repository options
   * @protected
   */
  protected beforeListing(options: any): Promise<void>;
  /**
   * Called after listing records
   * @param result - Pagination result
   * @param options - Repository options
   * @protected
   */
  protected onList(result: PaginationResult<T>, options: any): Promise<void>;
  /**
   * Called before creating a record
   * @param data - Record data
   * @protected
   */
  protected onCreating(data: any): Promise<void>;
  /**
   * Called after creating a record
   * @param record - Created record
   * @param data - Original data
   * @protected
   */
  protected onCreate(record: T, data: any): Promise<void>;
  /**
   * Called before updating a record
   * @param id - Record ID
   * @param data - Updated data
   * @protected
   */
  protected onUpdating(id: string | number, data: any): Promise<void>;
  /**
   * Called after updating a record
   * @param record - Updated record
   * @param data - Original data
   * @protected
   */
  protected onUpdate(record: T, data: any): Promise<void>;
  /**
   * Called before saving a record (create or update)
   * @param data - Record data
   * @param mode - Save mode
   * @protected
   */
  protected onSaving(data: any, mode: SaveMode): Promise<void>;
  /**
   * Called after saving a record (create or update)
   * @param record - Saved record
   * @param data - Original data
   * @param mode - Save mode
   * @protected
   */
  protected onSave(record: T, data: any, mode: SaveMode): Promise<void>;
  /**
   * Called before deleting a record
   * @param id - Record ID
   * @protected
   */
  protected onDeleting(id: string | number): Promise<void>;
  /**
   * Called after deleting a record
   * @param id - Record ID
   * @protected
   */
  protected onDelete(id: string | number): Promise<void>;
  /**
   * Count total records matching options
   * @param options - Repository options
   * @returns Promise resolving to count
   * @public
   */
  count(options?: TypedRepositoryOptions<F>): Promise<number>;
  /**
   * Count total active records
   * @param options - Repository options
   * @returns Promise resolving to count of active records
   * @public
   */
  countActive(options?: TypedRepositoryOptions<F>): Promise<number>;
  /**
   * Count records with caching
   * @param options - Repository options
   * @returns Promise resolving to cached count
   * @public
   */
  countCached(options?: TypedRepositoryOptions<F>): Promise<number>;
  /**
   * Count active records with caching
   * @param options - Repository options
   * @returns Promise resolving to cached count of active records
   * @public
   */
  countActiveCached(options?: TypedRepositoryOptions<F>): Promise<number>;
  /**
   * Set cache driver
   * @param driver - Cache driver instance
   * @returns This repository for chaining
   * @public
   */
  setCacheDriver(driver: any): this;
  /**
   * Get cache driver
   * @returns Cache driver instance
   * @public
   */
  getCacheDriver(): any;
  /**
   * Generate cache key
   * @param key - Base key or object
   * @param moreOptions - Additional options for key
   * @returns Generated cache key
   * @protected
   */
  protected cacheKey(key: string | Record<string, any>, moreOptions?: Record<string, any>): string;
  /**
   * Cache a value
   * @param key - Cache key
   * @param value - Value to cache
   * @protected
   */
  protected cache(key: string, value: any): Promise<void>;
  /**
   * Get cached record by ID
   * @param id - Record ID
   * @returns Promise resolving to cached record or null
   * @public
   */
  getCached(id: string | number): Promise<T | null>;
  /**
   * @alias getCached
   */
  findCached(id: string | number): Promise<T | null>;
  /**
   * Get cached record by column value
   * @param column - Column name
   * @param value - Column value
   * @param cacheKeyOptions - Additional cache key options
   * @returns Promise resolving to cached record or undefined
   * @public
   */
  getCachedBy(column: string, value: any, cacheKeyOptions?: Record<string, any>): Promise<T | null>;
  /**
   * Get all cached records
   * @param options - Repository options
   * @returns Promise resolving to array of cached records
   * @public
   */
  allCached(options?: TypedAllRepositoryOptions<F>): Promise<T[]>;
  /**
   * Get all active cached records
   * @param options - Repository options
   * @returns Promise resolving to array of cached active records
   * @public
   */
  allActiveCached(options?: TypedAllRepositoryOptions<F>): Promise<T[]>;
  /**
   * List cached records with pagination
   * @param options - Repository options
   * @returns Promise resolving to cached pagination result
   * @public
   */
  listCached(options?: TypedRepositoryOptions<F>): Promise<PaginationResult<T>>;
  /**
   * List active cached records with pagination
   * @param options - Repository options
   * @returns Promise resolving to cached pagination result of active records
   * @public
   */
  listActiveCached(options?: TypedRepositoryOptions<F>): Promise<PaginationResult<T>>;
  /**
   * Get active cached record by ID
   * @param id - Record ID
   * @returns Promise resolving to cached active record or undefined
   * @public
   */
  getActiveCached(id: string | number): Promise<T | undefined>;
  /**
   * Cache a model
   * @param model - Model to cache
   * @public
   */
  cacheModel(model: T): Promise<void>;
  /**
   * Cleanup all events and cache as well
   * Please note this is mostly used with development server to be
   * exported as cleanup
   *
   * @example
   * ```typescript
   */
  cleanup(): void;
  /**
   * Cleanup all events and cache as well
   * Please note this is mostly used with development server to be
   * exported as cleanup
   * export const cleanup = usersRepository.cleanup.bind(usersRepository);
   */
  $cleanup(): void;
  /**
   * Clear all cache for this repository
   * @public
   */
  clearCache(key?: CacheKey): Promise<void>;
  /**
   * Clear cache for specific model
   * @param model - Model to clear cache for
   * @public
   */
  clearModelCache(model: T): Promise<void>;
  /**
   * Map documents to models
   * @param documents - Array of document data
   * @returns Array of model instances
   * @protected
   */
  protected mapModels(documents: any[]): T[];
  /**
   * Find or create a record
   * @param where - Conditions to find by
   * @param data - Data to create if not found
   * @returns Promise resolving to found or created record
   * @public
   */
  findOrCreate(where: TypedRepositoryOptions<F>, data: Record<string, any>): Promise<T>;
  /**
   * Update or create a record
   * @param where - Conditions to find by
   * @param data - Data to update or create
   * @returns Promise resolving to updated or created record
   * @public
   */
  updateOrCreate(where: TypedRepositoryOptions<F>, data: Record<string, any>): Promise<T>;
}
//#endregion
export { RepositoryManager };
//# sourceMappingURL=repository.manager.d.mts.map