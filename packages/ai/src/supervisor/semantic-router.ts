import type { CacheDriver } from "@warlock.js/cache";
import type { AgentExecuteOptions } from "../contracts/agent/agent-options.type";
import type { AgentContract } from "../contracts/agent/agent.contract";
import type { EmbedderContract } from "../contracts/embedder.contract";
import { END } from "../contracts/end.type";
import type { AgentResult } from "../contracts/result/agent-result.type";
import type { AgentReport } from "../contracts/result/execution-report.type";
import type { RouterDecisionMeta } from "../contracts/supervisor/iteration-snapshot.type";
import { generateRunId } from "../utils/generate-run-id";
import { hashText } from "../utils/hash-text";
import type { RouterIntents, RouterOutput } from "./router-factory";

/**
 * Where the semantic router keeps its example vectors. Only `get`, `set`
 * and `remove` are used, so any `@warlock.js/cache` driver (memory, Redis,
 * pg, ...) fits. Defaults to an in-process map.
 */
export type SemanticRouterStore = Pick<CacheDriver<any, any>, "get" | "set" | "remove">;

/** How sure the semantic match must be before the fallback is skipped. */
export type SemanticRouterConfidence = {
  /** Minimum cosine similarity of the best intent (0 to 1). */
  min: number;
  /**
   * Minimum gap between the best and the second-best intent. Keeps two
   * near-identical intents from being decided by noise. Default `0`.
   */
  margin?: number;
};

/** Settings for `learn: { ... }`. */
export type SemanticRouterLearnOptions = {
  /** Most learned phrases kept per intent; the oldest are dropped first. Default `20`. */
  maxPerIntent?: number;
  /**
   * Smallest similarity to the agreeing intent for a fallback decision to be
   * learned. Default `confidence.min - 0.1`.
   */
  minScore?: number;
};

/** Bounded cache of message embeddings, keyed by exact text. */
export type SemanticRouterMessageCache = {
  /** Most texts kept. Default `256`. */
  max?: number;
  /** Time to live of one embedding in milliseconds. Default `60_000`. */
  ttlMs?: number;
};

export type SemanticRouterConfig = {
  /** Supervisor name; part of every stored vector's key. */
  name: string;
  /** Embeds the example phrases and each incoming message. */
  embedder: EmbedderContract;
  /** The intents the supervisor routes over (the same object given to `ai.supervisor`). */
  intents: RouterIntents;
  /** Example phrases per intent name. Intents without examples are reachable only through `fallback`. */
  examples: Record<string, string[]>;
  confidence: SemanticRouterConfidence;
  /** Decides whenever the semantic match is not confident enough; usually `ai.router({ model, intents })`. */
  fallback: AgentContract<unknown>;
  /** Vector store. Default: in-process memory, which re-embeds the examples on every process start. */
  store?: SemanticRouterStore;
  /** Store high-certainty fallback decisions as new examples. */
  learn?: boolean | SemanticRouterLearnOptions;
  /** Tune the message-embedding cache. */
  messageCache?: SemanticRouterMessageCache;
  /** Key prefix in the store. Default `"ai.router"`. */
  namespace?: string;
};

/** An `ai.supervisor({ router })` compatible agent that routes by embedding similarity. */
export type SemanticRouter = AgentContract<RouterOutput> & {
  /** Embed and index the examples now (otherwise this happens on the first message). */
  warm(): Promise<void>;
};

type ExampleVector = { phrase: string; vector: number[] };

type StoredVector = { intent: string; phrase: string; vector: number[] };

type Manifest = { keys: string[] };

type LearnedDoc = { embedder: string; items: Array<{ intent: string; phrase: string; vector?: number[]; at: number }> };

const DEFAULT_NAMESPACE = "ai.router";
const DEFAULT_MAX_PER_INTENT = 20;
const DEFAULT_MESSAGE_CACHE_MAX = 256;
const DEFAULT_MESSAGE_CACHE_TTL_MS = 60_000;
const MAX_LEARNED_PHRASE_LENGTH = 500;
const ORIGINAL_INPUT_MARKER = "\nOriginal input: ";

/** Process-local default store. */
function memoryStore(): SemanticRouterStore {
  const map = new Map<string, unknown>();

  return {
    async get(key) {
      return (map.get(String(key)) ?? null) as never;
    },
    async set(key, value) {
      map.set(String(key), value);

      return value;
    },
    async remove(key) {
      map.delete(String(key));
    },
  } as SemanticRouterStore;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index++) {
    const left = a[index] as number;
    const right = b[index] as number;

    dot += left * right;
    normA += left * left;
    normB += right * right;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Split the per-turn message the supervisor builds for a router agent into
 * the user's original input and whether this is the first iteration. A
 * message without the supervisor's scaffolding (a direct call, or a custom
 * `router.input`) is the input itself.
 */
