import {
  BaseCacheDriver,
  type CacheData,
  type CacheDriver,
  type CacheKey,
  type CacheSetOptions,
  type CacheTtl,
} from "@warlock.js/cache";
import { Model } from "@warlock.js/cascade";

export type DatabaseCacheOptions = {
  /**
   * Database model class
   */
  model?: typeof CacheModel;
  /**
   * Global prefix for the cache key
   */
  globalPrefix?: string | (() => string);
  /**
   * The default TTL for the cache in seconds
   *
   * @default Infinity
   */
  ttl?: number;
  /**
   * Write each entry with one upsert (`conflictColumns: ["key"]`) instead of a
   * read followed by an insert or update. Needs a unique index on the `key`
   * column of the cache table, which `cacheMigration` creates.
   *
   * Left unset, the driver looks for that index once and uses the upsert when
   * it exists; otherwise it reads, then inserts or updates, and logs a one-time
   * hint. `true` skips the lookup, `false` always reads first.
   *
   * @default detected
   */
  upsert?: boolean;
};

export class CacheModel extends Model {
  public static table = "cache";
}

let upsertHintShown = false;

/** Whether `indexes` holds a unique index on the single column `key`. */
function hasUniqueKeyIndex(indexes: Array<{ columns?: string[]; unique?: boolean }>): boolean {
  return indexes.some(
    (index) => index.unique === true && index.columns?.length === 1 && index.columns[0] === "key",
  );
}

export class DatabaseCacheDriver
  extends BaseCacheDriver<DatabaseCacheDriver, DatabaseCacheOptions>
  implements CacheDriver<DatabaseCacheDriver, DatabaseCacheOptions>
{
  /**
   * {@inheritdoc}
   */
  public name = "database";

  /**
   * Database model class
   */
  public model!: typeof CacheModel;

  /**
   * The answer of the one-time look for the unique index on `key`, per driver.
   */
  protected uniqueKeyIndex?: Promise<boolean>;

  /**
   * {@inheritdoc}
   */
  public setOptions(options: DatabaseCacheOptions) {
    super.setOptions(options);

    this.model = options.model ?? CacheModel;
    this.uniqueKeyIndex = undefined;

    return this;
  }

  /**
   * Whether `set` writes with one upsert: `upsert: true`, or no setting and a
   * unique index on `key` (the one `cacheMigration` creates) found in the
   * table. A lookup that fails counts as "not found" and is not repeated.
   */
  protected async usesUpsert(): Promise<boolean> {
    const setting = this.options.upsert;

    if (setting !== undefined) return setting;

    this.uniqueKeyIndex ??= (async () => {
      try {
        const model = this.model;
        const indexes = await model.getDriver().blueprint.listIndexes(model.table);

        if (hasUniqueKeyIndex(indexes)) return true;

        this.showUpsertHint();
      } catch {
        // No driver, table or permission to read indexes: keep the read-then-write path.
      }

      return false;
    })();

    return this.uniqueKeyIndex;
  }

  /** Tell, once per process, how to get one write per `set`. */
  protected showUpsertHint(): void {
    if (upsertHintShown) return;

    upsertHintShown = true;

    console.warn(
      `[cache] The database cache driver writes each entry with a read and an insert or update, because the "${this.model.table}" table has no unique index on "key". Add \`cacheMigration\` to your migrations and set \`upsert: true\` to write with one statement.`,
    );
  }

  /**
   * {@inheritdoc}
   */
  public async removeNamespace(namespace: string) {
    this.log("clearing", namespace);

    namespace = this.parseKey(namespace);

    if (!namespace) {
      // The root namespace: every entry.
      await this.model.query().delete();
    } else {
      // The namespace's own key and every key under it (`users`, `users.id.1`,
      // `users.list.*`), as the other drivers remove them. The stored
      // `namespace` column holds only the parent segments, so an exact match
      // on it would leave the nested rows behind.
      await this.model.query().where("key", namespace).delete();
      await this.model.query().whereStartsWith("key", `${namespace}.`).delete();
    }

    this.log("cleared", namespace);

    return this;
  }

  /**
   * {@inheritdoc}
   */
  public async set(key: CacheKey, value: any, ttlOrOptions?: CacheTtl | CacheSetOptions) {
    const parsedKey = this.parseKey(key);
    const { ttl, tags } = this.resolveSetOptions(ttlOrOptions);

    this.log("caching", parsedKey);

    // Extract namespace: all parts except the last (e.g., "users.id.1" -> "users.id")
    const keyParts = parsedKey.split(".");
    const namespace = keyParts.slice(0, -1).join(".") || parsedKey;

    const expiresAt = this.getExpiresAt(ttl) || null;

    if (await this.usesUpsert()) {
      // One statement; relies on the unique index on `key`.
      const row = { key: parsedKey, namespace, data: value, ttl, expiresAt };

      await this.model.upsert({ key: parsedKey }, row, { conflictColumns: ["key"] });
    } else {
      // Find existing cache entry or create new one (upsert pattern)
      const cacheEntry = await this.model.first({ key: parsedKey });

      if (cacheEntry) {
        // Update existing entry
        cacheEntry.set("namespace", namespace);
        cacheEntry.set("data", value);
        cacheEntry.set("ttl", ttl);
        cacheEntry.set("expiresAt", expiresAt);
        await cacheEntry.save();
      } else {
        // Create new entry
        await this.model.create({ key: parsedKey, namespace, data: value, ttl, expiresAt });
      }
    }

    if (tags && tags.length > 0) {
      await this.applyTags(key, tags);
    }

    this.log("cached", parsedKey);

    return this;
  }

  /**
   * {@inheritdoc}
   */
  public async get(key: CacheKey) {
    const parsedKey = this.parseKey(key);

    this.log("fetching", parsedKey);

    // A plain row: no model is built for a read.
    const row = (await this.model.query().where("key", parsedKey).lean().first()) as
      | Record<string, unknown>
      | null
      | undefined;

    if (!row) {
      this.log("notFound", parsedKey);
      return null;
    }

    const data: CacheData = {
      data: row.data,
      expiresAt: (row.expiresAt ?? undefined) as number | undefined,
      ttl: (row.ttl ?? undefined) as number | undefined,
    };

    return this.parseCachedData(parsedKey, data);
  }

  /**
   * {@inheritdoc}
   */
  public async remove(key: CacheKey) {
    const parsedKey = this.parseKey(key);

    this.log("removing", parsedKey);

    await this.model.delete({
      key: parsedKey,
    });

    this.log("removed", parsedKey);
  }

  /**
   * Remove an entry by its stored (already prefixed) key, e.g. an expired
   * entry found by `get()`. `remove()` would apply `globalPrefix` a second time.
   */
  protected async removeParsed(parsedKey: string): Promise<void> {
    await this.model.delete({ key: parsedKey });
  }

  /**
   * {@inheritdoc}
   */
  public async flush() {
    this.log("flushing");
    if (this.options.globalPrefix) {
      await this.removeNamespace("");
    } else {
      await this.model.query().delete();
    }

    this.log("flushed");
  }
}
