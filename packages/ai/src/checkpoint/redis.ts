import type {
  CheckpointRecord,
  CheckpointStore,
} from "../contracts/orchestrator/checkpoint-store.contract";
import type { RedisClientLike } from "../contracts/orchestrator/snapshot-store.contract";
import { redisSetCommands, type RedisSetCommands } from "../utils/redis-set-commands";

/**
 * Options for the Redis {@link CheckpointStore} (orchestrator.md §8.3).
 *
 * The dev owns the connection — `@warlock.js/ai` takes no peer dep on
 * `redis` and never opens or closes the client.
 */
export type RedisCheckpointOptions = {
  /**
   * An already-connected `redis` client — anything matching {@link RedisClientLike}.
   * When the client also has the set commands (`sAdd`/`sRem`/`sMembers`
   * or `sadd`/`srem`/`smembers`), the session index is kept as a Redis set.
   */
  client: RedisClientLike;
  /**
   * Key prefix for every key this store writes. Lets one Redis database
   * back multiple stores without collision. Defaults to
   * `warlock:orchestrator`.
   */
  prefix?: string;
  /** Idle-key TTL in seconds. When set, every written key expires after the TTL. */
  ttl?: number;
};

/**
 * Default key prefix — namespaces the store's keys inside a shared
 * Redis database.
 */
const DEFAULT_PREFIX = "warlock:orchestrator";

/**
 * Session head document persisted under the session key: the turn-index
 * range whose rows are stored, one Redis key per turn. `save` writes one
 * turn key plus this small head, and `load` reads the head plus the latest
 * turn key — neither touches the session's older rows.
 */
type SessionHead = {
  layout: 2;
  /** Lowest turn index that may still have a stored row. */
  firstTurn: number;
  /** Highest stored turn index — the live session state. */
  latestTurn: number;
};

/**
 * Earlier layout of the session key: every row of the session inside one
 * JSON value. Still read so sessions written by an earlier release keep
 * loading; the first write (`save` / `prune`) moves the rows to one key per
 * turn.
 */
type LegacySessionDocument = {
  rows: CheckpointRecord[];
};

/**
 * Earlier layout of the per-orchestrator index (and the fallback layout
 * for a client without set commands): a JSON array of live session ids.
 */
type IndexDocument = {
  sessionIds: string[];
};

/** What the session key holds: the current head, an earlier-layout document, or nothing. */
type SessionState =
  | { type: "head"; head: SessionHead }
  | { type: "legacy"; rows: CheckpointRecord[] }
  | { type: "none" };

/**
 * Redis-backed {@link CheckpointStore} (orchestrator.md §8.2).
 *
 * Owns: one key per stored turn plus a small per-session head (so `save`
 * and `load` cost the same on turn 5 and turn 5,000), a per-orchestrator
 * session-id index (so {@link RedisCheckpointStore.list} works without
 * `KEYS`/`SCAN`), the "latest turn wins" load, and the §4-Phase-6
 * retention prune. Does NOT own: durability guarantees beyond Redis's
 * own, the connection lifecycle (the dev passes a client), or the
 * `keepSnapshots` policy (that lives on the orchestrator config).
 *
 * The session-id index is a Redis set when the client exposes the set
 * commands (`sAdd`/`sRem`/`sMembers` or `sadd`/`srem`/`smembers`), so
 * concurrent first saves never drop an id. A client with only
 * `get`/`set`/`del` keeps the index as a JSON document, updated on a
 * session's first save and on delete.
 *
 * Front it with the {@link redis} factory — callers never `new` it.
 */
class RedisCheckpointStore implements CheckpointStore {
  /** The dev-supplied redis client. Never disconnected by the store. */
  private readonly client: RedisClientLike;

  /** Set commands of the client, or `undefined` for a `get`/`set`/`del`-only client. */
  private readonly sets?: RedisSetCommands;

  /** Key prefix namespacing every key this store writes. */
  private readonly prefix: string;

  /** Idle-key TTL in seconds, or `undefined` for no expiry. */
  private ttl?: number;

  /**
   * One-time move of each orchestrator's earlier JSON index into the
   * Redis set, memoized per orchestrator name for the process lifetime.
   */
  private readonly indexMigrations = new Map<string, Promise<void>>();

  public constructor(options: RedisCheckpointOptions) {
    if (
      !options ||
      typeof options.client?.get !== "function" ||
      typeof options.client?.set !== "function" ||
      typeof options.client?.del !== "function"
    ) {
      throw new TypeError(
        "ai.checkpoint.redis requires a 'client' option implementing { get, set, del } — pass a connected redis client.",
      );
    }

    this.client = options.client;
    this.sets = redisSetCommands(options.client);
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.ttl = options.ttl;
  }

