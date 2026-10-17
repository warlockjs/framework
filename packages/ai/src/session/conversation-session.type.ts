import type { AgentContract } from "../contracts/agent/agent.contract";
import type {
  AgentExecuteOptions,
  AgentResumeOptions,
} from "../contracts/agent/agent-options.type";
import type { Message } from "../contracts/conversation-message.type";
import type { SessionLock } from "../contracts/orchestrator/session-lock.contract";
import type { SnapshotStore } from "../contracts/orchestrator/snapshot-store.contract";
import type { AgentResult } from "../contracts/result/agent-result.type";
import type { StreamContract } from "../contracts/stream/stream.contract";

/**
 * The persisted state of one conversation, saved under
 * `runId = "session:" + id` in a {@link SnapshotStore}.
 */
export type ConversationSessionRecord = {
  /** Store key: `session:<id>`. */
  runId: string;
  type: "conversation-session";
  /** The session id passed to `ai.session({ id })`. */
  id: string;
  /**
   * The conversation as the agent will see it next turn: user inputs,
   * assistant turns (with tool calls and provider `blocks`), tool results
   * and any compaction summary. Never includes the agent's system prompt.
   */
  messages: Message[];
  /** Completed `send` / `resume` calls. */
  turns: number;
  createdAt: string;
  updatedAt: string;
  /** Set on a fork: the source session and how many of its messages were copied. */
  forkedFrom?: { id: string; messageCount: number };
  /**
   * A send that started but has not settled — left behind when the process
   * stopped mid-run. `session.resume()` continues it when the agent is
   * `durable`; the next `send` replaces it.
   */
  pending?: { runId: string; input: string; startedAt: string };
};

/** `ai.session()` configuration. */
export type ConversationSessionConfig<TOutput = unknown> = {
  /** Conversation id (the store key is `session:<id>`). */
  id: string;
  /** Where the conversation is kept — `ai.snapshot.file()`, `.sqlite()`, `.memory()`, … */
  store: SnapshotStore<ConversationSessionRecord>;
  /** The agent that answers each turn. */
  agent: AgentContract<TOutput>;
  /**
   * Serializes calls on one session id so two `send`s never interleave
   * history. Default: an in-process lock shared by every session on the
   * same store. Pass a distributed {@link SessionLock} when several
   * processes share the store, or `false` when something else already
   * guarantees a single writer.
   */
  lock?: SessionLock | false;
};

/** Per-turn options: the agent's execute options minus what the session owns. */
export type ConversationSendOptions<TOutput = unknown> = Omit<
  AgentExecuteOptions<TOutput>,
  "history" | "captureMessages"
>;

/** A persisted multi-turn conversation with one agent (`ai.session()`). */
export interface ConversationSession<TOutput = unknown> {
  readonly id: string;
  /**
   * Run one turn: load the history, run `agent.execute(input, { history })`,
   * append the turn (tool rounds and provider blocks included) and save.
   * A failed or cancelled run leaves the history unchanged.
   */
  send(input: string, options?: ConversationSendOptions<TOutput>): Promise<AgentResult<TOutput>>;
  /** `send` through `agent.stream`; `stream.result` settles after the turn is saved. */
  stream(
    input: string,
    options?: ConversationSendOptions<TOutput>,
  ): StreamContract<AgentResult<TOutput>>;
  /** The stored conversation (a copy). Empty for a new session. */
  history(): Promise<Message[]>;
  /** The stored record, or `undefined` before the first save. */
  load(): Promise<ConversationSessionRecord | undefined>;
  /**
   * Copy the first `messageCount` messages (default: all) into a new
   * session `id` and return it. The copy keeps the prefix byte-for-byte, so
   * signed reasoning in it stays valid. Throws when `id` already exists.
   */
  fork(id: string, options?: { messageCount?: number }): Promise<ConversationSession<TOutput>>;
  /**
   * Keep only the first `messageCount` messages. Throws when the cut would
   * separate a tool call from its result.
   */
  truncate(messageCount: number): Promise<void>;
  /**
   * Continue a send interrupted by a crash, through `agent.resume(runId)`
   * (the agent needs `durable`). Resolves `undefined` when nothing is pending.
   */
  resume(
    options?: Omit<AgentResumeOptions<TOutput>, "history" | "captureMessages">,
  ): Promise<AgentResult<TOutput> | undefined>;
  /** Delete the stored conversation. */
  clear(): Promise<void>;
}
