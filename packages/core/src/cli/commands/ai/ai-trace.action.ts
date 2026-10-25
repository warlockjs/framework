import type { AgentTrace } from "@warlock.js/ai";
import type { CommandActionData } from "../../../commands/types";
import { WarlockError } from "../../../errors/warlock-error";
import { resolveDevServerEndpoint } from "../../../tooling/devtools/devtools-client";
import {
  loadMeasureModule,
  type AiCommandDependencies,
  type ModuleExports,
} from "./ai-command.action";

type TraceFormatModule = Pick<typeof import("@warlock.js/ai"), "formatAgentTrace" | "diffAgentTraces">;

/** One row of `GET <devtools>/api/ai/agent-runs`. */
type AgentRunRow = {
  runId: string;
  agent: string;
  status: string;
  startedAt: string;
  durationMs?: number;
  turns: number;
  toolCalls: number;
  refusals: number;
  usage: { input: number; output: number };
  cost?: number;
};

function stringOption(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isTraceFormatModule(value: ModuleExports): value is ModuleExports & TraceFormatModule {
  return typeof value.formatAgentTrace === "function" && typeof value.diffAgentTraces === "function";
}

/** The run list as a plain-text table, newest first as the server sends it. */
export function formatAgentRunRows(rows: ReadonlyArray<AgentRunRow>): string {
  if (rows.length === 0) return "No agent runs recorded yet.";

  return [
    "RUN ID\tAGENT\tSTATUS\tTURNS\tTOOLS\tREFUSED\tTOKENS (IN/OUT)\tCOST USD",
    ...rows.map(
      (row) =>
        `${row.runId}\t${row.agent}\t${row.status}\t${row.turns}\t${row.toolCalls}\t${row.refusals}\t${row.usage.input}/${row.usage.output}\t${row.cost === undefined ? "-" : row.cost.toFixed(6)}`,
    ),
  ].join("\n");
}

/**
 * `warlock ai trace [runId]`: prints what an agent run did, turn by turn,
 * from the running dev server's devtools: the system prompt hash, tools
 * offered with schema hashes, tool calls, results and refusals, retries and
 * re-prompts, token usage and cost. Without a run id it lists recent runs.
 * `--diff <otherRunId>` compares the requests two runs sent (system prompt
 * and tool definitions). `--json` prints the data.
 *
 * Needs `warlock dev` with `@warlock.js/devtools` and `@warlock.js/ai`.
 */
export async function aiTraceAction(
  { args, options }: CommandActionData,
  dependencies: AiCommandDependencies = {},
): Promise<void> {
  const json = options.json === true;
  const runId = args[1];
  const other = stringOption(options.diff);
  const cwd = dependencies.cwd ?? process.cwd();
  const fetcher = dependencies.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = resolveDevServerEndpoint({
    cwd,
    url: stringOption(options.url),
    devtoolsPath: stringOption(options.devtoolsPath),
  });
  const api = `${endpoint.url}${endpoint.devtoolsPath}/api/ai/agent-runs`;

  const getJson = async (url: string): Promise<{ status: number; body: unknown }> => {
    let response: Response;

    try {
      response = await fetcher(url, { headers: { accept: "application/json" } });
    } catch (error) {
      throw new WarlockError(
        "WL8008",
        `The dev server at ${endpoint.url} is not reachable: ${error instanceof Error ? error.message : String(error)}. Start \`warlock dev\`, or pass --url.`,
        { cause: error },
      );
    }

    const text = await response.text();

    try {
      return { status: response.status, body: text ? JSON.parse(text) : undefined };
    } catch {
      return { status: response.status, body: undefined };
    }
  };

  const getTrace = async (id: string): Promise<AgentTrace> => {
    const { status, body } = await getJson(`${api}/${encodeURIComponent(id)}`);

    if (status === 404) {
      throw new Error(
        `The dev server holds no agent trace for "${id}". It keeps the most recent runs of this session only; run the agent again.`,
      );
    }

    if (status !== 200 || typeof body !== "object" || body === null) {
      throw new WarlockError(
        "WL8009",
        `The dev server answered ${status} on ${endpoint.devtoolsPath}/api/ai/agent-runs/${id}: devtools with the AI trace API is not running there. Update @warlock.js/devtools and restart \`warlock dev\`.`,
      );
    }

    return body as AgentTrace;
  };

  if (!runId) {
    const { status, body } = await getJson(api);
    const payload = body as { available?: boolean; message?: string; runs?: AgentRunRow[] } | undefined;

    if (status !== 200 || !payload) {
      throw new WarlockError(
        "WL8009",
        `The dev server answered ${status} on ${endpoint.devtoolsPath}/api/ai/agent-runs: devtools with the AI trace API is not running there. Update @warlock.js/devtools and restart \`warlock dev\`.`,
      );
    }

    if (payload.available === false) throw new Error(payload.message ?? "Agent traces are unavailable.");

    console.log(json ? JSON.stringify(payload.runs ?? [], null, 2) : formatAgentRunRows(payload.runs ?? []));
    return;
  }

  const trace = await getTrace(runId);

  if (json && !other) {
    console.log(JSON.stringify(trace, null, 2));
    return;
  }

  const load = dependencies.load ?? ((specifier) => loadMeasureModule(specifier, cwd));
  let ai: ModuleExports;

  try {
    ai = await load("@warlock.js/ai");
  } catch (cause) {
    throw new Error("Cannot load @warlock.js/ai. Install it in this project to use warlock ai trace.", {
      cause,
    });
  }

  if (!isTraceFormatModule(ai)) {
    throw new Error("warlock ai trace requires @warlock.js/ai 5.38.0 or newer.");
  }

  if (!other) {
    console.log(ai.formatAgentTrace(trace));
    return;
  }

  const diff = ai.diffAgentTraces(trace, await getTrace(other));

  if (json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  console.log(
    diff.identical
      ? `${runId} and ${other} sent the same system prompt and the same tool definitions.`
      : [
          `${runId} vs ${other}`,
          `  system prompt: ${diff.systemPrompt.changed ? "changed" : "same"}`,
          ...(diff.systemPrompt.removedLines ?? []).map((line) => `    - ${line}`),
          ...(diff.systemPrompt.addedLines ?? []).map((line) => `    + ${line}`),
          `  tools added: ${diff.tools.added.join(", ") || "none"}`,
          `  tools removed: ${diff.tools.removed.join(", ") || "none"}`,
          `  tools changed: ${diff.tools.changed.join(", ") || "none"}`,
        ].join("\n"),
  );
}