  /**
   * Return the latest checkpoint (highest `turn_index`) for a session,
   * or `undefined` when the session has no rows. Reads the head and the
   * latest turn key only.
   */
  public async load(
    orchestratorName: string,
    sessionId: string,
  ): Promise<CheckpointRecord | undefined> {
    const state = await this.readSession(orchestratorName, sessionId);

    if (state.type === "legacy") {
      return state.rows.at(-1);
    }

    if (state.type === "none") {
      return undefined;
    }

    const raw = await this.client.get(
      this.turnKey(orchestratorName, sessionId, state.head.latestTurn),
    );

    if (raw === null) {
      return undefined;
    }

    return JSON.parse(raw) as CheckpointRecord;
  }

  /**
   * Store a checkpoint row under its own turn key and advance the session
   * head. A re-save of the same `turn_index` (compaction lock / marker
   * updates) replaces that turn's row, so the latest write wins. The
   * session id is indexed on the session's first save.
   */
  public async save(record: CheckpointRecord): Promise<void> {
    const { orchestrator_name, session_id, turn_index } = record;

    const state = await this.readSession(orchestrator_name, session_id);
    const head =
      state.type === "legacy"
        ? await this.migrateRows(orchestrator_name, session_id, state.rows)
        : state.type === "head"
          ? state.head
          : undefined;

    await this.write(
      this.turnKey(orchestrator_name, session_id, turn_index),
      JSON.stringify(record),
    );

    const next: SessionHead = head
      ? {
          layout: 2,
          firstTurn: Math.min(head.firstTurn, turn_index),
          latestTurn: Math.max(head.latestTurn, turn_index),
        }
      : { layout: 2, firstTurn: turn_index, latestTurn: turn_index };

    await this.writeHead(orchestrator_name, session_id, next);

    // A set add is O(1) and idempotent, so it runs on every save (and
    // re-indexes a session `list()` dropped after its keys expired). The
    // JSON-document fallback only pays its read-modify-write on the
    // session's first save.
    if (this.sets || state.type === "none") {
      await this.indexSession(orchestrator_name, session_id);
    }
  }

  /**
   * Drop every stored row of a session and de-index its session id.
   */
  public async delete(orchestratorName: string, sessionId: string): Promise<void> {
    const state = await this.readSession(orchestratorName, sessionId);

    if (state.type === "head") {
      await this.deleteTurns(
        orchestratorName,
        sessionId,
        state.head.firstTurn,
        state.head.latestTurn + 1,
      );
    }

    await this.client.del(this.sessionKey(orchestratorName, sessionId));
    await this.deindexSession(orchestratorName, sessionId);
  }

  /**
   * List the session ids known for an orchestrator, optionally filtered
   * by a session-id prefix (§9.3 boot drain). With an idle TTL, ids whose
   * session keys have expired are dropped from the index here.
   */
  public async list(orchestratorName: string, prefix?: string): Promise<string[]> {
    let sessionIds = await this.readIndex(orchestratorName);

    if (this.ttl !== undefined && this.ttl > 0) {
      sessionIds = await this.dropExpired(orchestratorName, sessionIds);
    }

    if (prefix === undefined) {
      return sessionIds;
    }

    return sessionIds.filter((sessionId) => sessionId.startsWith(prefix));
  }

  /**
   * Drop every row of a session whose `turn_index` is strictly below
   * `keepBeforeTurnIndex` (orchestrator.md §4 Phase 6 / §15.2). The
   * orchestrator calls this after each settled turn's save with
   * `latest turn - keepSnapshots + 1`, so at most `keepSnapshots` rows
   * stay; `"all"` retention skips the call. A bound above the latest turn
   * removes the session entirely.
   */
  public async prune(
    orchestratorName: string,
    sessionId: string,
    keepBeforeTurnIndex: number,
  ): Promise<void> {
    if (!Number.isFinite(keepBeforeTurnIndex)) {
      return;
    }

    const state = await this.readSession(orchestratorName, sessionId);

    if (state.type === "none") {
      return;
    }

    if (state.type === "legacy") {
      const kept = state.rows.filter((row) => row.turn_index >= keepBeforeTurnIndex);

      if (kept.length === 0) {
        await this.delete(orchestratorName, sessionId);

        return;
      }

      const head = await this.migrateRows(orchestratorName, sessionId, kept);

      if (head) {
        await this.writeHead(orchestratorName, sessionId, head);
      }

      return;
    }

    const { head } = state;

    if (keepBeforeTurnIndex <= head.firstTurn) {
      return;
    }

    if (keepBeforeTurnIndex > head.latestTurn) {
      await this.delete(orchestratorName, sessionId);

      return;
    }

    await this.deleteTurns(orchestratorName, sessionId, head.firstTurn, keepBeforeTurnIndex);
    await this.writeHead(orchestratorName, sessionId, {
      ...head,
      firstTurn: keepBeforeTurnIndex,
    });
  }

