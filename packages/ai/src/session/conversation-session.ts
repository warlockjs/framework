import { createAgentStream } from "../agent/agent-stream";
import type {
  AgentExecuteOptions,
  AgentResumeOptions,
} from "../contracts/agent/agent-options.type";
import type { ContentPart } from "../contracts/content-part.type";
import type { Message } from "../contracts/conversation-message.type";
import type { SessionLock } from "../contracts/orchestrator/session-lock.contract";
import type { SnapshotStore } from "../contracts/orchestrator/snapshot-store.contract";
import type { AgentResult } from "../contracts/result/agent-result.type";
import type { CapturedMessage } from "../contracts/result/execution-report.type";
import type { StreamContract } from "../contracts/stream/stream.contract";
import { AgentExecutionError } from "../errors";
import { inProcessSessionLock, noopSessionLock } from "../orchestrator/session-lock";
import { generateRunId } from "../utils/generate-run-id";
import type {
  ConversationSendOptions,
  ConversationSession,
  ConversationSessionConfig,
  ConversationSessionRecord,
} from "./conversation-session.type";

/** Store-key prefix, so session records never collide with run snapshots in a shared store. */
const KEY_PREFIX = "session:";

/**
 * One default in-process lock per store: two `ai.session()` objects with the
 * same id on the same store serialize against each other.
 */
const defaultLocks = new WeakMap<object, SessionLock>();

function defaultLock(store: object): SessionLock {
  let lock = defaultLocks.get(store);

  if (!lock) {
    lock = inProcessSessionLock();
    defaultLocks.set(store, lock);
  }

  return lock;
}

type RunAgent<TOutput> = (options: AgentExecuteOptions<TOutput>) => Promise<AgentResult<TOutput>>;

class Session<TOutput> implements ConversationSession<TOutput> {
  public readonly id: string;
  private readonly key: string;
  private readonly lock: SessionLock;

  public constructor(private readonly config: ConversationSessionConfig<TOutput>) {
    this.id = config.id;
    this.key = `${KEY_PREFIX}${config.id}`;
    this.lock =
      config.lock === false ? noopSessionLock() : (config.lock ?? defaultLock(config.store));
  }

  public send(
    input: string,
    options?: ConversationSendOptions<TOutput>,
  ): Promise<AgentResult<TOutput>> {
    return this.runTurn(input, options, (runOptions) =>
      this.config.agent.execute(input, runOptions),
    );
  }

  public stream(
    input: string,
    options?: ConversationSendOptions<TOutput>,
  ): StreamContract<AgentResult<TOutput>> {
    const { controller, stream } = createAgentStream<AgentResult<TOutput>>();

    this.runTurn(input, options, async (runOptions) => {
      const inner = this.config.agent.stream(input, runOptions);

      for await (const event of inner) {
        controller.push(event);
      }

      return inner.result;
    }).then(
      (result) => controller.end(result),
      (error: unknown) =>
        controller.fail(error instanceof Error ? error : new Error(String(error))),
    );

    return stream;
  }

  public async history(): Promise<Message[]> {
    return structuredClone((await this.load())?.messages ?? []);
  }

  public load(): Promise<ConversationSessionRecord | undefined> {
    return this.config.store.load(this.key);
  }

  public async fork(
    id: string,
    options?: { messageCount?: number },
  ): Promise<ConversationSession<TOutput>> {
    assertId(id);

    if (id === this.id) {
      throw new AgentExecutionError(`session "${id}" cannot be forked into itself.`);
    }

    const source = await this.lock.withLock(this.key, () => this.load());
    const messages = source?.messages ?? [];
    const messageCount = options?.messageCount ?? messages.length;

    assertCut(messages, messageCount);

    const target = new Session<TOutput>({ ...this.config, id });

    await target.lock.withLock(target.key, async () => {
      if (await target.load()) {
        throw new AgentExecutionError(`session "${id}" already exists; fork into a new id.`);
      }

      const now = new Date().toISOString();

      await target.config.store.save({
        ...emptyRecord(id, now),
        messages: structuredClone(messages.slice(0, messageCount)),
        forkedFrom: { id: this.id, messageCount },
      });
    });

    return target;
  }

  public truncate(messageCount: number): Promise<void> {
    return this.lock.withLock(this.key, async () => {
      const record = await this.load();
      const messages = record?.messages ?? [];

      assertCut(messages, messageCount);

      if (!record || messageCount === messages.length) {
        return;
      }

      await this.config.store.save({
        ...record,
        messages: messages.slice(0, messageCount),
        updatedAt: new Date().toISOString(),
      });
    });
  }

