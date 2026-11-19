import type {
  DevtoolsAiEvaluateRequest,
  DevtoolsAiEvaluateResult,
  DevtoolsAiEvaluateView,
} from "../../production/contracts";
import { createErrorRef, DevtoolsApiError } from "../../production/errors";
import type { DevtoolsAgentTraceSource } from "../../sources/agent-trace-source";

const MAX_PROMPTS = 50;
const MAX_RUNS_SCANNED = 300;
const MAX_SYSTEM_PROMPT = 100_000;
const MAX_INSTRUCTIONS = 4000;
const PREVIEW_LENGTH = 200;

type EvaluateModule = {
  getEvaluateConfig?: () => EvaluateConfigLike | undefined;
  evaluateSystemPrompt?: (
    systemPrompt: string,
    config: EvaluateConfigLike,
    instructions?: string,
  ) => Promise<{ score?: number; issues?: string[] }>;
};

type ModelLike = { name?: string; provider?: string };

type EvaluateConfigLike = {
  model: ModelLike | (() => ModelLike | Promise<ModelLike>);
  instructions?: string;
};

/** What the Evaluate routes use; injected so specs need no model. */
export type DevtoolsAiEvaluator = {
  /** The page data: whether a judge is configured and the recent distinct system prompts. */
  view(): Promise<Extract<DevtoolsAiEvaluateView, { available: true }>>;
  /**
   * Grades a prompt with Panoptic's `evaluateSystemPrompt`. Throws
   * `DevtoolsApiError` `input.invalid` (both or neither of runId/systemPrompt,
   * sizes), `ai.evaluate-unavailable` (no judge configured),
   * `ai.prompt-not-found` (run gone or its text not kept) or
   * `ai.evaluate-failed` (the judge threw; logged with the reference).
   */
  evaluate(request: DevtoolsAiEvaluateRequest): Promise<DevtoolsAiEvaluateResult>;
};

function judgeLabel(model: ModelLike): string {
  return typeof model.provider === "string" && typeof model.name === "string"
    ? `${model.provider}/${model.name}`
    : (model.name ?? "custom model");
}

/** Builds the evaluator over the agent traces and Panoptic's evaluate helpers (loaded lazily). */
export function createAiEvaluator(input: {
  agentTraces: DevtoolsAgentTraceSource;
  load?: (name: string) => Promise<unknown>;
  warn?: (message: string) => void;
}): DevtoolsAiEvaluator {
  const load = input.load ?? (() => import("@warlock.js/ai-panoptic"));

  /** Panoptic's evaluate helpers, or `undefined` when Panoptic (or its evaluate support) is not there. */
  async function panoptic(): Promise<(EvaluateModule & Required<EvaluateModule>) | undefined> {
    try {
      const module = (await load("@warlock.js/ai-panoptic")) as EvaluateModule;

      return typeof module.getEvaluateConfig === "function" &&
        typeof module.evaluateSystemPrompt === "function"
        ? (module as EvaluateModule & Required<EvaluateModule>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  const unavailable = (): DevtoolsApiError => new DevtoolsApiError("ai.evaluate-unavailable");

  return {
    async view() {
      const module = await panoptic();
      let config: EvaluateConfigLike | undefined;

      try {
        config = module?.getEvaluateConfig();
      } catch {
        config = undefined;
      }

      const byHash = new Map<
        string,
        { agents: string[]; runId: string; startedAt: string; text: string }
      >();
      const runs = input.agentTraces
        .list()
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || 0)
        .slice(0, MAX_RUNS_SCANNED);

      for (const run of runs) {
        const prompt = input.agentTraces.get(run.runId)?.systemPrompt;

        if (!prompt || typeof prompt.text !== "string" || prompt.text === "") continue;

        const known = byHash.get(prompt.hash);

        if (known) {
          if (!known.agents.includes(run.agent)) known.agents.push(run.agent);
        } else {
          byHash.set(prompt.hash, {
            agents: [run.agent],
            runId: run.runId,
            startedAt: run.startedAt,
            text: prompt.text,
          });
        }
      }

      return {
        available: true as const,
        configured: config !== undefined,
        judge:
          config === undefined
            ? null
            : typeof config.model === "function"
              ? "custom model"
              : judgeLabel(config.model),
        instructions: config?.instructions ?? "",
        prompts: [...byHash.entries()].slice(0, MAX_PROMPTS).map(([hash, item]) => ({
          hash,
          agents: item.agents,
          runId: item.runId,
          lastSeenAt: item.startedAt,
          preview: item.text.slice(0, PREVIEW_LENGTH),
          length: item.text.length,
        })),
      };
    },

    async evaluate(request) {
      const { runId, systemPrompt, instructions } = request;

      if ((runId === undefined) === (systemPrompt === undefined)) {
        throw new DevtoolsApiError("input.invalid");
      }

      if (
        (runId !== undefined && (typeof runId !== "string" || runId === "")) ||
        (systemPrompt !== undefined &&
          (typeof systemPrompt !== "string" ||
            systemPrompt.trim() === "" ||
            systemPrompt.length > MAX_SYSTEM_PROMPT)) ||
        (instructions !== undefined &&
          (typeof instructions !== "string" || instructions.length > MAX_INSTRUCTIONS))
      ) {
        throw new DevtoolsApiError("input.invalid");
      }

      const module = await panoptic();
      let config: EvaluateConfigLike | undefined;

      try {
        config = module?.getEvaluateConfig();
      } catch {
        config = undefined;
      }

      if (!module || !config) throw unavailable();

      let text = systemPrompt;

      if (runId !== undefined) {
        text = input.agentTraces.get(runId)?.systemPrompt?.text;

        if (typeof text !== "string" || text === "")
          throw new DevtoolsApiError("ai.prompt-not-found");
      }

      const started = Date.now();

      try {
        const model = typeof config.model === "function" ? await config.model() : config.model;
        const verdict = await module.evaluateSystemPrompt(
          text as string,
          { ...config, model },
          instructions,
        );

        return {
          score: typeof verdict.score === "number" ? verdict.score : null,
          issues: Array.isArray(verdict.issues) ? verdict.issues.map(String) : [],
          judge: judgeLabel(model),
          durationMs: Date.now() - started,
        };
      } catch (error) {
        const ref = createErrorRef();

        input.warn?.(
          `Devtools evaluate error ${ref}: ${error instanceof Error ? error.message : String(error)}`,
        );

        throw new DevtoolsApiError("ai.evaluate-failed", { ref, cause: error });
      }
    },
  };
}