  /**
   * The Redis store has no relational table — there is nothing to
   * migrate. Returns an empty string so callers can treat `schema()`
   * uniformly across drivers (mirrors the memory store).
   */
  public schema(): string {
    return "";
  }

  /**
   * Set the idle-key TTL (§8.2). Applied on every subsequent write; the
   * store never opens a background timer.
   */
  public setOptions(options: { ttl?: number }): void {
    this.ttl = options.ttl;
  }

  /**
   * Read the session key: the current head, an earlier-layout document
   * holding every row, or nothing.
   */
  private async readSession(orchestratorName: string, sessionId: string): Promise<SessionState> {
    const raw = await this.client.get(this.sessionKey(orchestratorName, sessionId));

    if (raw === null) {
      return { type: "none" };
    }

    const parsed = JSON.parse(raw) as Partial<SessionHead> & Partial<LegacySessionDocument>;

    if (Array.isArray(parsed.rows)) {
      return parsed.rows.length === 0 ? { type: "none" } : { type: "legacy", rows: parsed.rows };
    }

    if (typeof parsed.firstTurn === "number" && typeof parsed.latestTurn === "number") {
      return {
        type: "head",
        head: { layout: 2, firstTurn: parsed.firstTurn, latestTurn: parsed.latestTurn },
      };
    }

    return { type: "none" };
  }

  /**
   * Move earlier-layout rows to one key per turn. Rows are written in
   * stored order, so a later row for the same turn index wins. Returns
   * the head describing the moved range (the caller writes it), or
   * `undefined` for an empty list.
   */
  private async migrateRows(
    orchestratorName: string,
    sessionId: string,
    rows: CheckpointRecord[],
  ): Promise<SessionHead | undefined> {
    let head: SessionHead | undefined;

    for (const row of rows) {
      await this.write(
        this.turnKey(orchestratorName, sessionId, row.turn_index),
        JSON.stringify(row),
      );

      head = head
        ? {
            layout: 2,
            firstTurn: Math.min(head.firstTurn, row.turn_index),
            latestTurn: Math.max(head.latestTurn, row.turn_index),
          }
        : { layout: 2, firstTurn: row.turn_index, latestTurn: row.turn_index };
    }

    return head;
  }

  /** Delete the turn keys in `[fromTurn, toTurn)`. */
  private async deleteTurns(
    orchestratorName: string,
    sessionId: string,
    fromTurn: number,
    toTurn: number,
  ): Promise<void> {
    for (let turn = fromTurn; turn < toTurn; turn++) {
      await this.client.del(this.turnKey(orchestratorName, sessionId, turn));
    }
  }

  /** Persist a session head, honoring the configured idle TTL. */
  private async writeHead(
    orchestratorName: string,
    sessionId: string,
    head: SessionHead,
  ): Promise<void> {
    await this.write(this.sessionKey(orchestratorName, sessionId), JSON.stringify(head));
  }

  /**
   * Read the session ids of an orchestrator: the Redis set when the client
   * has set commands, otherwise the JSON index document.
   */
  private async readIndex(orchestratorName: string): Promise<string[]> {
    if (this.sets) {
      await this.migrateIndex(orchestratorName);

      return this.sets.members(this.setKey(orchestratorName));
    }

    return (await this.readIndexDocument(orchestratorName)).sessionIds;
  }

  /** Read and parse the JSON index document, defaulting to an empty index. */
  private async readIndexDocument(orchestratorName: string): Promise<IndexDocument> {
    const raw = await this.client.get(this.indexKey(orchestratorName));

    if (raw === null) {
      return { sessionIds: [] };
    }

    return JSON.parse(raw) as IndexDocument;
  }

  /** Add a session id to the orchestrator's index. */
  private async indexSession(orchestratorName: string, sessionId: string): Promise<void> {
    if (this.sets) {
      await this.migrateIndex(orchestratorName);
      await this.sets.add(this.setKey(orchestratorName), sessionId);

      return;
    }

    const index = await this.readIndexDocument(orchestratorName);

    if (index.sessionIds.includes(sessionId)) {
      return;
    }

    index.sessionIds.push(sessionId);

    await this.write(this.indexKey(orchestratorName), JSON.stringify(index));
  }