function readRouterMessage(message: string): { input: string; firstIteration: boolean } {
  const markerAt = message.lastIndexOf(ORIGINAL_INPUT_MARKER);

  if (markerAt === -1) {
    return { input: message.trim(), firstIteration: true };
  }

  const iteration = /^Iteration: (\d+) \//m.exec(message);

  return {
    input: message.slice(markerAt + ORIGINAL_INPUT_MARKER.length).trim(),
    firstIteration: !iteration || iteration[1] === "1",
  };
}

/**
 * Build an embedding-based router for `ai.supervisor({ router })`.
 *
 * The first iteration of a run is routed by comparing the message with the
 * example phrases of every intent; when the best intent clears
 * `confidence.min` and leads the runner-up by `confidence.margin`, no model
 * call is made. Everything else (later iterations, low confidence, an
 * embedder or store failure) goes to `fallback`.
 *
 * Example vectors are embedded once and stored under supervisor name,
 * embedder model, intent and phrase hash, so editing a phrase or switching
 * embedder recomputes only what changed and removes what is no longer used.
 * Scoring uses an in-memory copy; the store is read at start-up only.
 *
 * @example
 * const intents = { billing, orders, resolver };
 *
 * const support = ai.supervisor({
 *   name: "support",
 *   intents,
 *   router: ai.semanticRouter({
 *     name: "support",
 *     embedder,
 *     intents,
 *     examples: { billing: ["where is my invoice"], orders: ["track my parcel"] },
 *     confidence: { min: 0.8, margin: 0.05 },
 *     fallback: ai.router({ model, intents }),
 *   }),
 * });
 */
