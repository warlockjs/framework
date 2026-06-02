import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
import { CascadeAdapter } from "./adapters/cascade/cascade-adapter.mjs";
import "./adapters/cascade/index.mjs";
import { cache } from "@warlock.js/cache";
//#region ../../@warlock.js/core/src/repositories/repository.manager.ts
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
var RepositoryManager = class {
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
	get adapter() {
		if (this._adapter) return this._adapter;
		const resolver = config.key("repository.adapterResolver");
		if (resolver) this._adapter = resolver(this);
		else this._adapter = config.get("repository.defaultAdapter") || this.createDefaultAdapter();
		return this._adapter;
	}
	/**
	* Constructor
	* @param adapter - Optional adapter instance for direct injection
	*/
	constructor(adapter) {
		this.filterBy = {};
		this.defaultOptions = config.get("repository.defaultOptions") || {};
		this.simpleSelectColumns = [];
		this.isCacheable = config.get("repository.isCacheable") ?? true;
		this.cacheDriver = config.get("repository.cacheDriver") || cache;
		this.eventsCallbacks = [];
		if (adapter) this._adapter = adapter;
		setTimeout(() => {
			this.registerEvents();
		}, 0);
	}
	/**
	* Register events
	*/
	registerEvents() {
		this.eventsCallbacks.push(...this.adapter.registerEvents((source) => {
			this.clearCache();
		}));
	}
	/**
	* Unregister events
	*/
	cleanuEvents() {
		this.eventsCallbacks.forEach((callback) => {
			callback();
		});
		this.eventsCallbacks = [];
	}
	/**
	* Create default adapter instance
	* Override this method to provide custom adapter creation logic
	*
	* @returns Adapter instance
	* @throws Error if no source is configured
	* @protected
	*/
	createDefaultAdapter() {
		if (!this.source) throw new Error("No adapter or source configured. Either pass an adapter to the constructor, set the 'source' property, or configure 'repository.adapterResolver' in config.");
		if (typeof this.source === "function") return new CascadeAdapter(this.source);
		throw new Error("Cannot create default adapter for this source type. Please provide an adapter or configure repository.adapterResolver.");
	}
	/**
	* Get repository name
	* @returns Repository name
	* @public
	*/
	getName() {
		if (this.name) return this.name;
		this.name = this.adapter.resolveRepositoryName() || "unknown";
		return this.name;
	}
	/**
	* Get is active column
	*/
	getIsActiveColumn() {
		return this.isActiveColumn || config.key("repository.isActiveColumn") || "isActive";
	}
	/**
	* Get is active value
	*/
	getIsActiveValue() {
		return this.isActiveValue ?? config.key("repository.isActiveValue") ?? true;
	}
	/**
	* Create new query builder instance
	* @returns Query builder
	* @public
	*/
	newQuery() {
		return this.adapter.query();
	}
	/**
	* Create new model instance
	* @param data - Model data
	* @returns Model instance
	* @public
	*/
	newModel(data) {
		return this.adapter.createModel(data);
	}
	/**
	* Get active filter object
	* @returns Filter object for active records
	* @protected
	*/
	getIsActiveFilter() {
		return { [this.getIsActiveColumn()]: this.getIsActiveValue() };
	}
	/**
	* Find a record by ID
	* @param id - Record ID or model instance
	* @returns Promise resolving to record or null
	* @public
	*/
	async find(id) {
		return this.adapter.find(id);
	}
	/**
	* Find a record by column value
	* @param column - Column name
	* @param value - Value to search for
	* @returns Promise resolving to record or null
	* @public
	*/
	async findBy(column, value) {
		return this.adapter.findBy(column, value);
	}
	/**
	* Find active record by ID
	* @param id - Record ID or model instance
	* @returns Promise resolving to active record or null
	* @public
	*/
	async findActive(id) {
		return this.newQuery().where({
			id,
			...this.getIsActiveFilter()
		}).first();
	}
	/**
	* Find active record by column value
	* @param column - Column name
	* @param value - Value to search for
	* @returns Promise resolving to active record or null
	* @public
	*/
	async findByActive(column, value) {
		return this.newQuery().where({
			[column]: value,
			...this.getIsActiveFilter()
		}).first();
	}
	/**
	* Get first record matching options
	* @param options - Repository options
	* @returns Promise resolving to first record or null
	* @public
	*/
	async first(options) {
		const query = this.newQuery();
		const opts = this.prepareOptions(options);
		this.applyOptionsToQuery(query, opts);
		return query.limit(1).first();
	}
	/**
	* Get id by the given filter
	*/
	async firstId(options) {
		return (await this.first(options))?.id;
	}
	/**
	* Get first active id
	*/
	async firstActiveId(options) {
		return (await this.firstActive(options))?.id;
	}
	/**
	* Get first cached id
	*/
	async firstCachedId(options) {
		return (await this.firstCached(options))?.id;
	}
	/**
	* Get first active cached id
	*/
	async firstActiveCachedId(options) {
		return (await this.firstActiveCached(options))?.id;
	}
	/**
	* Get first uuid
	*/
	async firstUuid(options) {
		return (await this.first(options))?.uuid;
	}
	/**
	* Get first active uuid
	*/
	async firstActiveUuid(options) {
		return (await this.firstActive(options))?.uuid;
	}
	/**
	* Get first cached uuid
	*/
	async firstCachedUuid(options) {
		return (await this.firstCached(options))?.uuid;
	}
	/**
	* Get first active cached uuid
	*/
	async firstActiveCachedUuid(options) {
		return (await this.firstActiveCached(options))?.uuid;
	}
	/**
	* Get first cached record
	*/
	async firstCached(options) {
		return (await this.allCached({
			...options,
			limit: 1
		}))[0] || null;
	}
	/**
	* Get first active record
	* @param options - Repository options
	* @returns Promise resolving to first active record or null
	* @public
	*/
	async firstActive(options) {
		return this.first({
			...this.getIsActiveFilter(),
			...options
		});
	}
	/**
	* Get first active cached record
	* @param options - Repository options
	* @returns Promise resolving to first active cached record or null
	* @public
	*/
	async firstActiveCached(options) {
		return this.firstCached({
			...this.getIsActiveFilter(),
			...options
		});
	}
	/**
	* Get last record matching options
	* @param options - Repository options
	* @returns Promise resolving to last record or null
	* @public
	*/
	async last(options) {
		return this.first({
			orderBy: { id: "desc" },
			...options
		});
	}
	/**
	* Get last cached record
	*/
	async lastCached(options) {
		return (await this.allCached(this.asTypedAll({
			...options,
			limit: 1,
			orderBy: { id: "desc" }
		})))[0] || null;
	}
	/**
	* Get last active record
	* @param options - Repository options
	* @returns Promise resolving to last active record or null
	* @public
	*/
	async lastActive(options) {
		return this.last({
			...this.getIsActiveFilter(),
			...options
		});
	}
	/**
	* Get last active cached record
	* @param options - Repository options
	* @returns Promise resolving to last active cached record or null
	* @public
	*/
	async lastActiveCached(options) {
		return this.lastCached({
			...this.getIsActiveFilter(),
			...options
		});
	}
	async list(options) {
		return this._listImpl(options);
	}
	/**
	* Internal list implementation - no overloads, handles union type
	* @param options - Repository options
	* @returns Promise resolving to pagination result
	* @private
	*/
	async _listImpl(options) {
		const query = this.newQuery();
		const opts = this.prepareOptions(options);
		const paginationMode = opts.paginationMode || "pages";
		this.applyOptionsToQuery(query, opts);
		if (paginationMode === "cursor") return query.cursorPaginate({
			limit: opts.limit || opts.defaultLimit || 15,
			cursor: opts.cursor,
			direction: opts.direction,
			cursorColumn: opts.cursorColumn
		});
		const page = opts.page || 1;
		const limit = opts.limit || opts.defaultLimit || 15;
		return query.paginate(page, limit);
	}
	/**
	* List all records without pagination
	* @param options - Repository options
	* @returns Promise resolving to array of records
	* @public
	*/
	async all(options) {
		const query = this.newQuery();
		const opts = this.prepareOptions(options);
		this.applyOptionsToQuery(query, opts);
		return query.get();
	}
	async listActive(options) {
		return this._listImpl({
			...this.getIsActiveFilter(),
			...options
		});
	}
	/**
	* List all active records without pagination
	* @param options - Repository options
	* @returns Promise resolving to array of active records
	* @public
	*/
	async allActive(options) {
		return this.all(this.asTypedAll({
			...this.getIsActiveFilter(),
			...options
		}));
	}
	/**
	* Check if record exists matching filter
	* @param filter - Repository options
	* @returns Promise resolving to true if exists
	* @public
	*/
	async exists(filter) {
		return !!await this.first(filter);
	}
	/**
	* Check if active record exists matching filter
	* @param filter - Repository options
	* @returns Promise resolving to true if active record exists
	* @public
	*/
	async existsActive(filter) {
		return !!await this.firstActive(filter);
	}
	/**
	* Check if record exists by ID
	* @param id - Record ID
	* @returns Promise resolving to true if exists
	* @public
	*/
	async idExists(id) {
		return !!await this.find(id);
	}
	/**
	* Check if active record exists by ID
	* @param id - Record ID
	* @returns Promise resolving to true if active record exists
	* @public
	*/
	async idExistsActive(id) {
		return !!await this.findActive(id);
	}
	/**
	* Prepare options — merges defaultOptions with caller options.
	* Returning as TypedRepositoryOptions<F> ensures internal composition
	* (spread + forward) satisfies the typed public API without per-call casts.
	*/
	prepareOptions(options) {
		return {
			...this.defaultOptions || {},
			...options || {}
		};
	}
	/**
	* Cast a plain `RepositoryOptions` spread to the typed variant.
	* Used internally when composing options across method calls where the
	* spread breaks the F-generic inference chain.
	*/
	asTyped(opts) {
		return opts;
	}
	asTypedAll(opts) {
		return opts;
	}
	/**
	* Apply repository options to query
	* @param query - Query builder instance
	* @param options - Repository options
	* @protected
	*/
	applyOptionsToQuery(query, options) {
		if (options.paginationMode === "cursor") {
			const cursorColumn = options.cursorColumn ?? "id";
			const direction = options.direction ?? "next";
			if (options.cursor) query.where(cursorColumn, direction === "next" ? ">" : "<", options.cursor);
			query.orderBy(cursorColumn, direction === "next" ? "asc" : "desc");
			if (options.orderBy) {
				if ((Array.isArray(options.orderBy) ? [options.orderBy[0]] : typeof options.orderBy === "object" ? Object.keys(options.orderBy) : []).includes(cursorColumn)) {
					console.warn(`[Repository] orderBy on "${cursorColumn}" conflicts with cursorColumn and will be ignored. Cursor pagination owns the sort order for its cursor column.`);
					options = {
						...options,
						orderBy: void 0
					};
				}
			}
		}
		if (this.filterBy && Object.keys(this.filterBy).length > 0) query.applyFilters(this.filterBy, options, {
			dateFormat: "DD-MM-YYYY",
			dateTimeFormat: "DD-MM-YYYY HH:mm:ss"
		});
		if (options.select) query.select(options.select);
		if (options.deselect) query.deselect(options.deselect);
		if (options.simpleSelect && this.simpleSelectColumns.length > 0) query.select(this.simpleSelectColumns);
		if (options.orderBy) {
			if (options.orderBy === "random") query.random();
			else if (Array.isArray(options.orderBy)) query.orderBy(options.orderBy[0], options.orderBy[1]);
			else if (typeof options.orderBy === "object") query.sortBy(options.orderBy);
		}
		if (options.limit && options.paginate === false) query.limit(options.limit);
		if (options?.perform) options.perform(query, options);
		return options;
	}
	/**
	* Create a new record
	* @param data - Record data
	* @returns Promise resolving to created record
	* @public
	*/
	async create(data) {
		return this.adapter.create(data);
	}
	/**
	* Update a record by ID
	* @param id - Record ID
	* @param data - Updated data
	* @returns Promise resolving to updated record
	* @public
	*/
	async update(id, data) {
		return this.adapter.update(id, data);
	}
	/**
	* Delete a record by ID
	* @param id - Record ID
	* @returns Promise that resolves when deletion is complete
	* @public
	*/
	async delete(id) {
		return this.adapter.delete(id);
	}
	/**
	* Update multiple records matching filter
	* @param filter - Filter criteria
	* @param data - Updated data
	* @returns Promise resolving to number of updated records
	* @public
	*/
	async updateMany(filter, data) {
		return this.adapter.updateMany(filter, data);
	}
	/**
	* Delete multiple records matching filter
	* @param filter - Filter criteria
	* @returns Promise resolving to number of deleted records
	* @public
	*/
	async deleteMany(filter) {
		return this.adapter.deleteMany(filter);
	}
	/**
	* Process records in chunks
	* @param size - Chunk size
	* @param callback - Function called for each chunk
	* @param options - Repository options
	* @returns Promise that resolves when chunking is complete
	* @public
	*/
	async chunk(size, callback, options) {
		const query = this.newQuery();
		const opts = this.prepareOptions(options);
		this.applyOptionsToQuery(query, opts);
		return query.chunk(size, callback);
	}
	/**
	* Process active records in chunks
	* @param size - Chunk size
	* @param callback - Function called for each chunk
	* @param options - Repository options
	* @returns Promise that resolves when chunking is complete
	* @public
	*/
	async chunkActive(size, callback, options) {
		return this.chunk(size, callback, this.asTyped({
			...this.getIsActiveFilter(),
			...options
		}));
	}
	async latest(options) {
		return this._listImpl({
			orderBy: ["id", "desc"],
			...options
		});
	}
	async oldest(options) {
		return this._listImpl({
			orderBy: ["id", "asc"],
			...options
		});
	}
	async latestActive(options) {
		return this._listImpl({
			orderBy: ["id", "desc"],
			...this.getIsActiveFilter(),
			...options
		});
	}
	async oldestActive(options) {
		return this._listImpl({
			orderBy: ["id", "asc"],
			...this.getIsActiveFilter(),
			...options
		});
	}
	/**
	* Called before listing records
	* @param options - Repository options
	* @protected
	*/
	async beforeListing(options) {}
	/**
	* Called after listing records
	* @param result - Pagination result
	* @param options - Repository options
	* @protected
	*/
	async onList(result, options) {}
	/**
	* Called before creating a record
	* @param data - Record data
	* @protected
	*/
	async onCreating(data) {}
	/**
	* Called after creating a record
	* @param record - Created record
	* @param data - Original data
	* @protected
	*/
	async onCreate(record, data) {}
	/**
	* Called before updating a record
	* @param id - Record ID
	* @param data - Updated data
	* @protected
	*/
	async onUpdating(id, data) {}
	/**
	* Called after updating a record
	* @param record - Updated record
	* @param data - Original data
	* @protected
	*/
	async onUpdate(record, data) {}
	/**
	* Called before saving a record (create or update)
	* @param data - Record data
	* @param mode - Save mode
	* @protected
	*/
	async onSaving(data, mode) {}
	/**
	* Called after saving a record (create or update)
	* @param record - Saved record
	* @param data - Original data
	* @param mode - Save mode
	* @protected
	*/
	async onSave(record, data, mode) {}
	/**
	* Called before deleting a record
	* @param id - Record ID
	* @protected
	*/
	async onDeleting(id) {}
	/**
	* Called after deleting a record
	* @param id - Record ID
	* @protected
	*/
	async onDelete(id) {}
	/**
	* Count total records matching options
	* @param options - Repository options
	* @returns Promise resolving to count
	* @public
	*/
	async count(options) {
		const query = this.newQuery();
		const opts = this.prepareOptions(options);
		this.applyOptionsToQuery(query, opts);
		return await query.count();
	}
	/**
	* Count total active records
	* @param options - Repository options
	* @returns Promise resolving to count of active records
	* @public
	*/
	async countActive(options) {
		return await this.count(this.asTyped({
			...this.getIsActiveFilter(),
			...options
		}));
	}
	/**
	* Count records with caching
	* @param options - Repository options
	* @returns Promise resolving to cached count
	* @public
	*/
	async countCached(options) {
		if (!this.isCacheable || !this.cacheDriver) return await this.count(options);
		const opts = this.prepareOptions(options);
		const cacheKey = this.cacheKey("count", opts);
		let count = await this.cacheDriver.get(cacheKey);
		if (count !== void 0) return count;
		count = await this.count(options);
		await this.cache(cacheKey, count);
		return count;
	}
	/**
	* Count active records with caching
	* @param options - Repository options
	* @returns Promise resolving to cached count of active records
	* @public
	*/
	async countActiveCached(options) {
		return await this.countCached(this.asTyped({
			...this.getIsActiveFilter(),
			...options
		}));
	}
	/**
	* Set cache driver
	* @param driver - Cache driver instance
	* @returns This repository for chaining
	* @public
	*/
	setCacheDriver(driver) {
		this.cacheDriver = driver;
		return this;
	}
	/**
	* Get cache driver
	* @returns Cache driver instance
	* @public
	*/
	getCacheDriver() {
		return this.cacheDriver;
	}
	/**
	* Generate cache key
	* @param key - Base key or object
	* @param moreOptions - Additional options for key
	* @returns Generated cache key
	* @protected
	*/
	cacheKey(key, moreOptions) {
		let cacheKey = `repositories.${this.getName()}`;
		if (key) cacheKey += "." + (typeof key === "string" ? key : JSON.stringify(key));
		if (moreOptions) cacheKey += "." + JSON.stringify(moreOptions);
		return cacheKey;
	}
	/**
	* Cache a value
	* @param key - Cache key
	* @param value - Value to cache
	* @protected
	*/
	async cache(key, value) {
		if (!this.isCacheable || !this.cacheDriver) return;
		await this.cacheDriver.set(key, value);
	}
	/**
	* Get cached record by ID
	* @param id - Record ID
	* @returns Promise resolving to cached record or null
	* @public
	*/
	async getCached(id) {
		return await this.getCachedBy("id", id);
	}
	/**
	* @alias getCached
	*/
	async findCached(id) {
		return await this.getCachedBy("id", id);
	}
	/**
	* Get cached record by column value
	* @param column - Column name
	* @param value - Column value
	* @param cacheKeyOptions - Additional cache key options
	* @returns Promise resolving to cached record or undefined
	* @public
	*/
	async getCachedBy(column, value, cacheKeyOptions) {
		if (!this.isCacheable || !this.cacheDriver) return await this.findBy(column, value);
		const cacheKey = this.cacheKey(`${column}.${value}`, cacheKeyOptions);
		const cachedData = await this.cacheDriver.get(cacheKey);
		if (cachedData) return this.adapter.deserializeModel(cachedData);
		const model = await this.findBy(column, value);
		if (!model) return null;
		this.cache(cacheKey, this.adapter.serializeModel(model));
		return model;
	}
	/**
	* Get all cached records
	* @param options - Repository options
	* @returns Promise resolving to array of cached records
	* @public
	*/
	async allCached(options) {
		if (!this.isCacheable || !this.cacheDriver) return await this.all(options);
		const opts = this.prepareOptions(options);
		const cacheKey = this.cacheKey("all", opts);
		const cachedData = await this.cacheDriver.get(cacheKey);
		if (cachedData) return cachedData.map((record) => this.adapter.deserializeModel(record));
		const records = await this.all(options);
		await this.cache(cacheKey, records.map((record) => this.adapter.serializeModel(record)));
		return records;
	}
	/**
	* Get all active cached records
	* @param options - Repository options
	* @returns Promise resolving to array of cached active records
	* @public
	*/
	async allActiveCached(options) {
		return await this.allCached(this.asTypedAll({
			...this.getIsActiveFilter(),
			...options
		}));
	}
	/**
	* List cached records with pagination
	* @param options - Repository options
	* @returns Promise resolving to cached pagination result
	* @public
	*/
	async listCached(options) {
		if (!this.isCacheable || !this.cacheDriver) return await this._listImpl(options);
		const opts = this.prepareOptions(options);
		const cacheKey = this.cacheKey("list", opts);
		const cachedData = await this.cacheDriver.get(cacheKey);
		if (cachedData) return {
			data: (cachedData?.data || []).map((record) => this.adapter.deserializeModel(record)),
			pagination: cachedData.pagination
		};
		const result = await this._listImpl(options);
		await this.cache(cacheKey, {
			data: result.data.map((record) => this.adapter.serializeModel(record)),
			pagination: result.pagination
		});
		return result;
	}
	/**
	* List active cached records with pagination
	* @param options - Repository options
	* @returns Promise resolving to cached pagination result of active records
	* @public
	*/
	async listActiveCached(options) {
		return await this.listCached(this.asTyped({
			...this.getIsActiveFilter(),
			...options
		}));
	}
	/**
	* Get active cached record by ID
	* @param id - Record ID
	* @returns Promise resolving to cached active record or undefined
	* @public
	*/
	async getActiveCached(id) {
		const model = await this.getCached(id);
		if (!model) return void 0;
		if (typeof model.get === "function") return model.get(this.getIsActiveColumn()) === this.getIsActiveValue() ? model : void 0;
		return model[this.getIsActiveColumn()] === this.getIsActiveValue() ? model : void 0;
	}
	/**
	* Cache a model
	* @param model - Model to cache
	* @public
	*/
	async cacheModel(model) {
		if (!this.isCacheable || !this.cacheDriver) return;
		const id = model.id;
		if (!id) return;
		const cacheKey = this.cacheKey(`id.${id}`);
		await this.cache(cacheKey, this.adapter.serializeModel(model));
	}
	/**
	* Cleanup all events and cache as well
	* Please note this is mostly used with development server to be
	* exported as cleanup
	*
	* @example
	* ```typescript
	*/
	cleanup() {
		this.clearCache();
		this.cleanuEvents();
	}
	/**
	* Cleanup all events and cache as well
	* Please note this is mostly used with development server to be
	* exported as cleanup
	* export const cleanup = usersRepository.cleanup.bind(usersRepository);
	*/
	$cleanup() {
		this.cleanup();
		this.cacheDriver.flush();
	}
	/**
	* Clear all cache for this repository
	* @public
	*/
	async clearCache(key) {
		if (!this.isCacheable || !this.cacheDriver) return;
		await this.cacheDriver.removeNamespace(this.cacheKey(key || ""));
	}
	/**
	* Clear cache for specific model
	* @param model - Model to clear cache for
	* @public
	*/
	async clearModelCache(model) {
		if (!this.isCacheable || !this.cacheDriver) return;
		const id = model.id;
		if (!id) return;
		const cacheKey = this.cacheKey(`id.${id}`);
		await this.cacheDriver.removeNamespace(cacheKey);
	}
	/**
	* Map documents to models
	* @param documents - Array of document data
	* @returns Array of model instances
	* @protected
	*/
	mapModels(documents) {
		return documents.map((doc) => this.newModel(doc));
	}
	/**
	* Find or create a record
	* @param where - Conditions to find by
	* @param data - Data to create if not found
	* @returns Promise resolving to found or created record
	* @public
	*/
	async findOrCreate(where, data) {
		return await this.first(where) || await this.create(data);
	}
	/**
	* Update or create a record
	* @param where - Conditions to find by
	* @param data - Data to update or create
	* @returns Promise resolving to updated or created record
	* @public
	*/
	async updateOrCreate(where, data) {
		const model = await this.first(where);
		if (model) return await this.update(model, data);
		return await this.create(data);
	}
};
//#endregion
export { RepositoryManager };

//# sourceMappingURL=repository.manager.mjs.map