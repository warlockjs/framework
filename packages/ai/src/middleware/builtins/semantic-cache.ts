import type { CacheDriver, CacheSimilarHit } from "@warlock.js/cache";
import { createHash } from "node:crypto";
import { resolveDefaultStore } from "../../config";
import type { Message } from "../../contracts/conversation-message.type";
import type { EmbedderContract } from "../../contracts/embedder.contract";
import type { AgentMiddleware } from "../../contracts/middleware";
import type { MiddlewareTripContext } from "../../contracts/middleware/middleware-context.type";
import type { ModelResponse } from "../../contracts/model.contract";
import { similarWithin } from "../../utils/similar-within";
import { extractUserText } from "../utils";

/**
 * Isolation boundary for cache reads and writes.
 *
 * - `"session"` (default) — key every entry off the run's
 *   `AgentExecuteOptions.sessionId`, so one session never receives a
 *   response cached for another. A run WITHOUT a `sessionId` skips the
 *   cache entirely: it neither reads nor writes.
 * - `"shared"` — one pool for every caller, regardless of session. The
 *   explicit opt-in for genuinely public Q&A (docs bots, FAQ) where the
 *   cross-user hit rate is the point and no response can carry one
 *   caller's private context.
 * - a resolver — derive the key yourself, e.g. per tenant
 *   (`ctx => ctx.options?.toolCtx?.tenantId`). Returning `undefined` (or
 *   an empty string) skips the cache for that run; return a constant to
 *   pool such runs deliberately.
 *
 * Whatever the scope, a cached answer is only served back to the same
 * agent with the same system prompt and the same conversation so far.
 */
export type SemanticCacheScope =
  | "session"
  | "shared"
  | ((context: MiddlewareTripContext) => string | undefined);

/**
 * Configuration for `semanticCache()`.
 */
export type SemanticCacheOptions = {
  /** Embedder used to produce the query vector from the prompt text. */
  embedder: EmbedderContract;
  /**
   * Vector-capable cache driver from `@warlock.js/cache`. Production
   * deployments pick a driver with a real ANN index (`pg` with
   * pgvector, `redis` with RediSearch). Dev / test environments use
   * `new MemoryCacheDriver()` — zero config, correct, but O(N) per
   * query. Drivers without similarity support throw
   * `CacheUnsupportedError` from `set({ vector })` / `similar()`.
   *
   * Falls back to `ai.config({ defaultStore })` when omitted. When
   * neither is set, the factory throws at construction time —
   * semantic cache cannot operate without a store.
   */
  store?: CacheDriver<any, any>;
  /**
   * Minimum cosine similarity for a vector hit. Between 0 and 1 —
   * 0.95 is a solid default for question-answering caches.
   */
  threshold: number;
  /**
   * Optional TTL in milliseconds. Entries whose `storedAt` is older
   * than this are treated as misses on read and overwritten on the
   * next write. Default: no expiry — entries live until the store
   * evicts them (per its own TTL/eviction policy).
   */
  ttlMs?: number;
  /**
   * Namespace prefix applied to every key the cache writes. Lets
   * multiple agents share one driver without collision. Default
   * `"ai.cache"`.
   */
  namespace?: string;
  /**
   * Per-caller isolation boundary. Default `"session"` — a cached
   * response is served back only to the session that produced it.
   *
   * A `semanticCache` is normally built once at app boot and shared by
   * every end user, and a hit is returned as the model's answer with no
   * LLM call in between; without a scope that pools every caller's Q&A
   * pairs into one namespace, which is both a disclosure path (user B's
   * near-enough prompt gets served user A's answer, personal context
   * included) and a poisoning path (an attacker seeds an entry near a
   * predictable future query). Set `"shared"` to opt back into pooling
   * where that is actually desirable. See {@link SemanticCacheScope}.
   */
  scope?: SemanticCacheScope;
  /**
   * Middleware name — also the state-bag key prefix inside a single
   * execution. Default `"semantic-cache"`.
   */
  name?: string;
  /**
   * Cache the answer of a run whose first model turn called tools. Such
   * an answer is built from tool results (an account balance, a stock
   * level) that can change or belong to one caller, so by default it is
   * not stored. Default `false`.
   *
   * @example
   * semanticCache({ embedder, store, threshold: 0.95, cacheToolRuns: true });
   */
  cacheToolRuns?: boolean;
};

type CachedEntry = {
  response: ModelResponse;
  storedAt: number;
  /** Isolation key the entry was written under; absent = the shared pool. */
  scope?: string;
  /** SHA-256 of the full prompt; an exact hit must match it. */
  promptHash?: string;
  /**
   * SHA-256 of the agent name, the conversation before the last user
   * message (system prompt included) and that message's non-text parts.
   * Both the exact and the similarity path require it to match, so an
   * answer never crosses agents, system prompts or conversations.
   */
  contextKey?: string;
};

