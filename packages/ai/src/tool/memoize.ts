import type { ToolMemoizeOption } from "../contracts/tool.contract";
import { generateRunId } from "../utils/generate-run-id";
import { stableJson } from "../utils/hash-text";
import type { ToolInvokeResult } from "./tool";

type MemoEntry = {
  promise: Promise<ToolInvokeResult<unknown>>;
  expiresAt: number;
};

type ResolvedMemoize = { scope: "run" | "session"; ttlMs: number | undefined };

/** Default lifetime of a session-scoped result. */
const DEFAULT_SESSION_TTL_MS = 5 * 60_000;
const MAX_SESSIONS = 200;
const MAX_ENTRIES_PER_SCOPE = 500;

const sessions = new Map<string, Map<string, MemoEntry>>();

/** Normalize `memoize: true | { scope?, ttl? }`; `undefined` when memoization is off. */
export function resolveToolMemoize(
  option: ToolMemoizeOption | undefined,
): ResolvedMemoize | undefined {
  if (!option) {
    return undefined;
  }

  const options = option === true ? {} : option;
  const scope = options.scope ?? "run";

  return {
    scope,
    ttlMs: options.ttl ?? (scope === "session" ? DEFAULT_SESSION_TTL_MS : undefined),
  };
}

/** Forget every session-scoped result (tests, and apps that rotate data under sessions). */
export function clearToolMemo(): void {
  sessions.clear();
}

function sessionEntries(sessionId: string): Map<string, MemoEntry> {
  let entries = sessions.get(sessionId);

  if (entries) {
    sessions.delete(sessionId);
  } else {
    entries = new Map();
  }

  sessions.set(sessionId, entries);

  while (sessions.size > MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value as string);
  }

  return entries;
}

/** A hit gets its own report so run ids stay unique and no work is attributed to it. */
function asHit(cached: ToolInvokeResult<unknown>): ToolInvokeResult<unknown> {
  const runId = generateRunId("tool");
  const now = new Date().toISOString();

  return {
    ...cached,
    usage: { input: 0, output: 0, total: 0 },
    report: {
      ...cached.report,
      runId,
      rootRunId: runId,
      startedAt: now,
      endedAt: now,
      duration: 0,
      usage: { input: 0, output: 0, total: 0 },
    },
  };
}

/**
 * Run a tool through its result memo. The same tool and (stably stringified)
 * arguments inside the scope share one result; a failed call is never kept.
 * Without a `sessionId`, `scope: "session"` falls back to the run memo.
 */
export async function invokeMemoized(params: {
  toolName: string;
  version?: string;
  input: unknown;
  option: ResolvedMemoize;
  runMemo: Map<string, MemoEntry>;
  sessionId?: string;
  invoke: () => Promise<ToolInvokeResult<unknown>>;
}): Promise<{ result: ToolInvokeResult<unknown>; hit: boolean }> {
  const { option } = params;
  const entries =
    option.scope === "session" && params.sessionId
      ? sessionEntries(params.sessionId)
      : params.runMemo;

  const key = `${params.toolName}@${params.version ?? ""}|${stableJson(params.input)}`;
  const now = Date.now();
  const existing = entries.get(key);

  if (existing && existing.expiresAt > now) {
    const result = await existing.promise;

    if (!result.error) {
      return { result: asHit(result), hit: true };
    }
  }

  const promise = params.invoke();

  entries.set(key, {
    promise,
    expiresAt: option.ttlMs === undefined ? Number.POSITIVE_INFINITY : now + option.ttlMs,
  });

  while (entries.size > MAX_ENTRIES_PER_SCOPE) {
    entries.delete(entries.keys().next().value as string);
  }

  const result = await promise;

  if (result.error && entries.get(key)?.promise === promise) {
    entries.delete(key);
  }

  return { result, hit: false };
}

export type { MemoEntry };