export function semanticRouter(config: SemanticRouterConfig): SemanticRouter {
  validateConfig(config);

  const { embedder, fallback } = config;
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;
  const store = config.store ?? memoryStore();
  const minScore = config.confidence.min;
  const margin = config.confidence.margin ?? 0;
  const embedderId = `${embedder.provider}:${embedder.name}`;
  const learnOptions = resolveLearn(config.learn, minScore);
  const cacheMax = config.messageCache?.max ?? DEFAULT_MESSAGE_CACHE_MAX;
  const cacheTtl = config.messageCache?.ttlMs ?? DEFAULT_MESSAGE_CACHE_TTL_MS;

  const prefix = `${namespace}.${hashText(config.name)}`;
  const manifestKey = `${prefix}.manifest`;
  const learnedKey = `${prefix}.learned`;

  const index = new Map<string, ExampleVector[]>();
  let learned: LearnedDoc["items"] = [];
  let ready: Promise<void> | undefined;

  const messageCache = new Map<string, { vector: number[]; expiresAt: number }>();

  const safeGet = async <T>(key: string): Promise<T | null> => {
    try {
      return (await store.get(key)) as T | null;
    } catch {
      return null;
    }
  };

  const safeSet = async (key: string, value: unknown): Promise<void> => {
    try {
      await store.set(key, value);
    } catch {
      // A store outage costs a recompute on the next start, not a routing failure.
    }
  };

  const safeRemove = async (key: string): Promise<void> => {
    try {
      await store.remove(key);
    } catch {
      // Stale entries are pruned on a later start.
    }
  };

  const addToIndex = (intent: string, phrase: string, vector: number[]): void => {
    const list = index.get(intent) ?? [];

    list.push({ phrase, vector });
    index.set(intent, list);
  };

  const vectorKey = (intent: string, phrase: string): string =>
    `${prefix}.${hashText(embedderId)}.${hashText(intent)}.${hashText(phrase)}`;

  const build = async (): Promise<void> => {
    index.clear();

    const wanted: Array<{ intent: string; phrase: string; key: string }> = [];
    const seen = new Set<string>();

    for (const [intent, phrases] of Object.entries(config.examples)) {
      for (const raw of phrases) {
        const phrase = raw.trim();
        const key = vectorKey(intent, phrase);

        if (!phrase || seen.has(key)) {
          continue;
        }

        seen.add(key);
        wanted.push({ intent, phrase, key });
      }
    }

    const missing: typeof wanted = [];

    for (const item of wanted) {
      const stored = await safeGet<StoredVector>(item.key);

      if (stored && Array.isArray(stored.vector)) {
        addToIndex(item.intent, item.phrase, stored.vector);
      } else {
        missing.push(item);
      }
    }

    if (missing.length > 0) {
      const embedded = await embedder.embedMany(missing.map((item) => item.phrase));

      for (const [position, item] of missing.entries()) {
        const vector = embedded.vectors[position] as number[];

        addToIndex(item.intent, item.phrase, vector);
        await safeSet(item.key, { intent: item.intent, phrase: item.phrase, vector });
      }
    }

    const previous = await safeGet<Manifest>(manifestKey);

    for (const stale of previous?.keys ?? []) {
      if (!seen.has(stale)) {
        await safeRemove(stale);
      }
    }

    await safeSet(manifestKey, { keys: [...seen] } satisfies Manifest);

    if (learnOptions) {
      await loadLearned();
    }
  };

  const loadLearned = async (): Promise<void> => {
    const doc = await safeGet<LearnedDoc>(learnedKey);
    const valid = (doc?.items ?? []).filter((item) => item.intent in config.intents);
    const sameEmbedder = doc?.embedder === embedderId;
    const needVectors = valid.filter((item) => !sameEmbedder || !Array.isArray(item.vector));

    if (needVectors.length > 0) {
      const embedded = await embedder.embedMany(needVectors.map((item) => item.phrase));

      for (const [position, item] of needVectors.entries()) {
        item.vector = embedded.vectors[position];
      }
    }

    learned = valid;

    for (const item of learned) {
      addToIndex(item.intent, item.phrase, item.vector as number[]);
    }

    if (needVectors.length > 0 || valid.length !== doc?.items.length) {
      await persistLearned();
    }
  };

  const persistLearned = async (): Promise<void> => {
    await safeSet(learnedKey, { embedder: embedderId, items: learned } satisfies LearnedDoc);
  };

  const ensureReady = (): Promise<void> => {
    ready ??= build().catch((error) => {
      ready = undefined;

      throw error;
    });

    return ready;
  };

  const embedMessage = async (text: string): Promise<number[]> => {
    const now = Date.now();
    const hit = messageCache.get(text);

    if (hit && hit.expiresAt > now) {
      // Refresh recency so the oldest-inserted entry is the least recently used.
      messageCache.delete(text);
      messageCache.set(text, hit);

      return hit.vector;
    }

    const { vector } = await embedder.embed(text);

    messageCache.delete(text);
    messageCache.set(text, { vector, expiresAt: now + cacheTtl });

    while (messageCache.size > cacheMax) {
      const oldest = messageCache.keys().next().value as string;

      messageCache.delete(oldest);
    }

    return vector;
  };

  const score = (vector: number[]): Array<{ intent: string; score: number }> => {
    const ranked: Array<{ intent: string; score: number }> = [];

    for (const [intent, examples] of index) {
      let best = -1;

      for (const example of examples) {
        best = Math.max(best, cosine(vector, example.vector));
      }

      ranked.push({ intent, score: best });
    }

    return ranked.sort((left, right) => right.score - left.score);
  };

  const learnFrom = async (
    text: string,
    vector: number[],
    chosen: string,
    topScore: number,
  ): Promise<void> => {
    if (!learnOptions || text.length > MAX_LEARNED_PHRASE_LENGTH || topScore < learnOptions.minScore) {
      return;
    }

    const known = (index.get(chosen) ?? []).some((example) => example.phrase === text);

    if (known) {
      return;
    }

    addToIndex(chosen, text, vector);
    learned.push({ intent: chosen, phrase: text, vector, at: Date.now() });

    const own = learned.filter((item) => item.intent === chosen);

    for (const extra of own.slice(0, Math.max(0, own.length - learnOptions.maxPerIntent))) {
      learned.splice(learned.indexOf(extra), 1);

      const list = index.get(chosen) ?? [];
      const at = list.findIndex((example) => example.phrase === extra.phrase);

      if (at !== -1) {
        list.splice(at, 1);
      }
    }

    await persistLearned();
  };

  const runFallback = async (
    message: string,
    options: AgentExecuteOptions<unknown> | undefined,
    meta: RouterDecisionMeta,
    learning?: { text: string; vector: number[]; topIntent?: string; topScore: number },
  ): Promise<AgentResult<unknown>> => {
    const result = await fallback.execute(message, options);
    const data = result.data;

    if (!data || typeof data !== "object") {
      return result;
    }

    const next = (data as { next?: unknown }).next;

    if (learning && typeof next === "string" && next === learning.topIntent && next !== END) {
      await learnFrom(learning.text, learning.vector, next, learning.topScore);
    }

    return { ...result, data: { ...(data as object), ...meta } };
  };

  const execute = async (
    message: string,
    options?: AgentExecuteOptions<unknown>,
  ): Promise<AgentResult<unknown>> => {
    const { input, firstIteration } = readRouterMessage(message);

    if (!firstIteration || !input) {
      return runFallback(message, options, { routedBy: "fallback" });
    }

    let vector: number[];

    try {
      await ensureReady();
      vector = await embedMessage(input);
    } catch {
      return runFallback(message, options, { routedBy: "fallback" });
    }

    const ranked = score(vector);
    const top = ranked[0];
    const runnerUp = ranked[1];
    const runnerUpMeta = runnerUp ? { intent: runnerUp.intent, score: runnerUp.score } : undefined;

    if (top && top.score >= minScore && (!runnerUp || top.score - runnerUp.score >= margin)) {
      return semanticResult(top.intent, top.score, runnerUpMeta, embedder);
    }

    return runFallback(
      message,
      options,
      {
        routedBy: "fallback",
        ...(top ? { score: top.score } : {}),
        ...(runnerUpMeta ? { runnerUp: runnerUpMeta } : {}),
      },
      { text: input, vector, topIntent: top?.intent, topScore: top?.score ?? 0 },
    );
  };

  return {
    name: fallback.name,
    isAnonymous: false,
    description: "Routes a supervisor run by embedding similarity, falling back to a model.",
    signature: `${fallback.signature}:semantic`,
    execute,
    stream: (input, options) => fallback.stream(input, options) as never,
    resume: (runId, options) => fallback.resume(runId, options as never) as never,
    on: (event, handler) => fallback.on(event, handler),
    off: (event, handler) => fallback.off(event, handler),
    eval: (options) => fallback.eval(options as never) as never,
    warm: ensureReady,
  } as SemanticRouter;
}

