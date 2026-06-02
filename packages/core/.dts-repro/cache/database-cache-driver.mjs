import { Model } from "@warlock.js/cascade";
import { BaseCacheDriver } from "@warlock.js/cache";
//#region ../../@warlock.js/core/src/cache/database-cache-driver.ts
var CacheModel = class extends Model {
	static {
		this.table = "cache";
	}
};
var DatabaseCacheDriver = class extends BaseCacheDriver {
	constructor(..._args) {
		super(..._args);
		this.name = "database";
	}
	/**
	* {@inheritdoc}
	*/
	setOptions(options) {
		super.setOptions(options);
		this.model = options.model ?? CacheModel;
		return this;
	}
	/**
	* {@inheritdoc}
	*/
	async removeNamespace(namespace) {
		this.log("clearing", namespace);
		namespace = this.parseKey(namespace);
		await this.model.delete({ namespace });
		this.log("cleared", namespace);
		return this;
	}
	/**
	* {@inheritdoc}
	*/
	async set(key, value, ttl) {
		const parsedKey = this.parseKey(key);
		this.log("caching", parsedKey);
		if (ttl === void 0) ttl = this.ttl;
		const namespace = parsedKey.split(".").slice(0, -1).join(".") || parsedKey;
		let cacheEntry = await this.model.first({ key: parsedKey });
		if (cacheEntry) {
			cacheEntry.set("namespace", namespace);
			cacheEntry.set("data", value);
			cacheEntry.set("ttl", ttl);
			cacheEntry.set("expiresAt", this.getExpiresAt(ttl) || null);
			await cacheEntry.save();
		} else await this.model.create({
			key: parsedKey,
			namespace,
			data: value,
			ttl,
			expiresAt: this.getExpiresAt(ttl) || null
		});
		this.log("cached", parsedKey);
		return this;
	}
	/**
	* {@inheritdoc}
	*/
	async get(key) {
		const parsedKey = this.parseKey(key);
		this.log("fetching", parsedKey);
		const model = await this.model.first({ key: parsedKey });
		if (!model) {
			this.log("notFound", parsedKey);
			return null;
		}
		const data = {
			data: model.get("data"),
			expiresAt: model.get("expiresAt"),
			ttl: model.get("ttl")
		};
		return this.parseCachedData(parsedKey, data);
	}
	/**
	* {@inheritdoc}
	*/
	async remove(key) {
		const parsedKey = this.parseKey(key);
		this.log("removing", parsedKey);
		await this.model.delete({ key: parsedKey });
		this.log("removed", parsedKey);
	}
	/**
	* {@inheritdoc}
	*/
	async flush() {
		this.log("flushing");
		if (this.options.globalPrefix) this.removeNamespace("");
		else await this.model.delete();
		this.log("flushed");
	}
};
//#endregion
export { DatabaseCacheDriver };

//# sourceMappingURL=database-cache-driver.mjs.map