import path from "node:path";
import type { ReasoningEffort } from "@warlock.js/ai";
import type { CliLaunchContext, CliLaunchFile, CliMcpServers, CliUsage } from "../contracts";
import { CliError } from "../errors";

/**
 * The prompt as an argv value. A prompt starting with `-` would be read as a
 * flag by the CLI's argument parser, so it gets one leading space (harmless
 * to the model, and no parser treats it as an option).
 */
export function argvPrompt(prompt: string): string {
  return prompt.startsWith("-") ? ` ${prompt}` : prompt;
}

/** The prompt written to `prompt.txt` in the run directory, for `transport: "file"`. */
export function promptFile(context: CliLaunchContext): CliLaunchFile {
  return { path: path.join(context.runDir, "prompt.txt"), content: context.prompt };
}

/**
 * Fail closed when an option needs a file inside the CLI's config home but
 * the home is not private to this run (writing it into a caller-owned or
 * inherited home would leak tokens into it and race concurrent runs).
 */
export function requirePrivateHome(
  context: CliLaunchContext,
  adapter: { name: string; title: string },
  option: string,
): string {
  if (context.home === undefined || !context.homeIsPrivate) {
    throw new CliError(
      `${adapter.title} reads ${option} only from its config home; use \`home: "private"\` (the default) for runs with ${option}.`,
      { type: "unsupported-option", adapter: adapter.name },
    );
  }

  return context.home;
}

/** A `.env` file body. Values are written verbatim; newlines are refused. */
export function dotenvFile(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, value]) => {
      if (/[\r\n]/.test(value)) {
        throw new Error(`${name} contains a newline and cannot be written to a .env file`);
      }

      return `${name}=${value}`;
    })
    .join("\n")
    .concat("\n");
}

/** The framework effort scale, lowest first. */
const EFFORT_ORDER: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Map a framework effort to a vendor's levels, following the framework
 * rule: an exact level wins; otherwise the nearest higher level the vendor
 * has (so `minimal` becomes `low`); a level above the vendor's highest is
 * clamped to it.
 *
 * @example
 * mapEffort("xhigh", { low: "low", medium: "medium", high: "high" }); // "high"
 * mapEffort("minimal", { low: "low", medium: "medium", high: "high" }); // "low"
 */
export function mapEffort(
  effort: ReasoningEffort,
  levels: Partial<Record<ReasoningEffort, string>>,
): string {
  const exact = levels[effort];

  if (exact !== undefined) {
    return exact;
  }

  const requested = EFFORT_ORDER.indexOf(effort);
  const supported = EFFORT_ORDER.filter((level) => levels[level] !== undefined);
  const higher = supported.find((level) => EFFORT_ORDER.indexOf(level) > requested);
  const chosen = higher ?? supported.at(-1);
  const value = chosen === undefined ? undefined : levels[chosen];

  if (value === undefined) {
    throw new Error("mapEffort needs at least one vendor level");
  }

  return value;
}

/**
 * The common `mcpServers` JSON shape (Claude Code, Cursor, Kimi, Droid,
 * Copilot, Amp, Qwen Code …): stdio servers as `command`/`args`/`env`,
 * remote servers as `url`/`headers`. `typeField` adds the `type` key the
 * vendor expects (`"stdio"`, `"http"`, `"sse"`), or a renamed remote
 * transport (`"streamable-http"`).
 */
export function mcpServersJson(
  servers: CliMcpServers,
  options: {
    /** Emit a `type` key on every server. */
    typeField?: boolean;
    /** Value of `type` for streamable HTTP servers. Default `"http"`. */
    httpType?: string;
    /** Extra keys merged into every server (for example `tools: ["*"]`). */
    extra?: Record<string, unknown>;
    /** Key holding a streamable-HTTP URL. Default `"url"`. */
    httpUrlKey?: string;
  } = {},
): Record<string, Record<string, unknown>> {
  const rendered: Record<string, Record<string, unknown>> = {};

  for (const [name, server] of Object.entries(servers)) {
    if (server.type === "stdio") {
      rendered[name] = {
        ...(options.typeField ? { type: "stdio" } : {}),
        command: server.command,
        args: server.args ?? [],
        ...(server.env !== undefined ? { env: server.env } : {}),
        ...options.extra,
      };
      continue;
    }

    const urlKey = server.type === "http" ? (options.httpUrlKey ?? "url") : "url";

    rendered[name] = {
      ...(options.typeField
        ? { type: server.type === "http" ? (options.httpType ?? "http") : "sse" }
        : {}),
      [urlKey]: server.url,
      ...(server.headers !== undefined ? { headers: server.headers } : {}),
      ...options.extra,
    };
  }

  return rendered;
}

/** JSON for a config file, pretty-printed with a trailing newline. */
export function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Build a `CliUsage`, computing `total` when the vendor omits it. */
export function usageOf(fields: {
  input?: number;
  output?: number;
  total?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUSD?: number;
}): CliUsage {
  const input = fields.input ?? 0;
  const output = fields.output ?? 0;
  const usage: CliUsage = { input, output, total: fields.total ?? input + output };

  if (fields.cachedTokens !== undefined) usage.cachedTokens = fields.cachedTokens;
  if (fields.cacheWriteTokens !== undefined) usage.cacheWriteTokens = fields.cacheWriteTokens;
  if (fields.reasoningTokens !== undefined) usage.reasoningTokens = fields.reasoningTokens;
  if (fields.costUSD !== undefined) usage.costUSD = fields.costUSD;

  return usage;
}

/** The first `undefined`-free value. */
export function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

/** An `unsupported-option` error for an adapter. */
export function unsupportedOption(
  adapter: { name: string; title: string },
  message: string,
): CliError {
  return new CliError(`${adapter.title}: ${message}`, {
    type: "unsupported-option",
    adapter: adapter.name,
  });
}

/** Parse a JSON-encoded tool-arguments string; keeps the raw string when it is not JSON. */
export function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * Usage in the Anthropic Messages shape (`input_tokens` excludes cache reads
 * and writes, which are reported separately). `input` is the sum of all
 * three, matching the framework rule that `input` includes cached tokens.
 */
export function anthropicUsage(
  usage: Record<string, unknown> | undefined,
  costUSD?: number,
): CliUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }

  const read = (key: string): number | undefined => {
    const value = usage[key];

    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const uncached = read("input_tokens") ?? 0;
  const cacheRead = read("cache_read_input_tokens");
  const cacheWrite = read("cache_creation_input_tokens");
  const output = read("output_tokens") ?? 0;
  const input = uncached + (cacheRead ?? 0) + (cacheWrite ?? 0);

  return usageOf({
    input,
    output,
    cachedTokens: cacheRead !== undefined && cacheRead > 0 ? cacheRead : undefined,
    cacheWriteTokens: cacheWrite !== undefined && cacheWrite > 0 ? cacheWrite : undefined,
    reasoningTokens: read("reasoning_tokens") || undefined,
    costUSD,
  });
}
