import type { StandardSchemaV1 } from "@standard-schema/spec";
import { log, type Logger } from "@warlock.js/logger";
import type { ModelCallOptions } from "../contracts/model.contract";
import type { ProviderToolDefinition } from "../contracts/provider-tool.type";
import type {
  ToolActionResolver,
  ToolConfig,
  ToolContext,
  ToolMeta,
  ToolMode,
} from "../contracts/tool.contract";
import { tool, type ToolContract } from "./tool";

/**
 * Options for `ai.providerTool()`.
 *
 * Only `provider` and `definition` are required. Server-run tools (web
 * search, code execution, grounding) need nothing else. Client-run tools
 * with a provider-defined schema (Anthropic `bash`, `text_editor`,
 * `memory`) also take an `execute` handler: the model calls them like any
 * tool and the agent dispatches the call to that handler by `name`.
 */
export type ProviderToolOptions<TInput = unknown, TOutput = unknown> = {
  /** Provider (wire format or provider label) that receives the definition. */
  provider: string;
  /** The tool entry exactly as the provider's API expects it; sent verbatim. */
  definition: Record<string, unknown>;
  /**
   * Name the provider calls the tool by. Defaults to `definition.name`,
   * then `definition.type`, then the definition's single key (Gemini
   * `{ googleSearch: {} }` → `"googleSearch"`). Must match what the
   * provider sends back for client-run tools.
   */
  name?: string;
  /** Description used in events and logs (the provider never sees it). */
  description?: string;
  /** Optional schema validating the provider-defined input before `execute`. */
  input?: StandardSchemaV1<TInput>;
  /** Runs a client-run provider tool. Omit for server-run tools. */
  execute?: (input: TInput, ctx?: ToolContext) => Promise<TOutput>;
  /** Present-progressive UI string for tool events (same as `ai.tool()`). */
  action?: string | ToolActionResolver<TInput>;
  /** Result-feedback mode (same as `ai.tool()`). */
  mode?: ToolMode;
  /** Free-form metadata (same as `ai.tool()`). */
  meta?: ToolMeta;
  /** Version stamp mirrored onto report nodes (same as `ai.tool()`). */
  version?: string;
};

/**
 * A provider-defined tool as returned by `ai.providerTool()`: a regular
 * `ToolContract` (so it sits in an agent's `tools` list, and client-run
 * calls dispatch through `invoke` like any tool) that also carries the
 * verbatim provider definition. The agent sends provider tools as
 * `ModelCallOptions.providerTools`, never as function tools.
 */
export type ProviderTool<TInput = unknown, TOutput = unknown> = ToolContract<TInput, TOutput> &
  ProviderToolDefinition & {
    /** Discriminator telling provider tools apart from function tools. */
    readonly type: "provider-tool";
  };

/**
 * Declare a provider-defined (built-in) tool. The `definition` goes to the
 * named provider verbatim; any other provider skips it and logs a warning,
 * so one tool list can serve a fallback chain across providers.
 *
 * @example
 * // Server-run: Anthropic searches the web itself.
 * const webSearch = ai.providerTool({
 *   provider: "anthropic",
 *   definition: { type: "web_search_20250305", name: "web_search", max_uses: 5 },
 * });
 *
 * @example
 * // Client-run with a provider schema: Claude calls `bash`, your code runs it.
 * const bash = ai.providerTool({
 *   provider: "anthropic",
 *   definition: { type: "bash_20250124", name: "bash" },
 *   execute: async (input: { command?: string; restart?: boolean }) => runInSandbox(input),
 * });
 *
 * const assistant = ai.agent({ model, tools: [webSearch, bash, myFunctionTool] });
 */
export function providerTool<TInput = unknown, TOutput = unknown>(
  options: ProviderToolOptions<TInput, TOutput>,
): ProviderTool<TInput, TOutput> {
  const name = options.name ?? deriveProviderToolName(options.definition, options.provider);
  const execute =
    options.execute ??
    (async (): Promise<TOutput> => {
      throw new Error(
        `Provider tool "${name}" runs on the ${options.provider} side and has no local handler. ` +
          "Pass `execute` to ai.providerTool() when the provider expects your code to run it.",
      );
    });

  const contract: ToolConfig<TInput, TOutput> = {
    name,
    description: options.description ?? `Provider-defined ${options.provider} tool "${name}".`,
    execute,
    ...(options.input ? { input: options.input } : {}),
    ...(options.action !== undefined ? { action: options.action } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.meta ? { meta: options.meta } : {}),
    ...(options.version ? { version: options.version } : {}),
  };

  return {
    ...tool(contract),
    type: "provider-tool",
    provider: options.provider,
    definition: options.definition,
  };
}

