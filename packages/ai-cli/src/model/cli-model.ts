import type {
  Message,
  ModelCallOptions,
  ModelCapabilities,
  ModelContract,
  ModelPricing,
  ModelResponse,
  ModelStreamChunk,
  Usage,
} from "@warlock.js/ai";
import type { CliAgent } from "../cli-agent";
import type { CliResult, CliRunOptions, CliUsage } from "../contracts";
import { CliError } from "../errors";

/** Configuration of a CLI-backed model. Run options apply to every call. */
export type CliModelConfig = CliRunOptions & {
  /** Model name reported to the agent, reports and observers. Default: `model`, else the adapter name. */
  name?: string;
  /** Per-million-token pricing, so the agent computes `Usage.cost` (and USD budgets apply). */
  pricing?: ModelPricing;
};

/** The text of one message; CLI models accept text only. */
function messageText(message: Message, adapter: string): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .map((part) => {
      if (part.type !== "text") {
        throw new CliError(
          `${adapter}: CLI models accept text only; a "${part.type}" attachment cannot be passed to the CLI.`,
          { type: "unsupported-option", adapter },
        );
      }

      return part.text;
    })
    .join("\n");
}

/**
 * Render an agent conversation into one CLI prompt. System messages become
 * a leading instruction block; a single user turn is passed as-is; a longer
 * history is rendered as a labelled transcript ending with the latest turn.
 *
 * @example
 * renderPrompt([{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }], "codex");
 * // "Be brief.\n\nHi"
 */
export function renderPrompt(messages: Message[], adapter: string): string {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => messageText(message, adapter).trim())
    .filter((text) => text.length > 0);
  const turns = messages.filter((message) => message.role !== "system");
  const only = turns.length === 1 ? turns[0] : undefined;
  const body =
    only !== undefined && only.role === "user"
      ? messageText(only, adapter)
      : turns
          .map((message) => {
            const label =
              message.role === "user"
                ? "User"
                : message.role === "assistant"
                  ? "Assistant"
                  : `Tool result${message.toolCallId ? ` (${message.toolCallId})` : ""}`;

            return `${label}:\n${messageText(message, adapter)}`;
          })
          .join("\n\n");

  return [...system, body].filter((part) => part.length > 0).join("\n\n");
}

/** Map CLI usage to the framework `Usage` (zeros when the CLI reported none). */
export function toUsage(usage: CliUsage | undefined): Usage {
  if (usage === undefined) {
    return { input: 0, output: 0, total: 0 };
  }

  const mapped: Usage = { input: usage.input, output: usage.output, total: usage.total };

  if (usage.cachedTokens !== undefined) mapped.cachedTokens = usage.cachedTokens;
  if (usage.cacheWriteTokens !== undefined) mapped.cacheWriteTokens = usage.cacheWriteTokens;
  if (usage.reasoningTokens !== undefined) mapped.reasoningTokens = usage.reasoningTokens;

  return mapped;
}

function abortError(message: string): Error {
  const error = new Error(message);

  error.name = "AbortError";

  return error;
}

/**
 * A `ModelContract` backed by a CLI agent, so `ai.agent({ model })` — and
 * its budget, guardrail, observer and fallback middleware — can drive a
 * coding CLI.
 *
 * Each call is one fresh CLI session: the conversation is rendered into a
 * single prompt (see {@link renderPrompt}) and the session's final answer
 * becomes the response. The CLI runs its own tools; framework tools cannot
 * be handed to it this way (give the CLI MCP servers with `mcp` instead),
 * so a call carrying `tools` is refused. `stream()` yields the final answer
 * once the session ends — read `session.events` from `agent.run()` for live
 * progress.
 *
 * @example
 * const coder = cli.codex({ cwd: "/srv/repo" });
 * const reviewer = ai.agent({
 *   model: cliModel(coder, { name: "codex" }),
 *   middleware: [budget({ maxTokens: 200_000 })],
 * });
 * const { text } = await reviewer.execute("Review the last commit.");
 */
export function cliModel(agent: CliAgent, config: CliModelConfig = {}): ModelContract {
  const { adapter } = agent;
  const capabilities: ModelCapabilities = { reasoning: adapter.effort === true };

  const execute = async (
    messages: Message[],
    options: ModelCallOptions = {},
  ): Promise<CliResult> => {
    if (options.tools !== undefined && options.tools.length > 0) {
      throw new CliError(
        `${adapter.title}: a CLI model runs the CLI's own tools; pass framework tools to the CLI as MCP servers (\`mcp\`) instead of agent \`tools\`.`,
        { type: "unsupported-option", adapter: adapter.name },
      );
    }

    const { name: _name, pricing: _pricing, ...runDefaults } = config;
    const effort = options.reasoning?.effort;
    const session = await agent.run(renderPrompt(messages, adapter.name), {
      ...runDefaults,
      signal: options.signal ?? runDefaults.signal,
      effort: adapter.effort === true && effort !== undefined ? effort : runDefaults.effort,
    });
    const result = await session.done();

    if (result.status === "cancelled") {
      throw abortError(result.error ?? `${adapter.name} run was cancelled`);
    }

    if (result.status !== "completed") {
      throw new CliError(`${adapter.title}: ${result.error ?? `run ${result.status}`}`, {
        type: "run-failed",
        adapter: adapter.name,
        context: {
          status: result.status,
          exitCode: result.exitCode,
          sessionRef: result.sessionRef,
        },
      });
    }

    return result;
  };

  return {
    name: config.name ?? config.model ?? agent.options.model ?? adapter.name,
    provider: adapter.name,
    capabilities,
    pricing: config.pricing,
    async complete(messages: Message[], options?: ModelCallOptions): Promise<ModelResponse> {
      const result = await execute(messages, options);

      return { content: result.text, finishReason: "stop", usage: toUsage(result.usage) };
    },
    async *stream(
      messages: Message[],
      options?: ModelCallOptions,
    ): AsyncIterable<ModelStreamChunk> {
      const result = await execute(messages, options);

      if (result.text.length > 0) {
        yield { type: "delta", content: result.text };
      }

      yield { type: "done", finishReason: "stop", usage: toUsage(result.usage) };
    },
  };
}