type PendingWrite = {
  promptKey: string;
  contextKey: string;
  vector: number[];
  scope?: string;
  /**
   * Text of `pause_turn` (and continued `length`) segments seen so far. A
   * resumed turn's continuation carries only its new content, so the
   * stored answer is these segments followed by the final response's
   * content.
   */
  pausedContent?: string;
};

const DEFAULT_NAMESPACE = "ai.cache";

/**
 * Candidates pulled from `similar()` before the scope / context filter
 * runs. The driver ranks across every scope and conversation in the
 * index, so a bare `topK: 1` can come back as a foreign entry and mask
 * this caller's own legitimate hit; a page still filled by foreign
 * entries is widened (see `similarWithin`).
 */
const SIMILAR_OVERSCAN = 5;

/** SHA-256 hex digest of a string. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Serialize one message for hashing: role, every content part (text and
 * media alike, so two prompts with the same words but different images
 * differ), tool-call ids and requested tool calls.
 */
function serializeMessage(message: Message): string {
  return JSON.stringify([
    message.role,
    message.content,
    message.toolCallId ?? null,
    message.toolCalls ?? null,
  ]);
}

/**
 * Fingerprint of the full message list (system + history + user turn) —
 * the exact-match key. SHA-256, and stored on the entry so an exact hit is
 * verified against it rather than trusted from the key alone.
 */
function hashPrompt(messages: ReadonlyArray<Message>): string {
  return sha256(messages.map(serializeMessage).join("\n"));
}

/**
 * Fingerprint of everything that must be identical for a cached answer
 * to apply besides the last user message's text: the agent, the messages
 * before that user message (system prompt and history), and that
 * message's non-text parts (an attached image or file).
 */
function hashContext(agentName: string, messages: ReadonlyArray<Message>): string {
  let lastUser = messages.length - 1;
  while (lastUser >= 0 && messages[lastUser]?.role !== "user") {
    lastUser--;
  }

  const before = messages.slice(0, Math.max(lastUser, 0)).map(serializeMessage);
  const lastContent = lastUser >= 0 ? messages[lastUser]?.content : undefined;
  const media = Array.isArray(lastContent)
    ? JSON.stringify(lastContent.filter((part) => part.type !== "text"))
    : "[]";

  return sha256(JSON.stringify([agentName, before, media]));
}

/**
 * Resolve the isolation key this trip reads and writes under.
 *
 * Derived from the run's own `sessionId` (or the developer's resolver) —
 * never from the prompt, the model's output, or anything the LLM can
 * write to. `"shared"` resolves to the shared pool (`{}`); a run with no
 * key under `"session"` or a resolver resolves to `undefined` — skip the
 * cache for this run.
 */
function resolveScope(
  scope: SemanticCacheScope,
  context: MiddlewareTripContext,
): { key?: string } | undefined {
  if (scope === "shared") {
    return {};
  }

  const key =
    typeof scope === "function" ? scope(context) : sessionScope(context.options?.sessionId);

  return key ? { key } : undefined;
}

/**
 * The default `"session"` key: the session id under a reserved prefix so
 * a custom resolver returning a bare tenant id can't collide with a
 * session pool. Mirrors the orchestrator's `sessionMemoryScope`.
 */
function sessionScope(sessionId: string | undefined): string | undefined {
  return sessionId ? `session:${sessionId}` : undefined;
}

function isFresh(entry: CachedEntry, ttlMs: number | undefined): boolean {
  if (ttlMs === undefined) {
    return true;
  }

  return Date.now() - entry.storedAt <= ttlMs;
}

