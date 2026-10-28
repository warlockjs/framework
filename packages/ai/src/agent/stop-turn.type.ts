import type { Message } from "../contracts/conversation-message.type";
import type { ToolCall } from "../contracts/result/tool-call.type";
import type { Usage } from "../contracts/result/usage.type";

/**
 * What `stopWhen` sees after a trip's tool calls have run. The run ends
 * without another model call when the callback returns `true`.
 */
export type AgentStopContext = {
  /** Zero-based index of the trip that requested the tools. */
  tripIndex: number;
  /** The tool calls this trip dispatched, in request order (failed calls included). */
  toolCalls: readonly ToolCall[];
  /** Text the model wrote beside the tool calls. */
  text: string;
  /** Usage of the whole run so far, including this trip. */
  usage: Readonly<Usage>;
  /** The conversation so far, tool results included. Read-only. */
  messages: readonly Message[];
};

/** Decide whether the tool calls of a trip end the run. May be async. */
export type AgentStopWhen = (context: AgentStopContext) => boolean | Promise<boolean>;
