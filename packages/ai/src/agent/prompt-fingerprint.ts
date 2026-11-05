import type { Message } from "../contracts/conversation-message.type";
import type { ModelCallOptions } from "../contracts/model.contract";
import type {
  CacheMissSegment,
  PromptFingerprint,
} from "../contracts/result/prompt-fingerprint.type";
import type { Usage } from "../contracts/result/usage.type";
import { hashText, stableJson } from "../utils/hash-text";

/** Fingerprint plus the per-segment detail the tracker compares between trips. */
type TripSnapshot = {
  fingerprint: PromptFingerprint;
  /** Hash of the call options that change a cached prefix (model, schema, provider tools, cache key). */
  options: string;
  /** One hash per non-system message. */
  history: string[];
};

/** What {@link PromptFingerprintTracker.finish} reports for a trip. */
export type PromptFingerprintOutcome = {
  fingerprint: PromptFingerprint;
  /** Set when the trip lost its cache and the request changed; names the changed segments. */
  cacheMiss?: {
    segments: CacheMissSegment[];
    cachedTokens: number;
    expectedCachedTokens: number;
  };
};

function safeJson(value: unknown): string {
  try {
    return stableJson(value) ?? "";
  } catch {
    return "unserializable";
  }
}

function messageText(message: Message): string {
  return safeJson({
    role: message.role,
    content: message.content,
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls,
  });
}

/**
 * Hash the cache-relevant parts of a request. `prefixMessages` limits the
 * `messagesPrefix` hash to that many leading non-system messages (all of
 * them when omitted).
 *
 * @example
 * computePromptFingerprint(messages, { tools }).tools; // changes only when a tool definition changes
 */
export function computePromptFingerprint(
  messages: readonly Message[],
  options?: Pick<ModelCallOptions, "tools">,
  prefixMessages?: number,
): PromptFingerprint {
  return snapshot(messages, options, "", prefixMessages).fingerprint;
}

function snapshot(
  messages: readonly Message[],
  options: ModelCallOptions | undefined,
  model: string,
  prefixMessages?: number,
): TripSnapshot {
  const system = messages.filter((message) => message.role === "system").map(messageText);
  const history = messages.filter((message) => message.role !== "system").map(messageText);
  const tools = (options?.tools ?? []).map((tool) => safeJson(tool));
  const prefix = history.slice(0, prefixMessages ?? history.length).map(hashText);

  return {
    fingerprint: {
      system: hashText(system.join("\n")),
      tools: hashText(tools.join("\n")),
      messagesPrefix: hashText(prefix.join("\n")),
    },
    options: hashText(
      safeJson({
        model,
        providerTools: options?.providerTools,
        responseSchema: options?.responseSchema,
        cacheKey: options?.cacheControl?.key,
      }),
    ),
    history: history.map(hashText),
  };
}

/**
 * Per-run bookkeeping for `diagnostics.cacheFingerprint`: fingerprints each
 * model request, remembers the previous trip, and names the request segment
 * that changed when a trip that should have hit the cache did not.
 *
 * A miss needs a previous trip that read or wrote cache tokens, so a cold
 * first trip never reports one. When the prompt is unchanged between the two
 * trips (expiry, eviction, below the provider's minimum size), no cause is
 * named and nothing is reported.
 */
export class PromptFingerprintTracker {
  private previous?: { snapshot: TripSnapshot; usage?: Usage };
  private pending?: TripSnapshot;

  public constructor(private readonly modelName: string) {}

  /** Fingerprint the request about to be sent. */
  public begin(messages: readonly Message[], options: ModelCallOptions): void {
    this.pending = snapshot(
      messages,
      options,
      this.modelName,
      this.previous?.snapshot.history.length,
    );
  }

  /** Close the trip with its usage; undefined when no request was fingerprinted (e.g. middleware answered). */
  public finish(usage: Usage): PromptFingerprintOutcome | undefined {
    const current = this.pending;

    this.pending = undefined;

    if (!current) return undefined;

    const before = this.previous;

    this.previous = { snapshot: current, usage };

    const outcome: PromptFingerprintOutcome = { fingerprint: current.fingerprint };

    if (!before?.usage) return outcome;

    const expected = (before.usage.cachedTokens ?? 0) + (before.usage.cacheWriteTokens ?? 0);
    const cached = usage.cachedTokens ?? 0;

    if (expected <= 0 || cached >= expected / 2) return outcome;

    const segments = changedSegments(before.snapshot, current);

    if (segments.length > 0) {
      outcome.cacheMiss = { segments, cachedTokens: cached, expectedCachedTokens: expected };
    }

    return outcome;
  }
}

function changedSegments(before: TripSnapshot, current: TripSnapshot): CacheMissSegment[] {
  const segments: CacheMissSegment[] = [];

  if (before.fingerprint.system !== current.fingerprint.system) segments.push("system");
  if (before.fingerprint.tools !== current.fingerprint.tools) segments.push("tools");
  if (before.options !== current.options) segments.push("options");

  const rewritten = before.history.some((hash, index) => current.history[index] !== hash);

  if (rewritten) segments.push("messages");

  return segments;
}
