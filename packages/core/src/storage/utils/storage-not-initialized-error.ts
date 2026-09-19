/**
 * Thrown when storage is accessed (e.g. `storage.put(...)`) before it has
 * been initialized in this process — no context driver and no default
 * driver resolved yet.
 *
 * Previously this fell through to a bare `null` `activeDriver`, and the
 * first thing every call site did with it was read `.name` or call a
 * method on it, surfacing as `TypeError: Cannot read properties of null
 * (reading 'name')` deep inside `Storage#put()`. That told the caller
 * nothing about the real cause: the `storage` connector never ran in this
 * process, so `Storage#init()` was never called and `_driver` stayed
 * `null`. This error names that cause and the fix directly instead.
 */
export class StorageNotInitializedError extends Error {
  public constructor(options?: { cause?: unknown }) {
    super(
      "Storage is not initialized in this process. This happens when the `storage` " +
        "connector never ran, so `Storage.init()` was never called.\n\n" +
        "Check that `src/config/storage.ts` exists. If this is a custom CLI command, " +
        'add "storage" to its `preload.connectors` list so the connector runs before ' +
        "your command's action executes.",
      options,
    );

    this.name = "StorageNotInitializedError";
  }
}