/**
 * Semantic-similarity response cache for an agent run.
 *
 * **Role.** Skips LLM round-trips when the current prompt is
 * semantically close to one the agent has already answered. For
 * FAQ / support-style traffic this often eliminates 60–80% of
 * model calls — the production win is massive for cost and
 * latency.
 *
 * **Delegation to `@warlock.js/cache`.** This middleware does NOT
 * implement similarity search itself. It delegates to the supplied
 * `CacheDriver`. Production deployments pick a driver with an ANN
 * index (`pg` + pgvector, `redis` + RediSearch). Dev / test
 * environments pass `new MemoryCacheDriver()` — zero config, correct,
 * but O(N) per query. Drivers without similarity support throw
 * `CacheUnsupportedError` from `set({ vector })` / `similar()`.
 *
 * **Two-tier lookup.**
 * 1. *Exact-match key* — a SHA-256 hash over the entire message
 *    list. `store.get(hash)` returns the entry without an embedding
 *    round trip when the prompt hasn't changed at all; the stored
 *    prompt hash and context fingerprint are checked on the hit.
 * 2. *Vector-match* — on exact-match miss, embed the last user
 *    message and call `store.similar(vector, { topK, threshold })`.
 *    The driver uses its native similarity index; a candidate clearing
 *    `threshold` is a hit only when it was written in the same scope
 *    and the same context (agent, system prompt, conversation so far).
 *
 * **Write-on-miss.** When both tiers miss, `trip.before` stashes
 * the prompt hash + vector in `ctx.state`; `trip.after` reads back
 * the pending entry and calls
 * `store.set(hash, entry, { vector })`. If an outer middleware
 * (guardrail) throws in `trip.after` before the cache's `trip.after`
 * runs, the pending entry is never written — bad responses stay out
 * of the cache **as long as the canonical install order is followed**
 * (cache outermost).
 *
 * **Synthetic-response on hit.** Returns a `ModelResponse` with
 * `usage: { input: 0, output: 0, total: 0 }` so budget /
 * observability correctly exclude the saved trip.
 *
 * **Per-session scoping (4.15.0).** One `semanticCache` instance
 * normally serves every end user, and a hit is returned as the answer
 * with no model call in between — so entries are keyed by the run's
 * `sessionId` (`scope`, default `"session"`) and a lookup only ever
 * sees entries written under the same key. Runs made without a
 * `sessionId` skip the cache; pass `sessionId` on `agent.execute()`
 * (composites thread their own through automatically), or set
 * `scope: "shared"` to pool deliberately.
 *
 * **Per-context matching.** Each entry records a fingerprint of the
 * agent, its system prompt and the conversation before the question; a
 * hit requires the same fingerprint, so two agents (or two points in a
 * conversation) asking the same words never share an answer. Answers of
 * runs that called tools are not stored unless `cacheToolRuns` is set.
 * Note the cost/benefit shift: scoping trades cross-user hit rate for
 * isolation, so public-FAQ deployments where no response can carry a
 * caller's private context should opt into `"shared"` explicitly.
 *
 * @example
 * import { semanticCache } from "@warlock.js/ai";
 * import { MemoryCacheDriver } from "@warlock.js/cache";
 *
 * const store = new MemoryCacheDriver();
 * store.setOptions({});
 *
 * const cache = semanticCache({
 *   embedder: openai.embedder({ name: "text-embedding-3-small" }),
 *   store,
 *   threshold: 0.95,
 *   ttlMs: 60 * 60 * 1000,
 * });
 *
 * const myAgent = agent({ model, middleware: [cache] });
 */