  public resume(
    options?: Omit<AgentResumeOptions<TOutput>, "history" | "captureMessages">,
  ): Promise<AgentResult<TOutput> | undefined> {
    return this.lock.withLock(
      this.key,
      async () => {
        const record = await this.load();
        const pending = record?.pending;

        if (!record || !pending) {
          return undefined;
        }

        const result = await this.config.agent.resume(pending.runId, {
          ...options,
          captureMessages: true,
          sessionId: options?.sessionId ?? this.id,
        });

        await this.settle(record, pending.input, false, result);

        return result;
      },
      { signal: options?.signal },
    );
  }

  public clear(): Promise<void> {
    return this.lock.withLock(this.key, () => this.config.store.delete(this.key));
  }

  /** Load → mark pending → run → append and save, all under the session lock. */
  private runTurn(
    input: string,
    options: ConversationSendOptions<TOutput> | undefined,
    run: RunAgent<TOutput>,
  ): Promise<AgentResult<TOutput>> {
    return this.lock.withLock(
      this.key,
      async () => {
        const now = new Date().toISOString();
        const stored = await this.load();
        const record: ConversationSessionRecord = {
          ...(stored ?? emptyRecord(this.id, now)),
          pending: undefined,
        };
        const runId = options?.runId ?? generateRunId("agent");

        await this.config.store.save({
          ...record,
          pending: { runId, input, startedAt: now },
        });

        let result: AgentResult<TOutput>;

        try {
          result = await run({
            ...options,
            runId,
            history: structuredClone(record.messages),
            captureMessages: true,
            sessionId: options?.sessionId ?? this.id,
          });
        } catch (error) {
          // The run threw before settling: drop the pending marker, keep the
          // history, and surface the run's error rather than a store error.
          await this.config.store.save(record).catch(() => undefined);
          throw error;
        }

        await this.settle(record, input, Boolean(options?.attachments?.length), result);

        return result;
      },
      { signal: options?.signal },
    );
  }

  /** Save the conversation after a run: the new turn on success, unchanged otherwise. */
  private async settle(
    record: ConversationSessionRecord,
    input: string,
    withAttachments: boolean,
    result: AgentResult<TOutput>,
  ): Promise<void> {
    const succeeded = !result.error && result.report.status === "completed";

    await this.config.store.save({
      ...record,
      pending: undefined,
      ...(succeeded
        ? {
            messages: conversationAfterRun(record.messages, input, withAttachments, result),
            turns: record.turns + 1,
          }
        : {}),
      updatedAt: new Date().toISOString(),
    });
  }
}