/**
 * True when `value` is a provider-defined tool built by `ai.providerTool()`.
 *
 * @example
 * const functionTools = tools.filter((entry) => !isProviderTool(entry));
 */
export function isProviderTool(value: unknown): value is ProviderTool {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { type?: unknown; provider?: unknown; definition?: unknown };

  return (
    candidate.type === "provider-tool" &&
    typeof candidate.provider === "string" &&
    typeof candidate.definition === "object" &&
    candidate.definition !== null
  );
}

/** What an adapter is and which provider-tool `provider` values it sends. */
export type ProviderToolTarget = {
  /** `provider` values this adapter sends verbatim (wire format and/or provider label). */
  accepts: readonly string[];
  /** Log module of the adapter, e.g. `"ai.anthropic"`. */
  module: string;
  /** Model name, for the warning context. */
  model: string;
  /** Logger receiving the skip warnings; defaults to the shared `log`. */
  logger?: Logger;
};

/** Result of {@link selectProviderTools}. */
export type SelectedProviderTools = {
  /** Function tools to convert as usual — provider tools removed; `undefined` when none. */
  tools: ToolConfig<unknown, unknown>[] | undefined;
  /** Provider definitions this adapter sends verbatim, in order. */
  definitions: Record<string, unknown>[];
};

/**
 * Provider definitions already warned about, per adapter + model, so a
 * multi-trip agent run logs each skipped tool once instead of every trip.
 */
const warnedSkips = new WeakMap<object, Set<string>>();

/**
 * Split a call's tools for one adapter: the function tools it converts as
 * usual, and the provider-defined definitions it sends verbatim. Reads
 * `options.providerTools` and also any `ai.providerTool()` entry left in
 * `options.tools` (a direct `model.complete()` caller may put them there).
 * A provider tool whose `provider` is not in `target.accepts` is skipped
 * and logged once as a warning.
 *
 * @example
 * const { tools, definitions } = selectProviderTools(options, {
 *   accepts: ["anthropic"],
 *   module: "ai.anthropic",
 *   model: this.name,
 * });
 */
export function selectProviderTools(
  options: ModelCallOptions | undefined,
  target: ProviderToolTarget,
): SelectedProviderTools {
  const functionTools: ToolConfig<unknown, unknown>[] = [];
  const candidates: ProviderToolDefinition[] = [...(options?.providerTools ?? [])];

  for (const entry of options?.tools ?? []) {
    if (isProviderTool(entry)) {
      candidates.push(entry);
    } else {
      functionTools.push(entry);
    }
  }

  const definitions: Record<string, unknown>[] = [];
  const seen = new Set<object>();

  for (const candidate of candidates) {
    if (seen.has(candidate.definition)) {
      continue;
    }

    seen.add(candidate.definition);

    if (target.accepts.includes(candidate.provider)) {
      definitions.push(candidate.definition);
      continue;
    }

    warnSkipped(candidate, target);
  }

  return {
    tools: functionTools.length > 0 ? functionTools : undefined,
    definitions,
  };
}

function warnSkipped(candidate: ProviderToolDefinition, target: ProviderToolTarget): void {
  const key = `${target.module}|${target.model}`;
  const warned = warnedSkips.get(candidate.definition) ?? new Set<string>();

  if (warned.has(key)) {
    return;
  }

  warned.add(key);
  warnedSkips.set(candidate.definition, warned);

  (target.logger ?? log).warn(
    target.module,
    "providerTool.skipped",
    `Skipped a provider-defined ${candidate.provider} tool: model "${target.model}" does not accept ${candidate.provider} tools.`,
    {
      provider: candidate.provider,
      accepts: [...target.accepts],
      model: target.model,
      tool: deriveProviderToolName(candidate.definition, candidate.provider),
    },
  );
}

/**
 * Name a provider definition: `name`, then `type`, then the single key of
 * a one-key definition (Gemini `{ googleSearch: {} }`; Bedrock
 * `{ systemTool: { name } }` uses the nested name), else `<provider>_tool`.
 */
function deriveProviderToolName(definition: Record<string, unknown>, provider: string): string {
  if (typeof definition.name === "string" && definition.name !== "") {
    return definition.name;
  }

  if (typeof definition.type === "string" && definition.type !== "") {
    return definition.type;
  }

  const keys = Object.keys(definition);

  if (keys.length === 1) {
    const [key] = keys;
    const nested = key !== undefined ? definition[key] : undefined;

    if (
      typeof nested === "object" &&
      nested !== null &&
      typeof (nested as { name?: unknown }).name === "string"
    ) {
      return (nested as { name: string }).name;
    }

    if (key !== undefined) {
      return key;
    }
  }

  return `${provider}_tool`;
}