  /** Remove a session id from the orchestrator's index. */
  private async deindexSession(orchestratorName: string, sessionId: string): Promise<void> {
    if (this.sets) {
      await this.migrateIndex(orchestratorName);
      await this.sets.remove(this.setKey(orchestratorName), sessionId);

      return;
    }

    const index = await this.readIndexDocument(orchestratorName);
    const next = index.sessionIds.filter((id) => id !== sessionId);

    if (next.length === index.sessionIds.length) {
      return;
    }

    await this.write(this.indexKey(orchestratorName), JSON.stringify({ sessionIds: next }));
  }

  /**
   * Move the earlier JSON index document of an orchestrator into the
   * Redis set once per process, then delete the document. A failed move
   * is retried on the next call.
   */
  private migrateIndex(orchestratorName: string): Promise<void> {
    const existing = this.indexMigrations.get(orchestratorName);

    if (existing) {
      return existing;
    }

    const migration = (async () => {
      const sets = this.sets;

      if (!sets) {
        return;
      }

      const raw = await this.client.get(this.indexKey(orchestratorName));

      if (raw === null) {
        return;
      }

      const legacy = JSON.parse(raw) as IndexDocument;

      await sets.addMany(this.setKey(orchestratorName), legacy.sessionIds ?? []);
      await this.client.del(this.indexKey(orchestratorName));
    })();

    this.indexMigrations.set(orchestratorName, migration);
    migration.catch(() => this.indexMigrations.delete(orchestratorName));

    return migration;
  }

  /**
   * Drop index entries whose session key no longer exists (expired by the
   * idle TTL). Returns the surviving ids.
   */
  private async dropExpired(orchestratorName: string, sessionIds: string[]): Promise<string[]> {
    const live: string[] = [];
    const expired: string[] = [];

    for (const sessionId of sessionIds) {
      const raw = await this.client.get(this.sessionKey(orchestratorName, sessionId));

      (raw === null ? expired : live).push(sessionId);
    }

    if (expired.length === 0) {
      return live;
    }

    if (this.sets) {
      for (const sessionId of expired) {
        await this.sets.remove(this.setKey(orchestratorName), sessionId);
      }
    } else {
      const index = await this.readIndexDocument(orchestratorName);
      const next = index.sessionIds.filter((id) => !expired.includes(id));

      await this.write(this.indexKey(orchestratorName), JSON.stringify({ sessionIds: next }));
    }

    return live;
  }

  /**
   * Write a key, attaching the `EX` expiry option when an idle TTL is
   * configured. The TTL flows through {@link RedisClientLike.set}'s
   * variadic args as node-redis's `{ EX }` option object.
   */
  private async write(key: string, value: string): Promise<void> {
    if (this.ttl !== undefined && this.ttl > 0) {
      await this.client.set(key, value, { EX: this.ttl });

      return;
    }

    await this.client.set(key, value);
  }

  /**
   * Key for a session head — `<prefix>:session:<name>:<sessionId>`.
   * Earlier releases stored the whole row document under this key.
   */
  private sessionKey(orchestratorName: string, sessionId: string): string {
    return `${this.prefix}:session:${orchestratorName}:${sessionId}`;
  }

  /**
   * Key for one stored turn — `<prefix>:turn:<name>:<sessionId>:<turnIndex>`.
   */
  private turnKey(orchestratorName: string, sessionId: string, turnIndex: number): string {
    return `${this.prefix}:turn:${orchestratorName}:${sessionId}:${turnIndex}`;
  }

  /**
   * Key for the Redis-set session index — `<prefix>:sessions:<name>`.
   */
  private setKey(orchestratorName: string): string {
    return `${this.prefix}:sessions:${orchestratorName}`;
  }

  /**
   * Key for the JSON-document session index — `<prefix>:index:<name>`.
   * Used by clients without set commands, and read once to move an
   * earlier index into the set.
   */
  private indexKey(orchestratorName: string): string {
    return `${this.prefix}:index:${orchestratorName}`;
  }
}

/**
 * Create a Redis-backed {@link CheckpointStore} (orchestrator.md §8.3).
 * The dev installs `redis` and passes a connected client —
 * `@warlock.js/ai` never imports `redis`. {@link CheckpointStore.schema}
 * returns an empty string; Redis needs no migration.
 *
 * @example
 * import { createClient } from "redis";
 * import { ai } from "@warlock.js/ai";
 *
 * const client = createClient();
 * await client.connect();
 *
 * const store = ai.checkpoint.redis({ client });
 */
export function redis(options: RedisCheckpointOptions): CheckpointStore {
  return new RedisCheckpointStore(options);
}
