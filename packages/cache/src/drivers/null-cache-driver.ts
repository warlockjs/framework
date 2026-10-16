import type { GenericObject } from "@mongez/reinforcements";
import { log, maskEmailsInText } from "@warlock.js/logger";
import type {
  CacheDriver,
  CacheKey,
  CacheSetOptions,
  CacheTtl,
  NullCacheDriverOptions,
  RememberOptions,
} from "../types";
import { BaseCacheDriver } from "./base-cache-driver";

export class NullCacheDriver
  extends BaseCacheDriver<NullCacheDriver, NullCacheDriverOptions>
  implements CacheDriver<NullCacheDriver, NullCacheDriverOptions>
{
  /**
   * Options list
   */
  public options: GenericObject = {};

  /**
   * {@inheritdoc}
   */
  public name = "null";

  /**
   * Cached data
   */
  public data: GenericObject = {};

  /**
   * {@inheritdoc}
   */
  public get client() {
    return this;
  }

  /**
   * Constructor
   */
  public constructor(options: GenericObject = {}) {
    super();
    this.setOptions(options);
  }

  /**
   * {@inheritdoc}
   */
  public setOptions(options: GenericObject) {
    this.options = options;
    return this;
  }

  /**
   * {@inheritdoc}
   */
  public parseKey(key: CacheKey) {
    // Real parsed key so the base lock map never merges distinct keys.
    return super.parseKey(key);
  }

  /**
   * {@inheritdoc}
   *
   * Nothing is stored, so always run the callback and return its own result.
   */
  public async remember(
    _key: CacheKey,
    _ttlOrOptions: CacheTtl | RememberOptions,
    callback: () => Promise<any>,
  ): Promise<any> {
    return callback();
  }

  /**
   * {@inheritdoc}
   */
  public async removeNamespace(namespace: string) {
    const loggableNamespace = maskEmailsInText(namespace);

    log.info("cache", "clearing namespace", loggableNamespace);

    log.success("cache", "namespace cleared", loggableNamespace);

    return this;
  }

  /**
   * The key as it may appear in a log line: parsed, with email addresses masked
   */
  protected loggableKey(key: CacheKey): string {
    return maskEmailsInText(this.parseKey(key));
  }

  /**
   * {@inheritdoc}
   */
  public async set(
    key: CacheKey,
    _value: any,
    _ttlOrOptions?: CacheTtl | CacheSetOptions,
  ): Promise<any> {
    log.info("cache", "setting key", this.loggableKey(key));

    log.success("cache", "key set", this.loggableKey(key));

    return this;
  }

  /**
   * {@inheritdoc}
   */
  public async get(key: CacheKey) {
    log.info("cache", "fetching", this.loggableKey(key));

    log.success("cache", "fetched", this.loggableKey(key));

    return null;
  }

  /**
   * {@inheritdoc}
   */
  public async remove(key: CacheKey) {
    log.info("cache", "removing", this.loggableKey(key));

    log.success("cache", "removed", this.loggableKey(key));
  }

  /**
   * {@inheritdoc}
   */
  public async flush() {
    log.info("cache", "flushing", "all");

    log.success("cache", "flushed", "all");
  }

  /**
   * {@inheritdoc}
   *
   * The null driver is a black-hole — `similar()` mirrors `get()` and returns
   * an empty result set rather than throwing.
   */
  public async similar(): Promise<any[]> {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public async connect() {
    log.success("cache", "connected", "Connected to null cache driver");
  }
}