function semanticResult(
  intent: string,
  score: number,
  runnerUp: RouterDecisionMeta["runnerUp"],
  embedder: EmbedderContract,
): AgentResult<unknown> {
  const runId = generateRunId("agent");
  const now = new Date().toISOString();
  const usage = { input: 0, output: 0, total: 0 };

  const data: RouterOutput & RouterDecisionMeta = {
    next: intent,
    reasoning: `Semantic match with "${intent}" (similarity ${score.toFixed(3)}).`,
    routedBy: "semantic",
    score,
    ...(runnerUp ? { runnerUp } : {}),
  };

  const report: AgentReport = {
    runId,
    rootRunId: runId,
    name: "semantic-router",
    type: "agent",
    status: "completed",
    startedAt: now,
    endedAt: now,
    duration: 0,
    usage,
    children: [],
    model: { name: embedder.name, provider: embedder.provider },
    trips: [],
  };

  return { type: "agent", data, text: JSON.stringify(data), usage, report };
}

function resolveLearn(
  learn: SemanticRouterConfig["learn"],
  min: number,
): { maxPerIntent: number; minScore: number } | undefined {
  if (!learn) {
    return undefined;
  }

  const options = learn === true ? {} : learn;

  return {
    maxPerIntent: options.maxPerIntent ?? DEFAULT_MAX_PER_INTENT,
    minScore: options.minScore ?? Math.max(0, min - 0.1),
  };
}

function validateConfig(config: SemanticRouterConfig): void {
  if (!config.name) {
    throw new TypeError("ai.semanticRouter: `name` is required");
  }

  if (!config.embedder) {
    throw new TypeError("ai.semanticRouter: `embedder` is required");
  }

  if (!config.fallback) {
    throw new TypeError("ai.semanticRouter: `fallback` is required");
  }

  if (!config.intents || Object.keys(config.intents).length === 0) {
    throw new TypeError("ai.semanticRouter: `intents` must contain at least one entry");
  }

  if (!config.confidence || typeof config.confidence.min !== "number") {
    throw new TypeError("ai.semanticRouter: `confidence.min` is required");
  }

  for (const intent of Object.keys(config.examples ?? {})) {
    if (!(intent in config.intents)) {
      throw new TypeError(
        `ai.semanticRouter("${config.name}"): \`examples\` names unknown intent "${intent}" (known: ${Object.keys(config.intents).join(", ")})`,
      );
    }
  }
}