function emptyRecord(id: string, now: string): ConversationSessionRecord {
  return {
    runId: `${KEY_PREFIX}${id}`,
    type: "conversation-session",
    id,
    messages: [],
    turns: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The conversation to store after a successful run: the run's assembled
 * messages (history — compacted when the agent compacted it — the input,
 * every tool round) without the agent's own system prompt, plus the final
 * reply exactly as the model sent it.
 */
function conversationAfterRun<TOutput>(
  previous: Message[],
  input: string,
  withAttachments: boolean,
  result: AgentResult<TOutput>,
): Message[] {
  const captured = result.report.messages;

  if (!captured) {
    throw new AgentExecutionError(
      "ai.session: the agent run returned no captured messages, so the turn cannot be stored.",
    );
  }

  const start = result.report.systemPrompt !== undefined && captured[0]?.role === "system" ? 1 : 0;
  const multipart = new Map<string, ContentPart[]>();

  for (const message of previous) {
    if (Array.isArray(message.content)) {
      multipart.set(JSON.stringify(message.content), message.content);
    }
  }

  const messages = captured
    .slice(start)
    .map((message) => toMessage(message, multipart, withAttachments ? input : undefined));
  const finalTrip = result.report.trips.at(-1);

  // Tool-call and paused trips are already in the assembled messages; a
  // final answer is not, so append it with its provider blocks.
  if (
    finalTrip &&
    finalTrip.finishReason !== "tool_calls" &&
    finalTrip.finishReason !== "pause_turn"
  ) {
    messages.push({
      role: "assistant",
      content: finalTrip.output,
      ...(finalTrip.blocks ? { blocks: finalTrip.blocks } : {}),
    });
  }

  return messages;
}

/**
 * Captured messages carry text content only; user turns that were
 * multipart (attachments) come back as their JSON form. Restore those that
 * match a stored multipart message, or this run's input with attachments.
 */
function toMessage(
  captured: CapturedMessage,
  multipart: Map<string, ContentPart[]>,
  attachmentsInput: string | undefined,
): Message {
  const message: Message = {
    role: captured.role,
    content: restoreContent(captured, multipart, attachmentsInput),
  };

  if (captured.toolCalls !== undefined) message.toolCalls = captured.toolCalls;
  if (captured.toolCallId !== undefined) message.toolCallId = captured.toolCallId;
  if (captured.blocks !== undefined) message.blocks = captured.blocks;
  if (captured.compaction !== undefined) message.compaction = captured.compaction;

  return message;
}

function restoreContent(
  captured: CapturedMessage,
  multipart: Map<string, ContentPart[]>,
  attachmentsInput: string | undefined,
): string | ContentPart[] {
  if (captured.role !== "user" || !captured.content.startsWith("[")) {
    return captured.content;
  }

  const known = multipart.get(captured.content);

  if (known) {
    return structuredClone(known);
  }

  if (attachmentsInput === undefined) {
    return captured.content;
  }

  try {
    const parsed: unknown = JSON.parse(captured.content);

    if (Array.isArray(parsed) && isInputParts(parsed, attachmentsInput)) {
      return parsed;
    }
  } catch {
    // Plain text that happens to start with "[".
  }

  return captured.content;
}

/** The agent builds an attachment turn as the input text part followed by the attachments. */
function isInputParts(parts: unknown[], input: string): parts is ContentPart[] {
  const first: unknown = parts[0];

  return (
    parts.every(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        typeof (part as { type?: unknown }).type === "string",
    ) &&
    typeof first === "object" &&
    first !== null &&
    (first as { type?: unknown }).type === "text" &&
    (first as { text?: unknown }).text === input
  );
}

function assertId(id: string): void {
  if (typeof id !== "string" || id.trim() === "") {
    throw new AgentExecutionError("ai.session requires a non-empty string id.", {
      context: { authoring: true },
    });
  }
}

/** A cut must be a valid index and must not split a tool call from its result. */
function assertCut(messages: Message[], messageCount: number): void {
  if (!Number.isSafeInteger(messageCount) || messageCount < 0 || messageCount > messages.length) {
    throw new AgentExecutionError(
      `message count must be an integer between 0 and ${messages.length}; got ${messageCount}.`,
    );
  }

  const kept = messages.slice(0, messageCount);
  const answered = new Set(
    kept.filter((message) => message.role === "tool").map((message) => message.toolCallId),
  );
  const open = kept.flatMap(
    (message) => message.toolCalls?.filter((call) => !answered.has(call.id)) ?? [],
  );

  if (open.length > 0) {
    throw new AgentExecutionError(
      `cutting at ${messageCount} would separate tool call "${open[0]?.id}" from its result.`,
    );
  }
}

/**
 * Create a persisted conversation with one agent. Each `send` loads the
 * stored history, runs the agent with it, appends the whole turn — tool
 * rounds and provider blocks (signed thinking, compaction) included — and
 * saves it. Calls on one session id are serialized, so two concurrent
 * sends never interleave history.
 *
 * @example
 * const chat = ai.session({
 *   id: "user-42",
 *   store: ai.snapshot.file({ dir: ".warlock/sessions" }),
 *   agent: assistant,
 * });
 *
 * await chat.send("My name is Sara.");
 * const result = await chat.send("What is my name?");
 */
export function session<TOutput = unknown>(
  config: ConversationSessionConfig<TOutput>,
): ConversationSession<TOutput> {
  if (!config || typeof config !== "object") {
    throw new AgentExecutionError("ai.session requires { id, store, agent }.", {
      context: { authoring: true },
    });
  }

  assertId(config.id);

  if (!isStore(config.store)) {
    throw new AgentExecutionError(
      "ai.session requires a snapshot store (load, save, delete), e.g. ai.snapshot.file({ dir }).",
      { context: { authoring: true } },
    );
  }

  if (
    !config.agent ||
    typeof config.agent.execute !== "function" ||
    typeof config.agent.stream !== "function"
  ) {
    throw new AgentExecutionError("ai.session requires an agent created with ai.agent().", {
      context: { authoring: true },
    });
  }

  return new Session<TOutput>(config);
}

function isStore(store: SnapshotStore<ConversationSessionRecord> | undefined): boolean {
  return Boolean(
    store &&
    typeof store.load === "function" &&
    typeof store.save === "function" &&
    typeof store.delete === "function",
  );
}