export function semanticCache(options: SemanticCacheOptions): AgentMiddleware {
  const name = options.name ?? "semantic-cache";
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const scopeMode: SemanticCacheScope = options.scope ?? "session";
  const cacheToolRuns = options.cacheToolRuns ?? false;
  const pendingKey = `${name}.pending`;
  let warnedUnscoped = false;

  // Resolve the effective store at factory time, not per-call. Every
  // subsequent hook closes over `store` so the resolution happens once.
  // Throws now (loud, at construction) instead of later during the
  // first trip (silent until the agent actually runs).
  const store = options.store ?? resolveDefaultStore();

  if (!store) {
    throw new Error(
      `semanticCache: no store supplied — pass \`store\` in options or call \`ai.config({ defaultStore })\` at app boot before constructing the middleware`,
    );
  }

  // Cache's parseKey replaces ":" with "." so the namespace boundary
  // matches what `similar()` actually returns in `hit.key`. Using a
  // dot here keeps prefix checks aligned with stored keys.
  //
  // A scoped entry gets an extra hashed segment, so two sessions asking
  // the identical question stay two entries instead of overwriting each
  // other; the scope is hashed because a `sessionId` is caller-supplied
  // and may contain the key delimiter. The hash is a write-separation
  // device only — a read is authorized by the exact `entry.scope`,
  // `entry.promptHash` and `entry.contextKey` equality checks below, so
  // even a key collision cannot widen what a caller can read.
  const keyFor = (hash: string, scope: string | undefined): string =>
    scope === undefined
      ? `${namespace}.${hash}`
      : `${namespace}.${sha256(scope).slice(0, 16)}.${hash}`;

  return {
    name,
    log: true,
    trip: {
      async before(context) {
        // Only cache the first trip's response. Subsequent trips
        // happen because the previous trip requested tool calls — the
        // message list now carries tool results the original prompt
        // never saw, so a semantic match on the unchanged user text
        // would serve back the prior `tool_calls` response and loop
        // the agent forever. The first turn is also the only one
        // where a "same question → same final answer" caching story
        // is sound.
        if (context.tripIndex !== 0) {
          return;
        }

        const promptText = extractUserText(context.messages);

        if (!promptText) {
          return;
        }

        const resolved = resolveScope(scopeMode, context);

        if (!resolved) {
          // No isolation key for this run: neither read nor write, so an
          // anonymous run can never receive (or seed) another caller's answer.
          if (!warnedUnscoped && !process.env.VITEST && process.env.NODE_ENV !== "test") {
            warnedUnscoped = true;
            console.warn(
              `[warlock-ai] semanticCache "${name}": a run without a cache scope skipped the cache. ` +
                'Pass `sessionId` to agent.execute() (scope "session"), return a key from your `scope` resolver, ' +
                'or set `scope: "shared"` for answers that may be served to every caller.',
            );
          }

          return;
        }

        const scope = resolved.key;
        const promptKey = hashPrompt(context.messages);
        const contextKey = hashContext(context.agent.name, context.messages);

        const exact = await store.get<CachedEntry>(keyFor(promptKey, scope));

        // The key already carries the scope; re-checking the stored scope,
        // prompt and context is the actual authorization step, so a key
        // collision or a hand-written entry can't serve across the boundary.
        if (
          exact &&
          exact.scope === scope &&
          exact.promptHash === promptKey &&
          exact.contextKey === contextKey &&
          isFresh(exact, options.ttlMs)
        ) {
          return toSyntheticResponse(exact.response);
        }

        const query = await options.embedder.embed(promptText);

        // Only entries written inside this cache's namespace, in this
        // caller's scope AND for this same agent / system prompt /
        // conversation are eligible. A shared driver would otherwise leak a
        // foreign namespace's entries; a shared namespace another session's
        // answer; a shared session another agent's or another turn's answer.
        const [hit] = await similarWithin(
          (topK) =>
            store.similar<CachedEntry>(query.vector, { topK, threshold: options.threshold }),
          (candidate: CacheSimilarHit<CachedEntry>) =>
            candidate.key.startsWith(`${namespace}.`) &&
            candidate.value?.scope === scope &&
            candidate.value.contextKey === contextKey &&
            isFresh(candidate.value, options.ttlMs),
          { topK: SIMILAR_OVERSCAN, want: 1 },
        );

        if (hit) {
          return toSyntheticResponse(hit.value.response);
        }

        const pending: PendingWrite = {
          promptKey,
          contextKey,
          vector: query.vector,
          scope,
        };
        context.state.set(pendingKey, pending);

        return;
      },
      async after(context, response) {
        const pending = context.state.get(pendingKey) as PendingWrite | undefined;

        if (!pending) {
          return;
        }

        // Mid-stream tool-call responses must not be cached — the
        // useful answer comes from the trip *after* the tool returns.
        // With `cacheToolRuns`, leave the pending entry in place so a later trip
        // (the one that actually finishes with `stop`) can read it
        // and write the final response under the *original* trip-0
        // prompt key. Deleting here would orphan the pending and the
        // post-tool answer would never make it into the store. A paused
        // turn (`pause_turn`) is mid-turn the same way: the agent resumes it.
        // So is a response cut off by the output cap: the agent either
        // continues it (`continueOnOutputLimit`) — the stored answer is the
        // joined text — or ends the run incomplete, and nothing is stored.
        if (response.finishReason === "pause_turn" || response.finishReason === "length") {
          pending.pausedContent = (pending.pausedContent ?? "") + response.content;

          return;
        }

        // A full context window has no answer to cache and is never continued.
        if (response.finishReason === "context_exceeded") {
          context.state.delete(pendingKey);

          return;
        }

        if (response.finishReason === "tool_calls") {
          if (!cacheToolRuns) {
            // The final answer will be built from tool results — data that
            // can change or belong to this caller — so it is not stored.
            context.state.delete(pendingKey);

            return;
          }

          // A tool trip ends the current assistant turn; text from an
          // earlier paused segment is not part of the eventual answer.
          delete pending.pausedContent;

          return;
        }

        context.state.delete(pendingKey);

        const entry: CachedEntry = {
          response:
            pending.pausedContent === undefined
              ? response
              : { ...response, content: pending.pausedContent + response.content },
          storedAt: Date.now(),
          scope: pending.scope,
          promptHash: pending.promptKey,
          contextKey: pending.contextKey,
        };

        await store.set(keyFor(pending.promptKey, pending.scope), entry, {
          vector: pending.vector,
        });

        return;
      },
    },
  };
}

function toSyntheticResponse(response: ModelResponse): ModelResponse {
  return {
    content: response.content,
    finishReason: response.finishReason,
    usage: { input: 0, output: 0, total: 0 },
    toolCalls: response.toolCalls,
  };
}
