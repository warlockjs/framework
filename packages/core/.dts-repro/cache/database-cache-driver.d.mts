import { Model } from "@warlock.js/cascade";
import { BaseCacheDriver, CacheDriver, CacheKey } from "@warlock.js/cache";

//#region ../../@warlock.js/core/src/cache/database-cache-driver.d.ts
type DatabaseCacheOptions = {
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
};
declare class CacheModel extends Model {
  static table: string;
}
declare class DatabaseCacheDriver extends BaseCacheDriver<DatabaseCacheDriver, DatabaseCacheOptions> implements CacheDriver<DatabaseCacheDriver, DatabaseCacheOptions> {
  /**
   * {@inheritdoc}
   */
  name: string;
  /**
   * Database model class
   */
  model: typeof CacheModel;
  /**
   * {@inheritdoc}
   */
  setOptions(options: DatabaseCacheOptions): this;
  /**
   * {@inheritdoc}
   */
  removeNamespace(namespace: string): Promise<this>;
  /**
   * {@inheritdoc}
   */
  set(key: CacheKey, value: any, ttl?: number): Promise<this>;
  /**
   * {@inheritdoc}
   */
  get(key: CacheKey): Promise<any>;
  /**
   * {@inheritdoc}
   */
  remove(key: CacheKey): Promise<void>;
  /**
   * {@inheritdoc}
   */
  flush(): Promise<void>;
}
//#endregion
export { DatabaseCacheDriver, DatabaseCacheOptions };
//# sourceMappingURL=database-cache-driver.d.mts.map