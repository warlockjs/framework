import { useState } from "react";
import type {
  DevtoolsAiEvaluatePrompt,
  DevtoolsAiEvaluateRequest,
  DevtoolsAiEvaluateResult,
  DevtoolsAiEvaluateView,
} from "@contracts";
import { PlayIcon } from "lucide-react";
import { apiFetch } from "@/api/client";
import { useApi } from "@/api/hooks";
import { EmptyState, ErrorMessage, LoadingRows } from "@/components/common";
import { Button } from "@/components/ui/button";
import { CodeBlock, DetailSection, PageHeader, Pill } from "@/components/listing";
import { RowButton, SectionTitle, Time } from "@/components/ui/panel-kit";
import { useAction } from "@/lib/useAction";
import { cn } from "@/lib/utils";
import type { DevtoolsPanelProps } from "@/panels/types";
import { AiUnavailable } from "../ai-shared/AiUnavailable";
import { formatLatency, formatRatio } from "../ai-shared/format-ai";

type Available = Extract<DevtoolsAiEvaluateView, { available: true }>;

export const EVALUATE_SETUP_SNIPPET = `ai.config({
  panoptic: {
    evaluate: {
      model: openai.model({ name: "gpt-4o-mini" }),
      instructions: "Must be clear and name its limits.",
    },
  },
});`;

const PROMPT_MAX = 100_000;
const INSTRUCTIONS_MAX = 4000;
const PASTE = "paste";

const areaClass =
  "w-full rounded-lg border border-input bg-card px-2.5 py-2 font-mono text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function scoreTone(score: number): string {
  return score >= 0.8 ? "bg-success" : score >= 0.5 ? "bg-warning" : "bg-destructive";
}

/** The verdict: the score as a percent with a meter, the issues, the judge and the time it took. */
function ResultCard({ result }: { result: DevtoolsAiEvaluateResult }) {
  return (
    <section aria-label="Evaluation result" className="space-y-3 rounded-xl border bg-card p-3.5">
      <div>
        <p className="text-xs text-muted-foreground">Score</p>
        {result.score === null ? (
          <p className="text-sm">
            The judge returned no score. Read the issues below, or run it again.
          </p>
        ) : (
          <>
            <p className="text-2xl font-semibold tabular-nums">{formatRatio(result.score)}</p>
            <div
              role="meter"
              aria-label="Score"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(result.score * 100)}
              className="mt-1 h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn("h-full rounded-full", scoreTone(result.score))}
                style={{ width: `${Math.round(result.score * 100)}%` }}
              />
            </div>
          </>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Issues</p>
        {result.issues.length ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {result.issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">The judge found no issues.</p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {`Judged by ${result.judge} in ${formatLatency(result.durationMs)}`}
      </p>
    </section>
  );
}

function PromptRow({
  prompt,
  selected,
  onSelect,
}: {
  prompt: DevtoolsAiEvaluatePrompt;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <RowButton selected={selected} className="rounded-xl bg-card p-3" onClick={onSelect}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{prompt.agents.join(", ") || "Unnamed agent"}</span>
        <Pill tone="neutral" mono>
          {`${prompt.length.toLocaleString("en-US")} chars`}
        </Pill>
      </div>
      <p className="mt-1 line-clamp-2 text-xs break-words text-muted-foreground">
        {prompt.preview}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Last seen <Time at={Date.parse(prompt.lastSeenAt)} />
      </p>
    </RowButton>
  );
}

function Evaluator({ view }: { view: Available }) {
  const [selected, setSelected] = useState<string>(view.prompts[0]?.hash ?? PASTE);
  const [pasted, setPasted] = useState("");
  const [instructions, setInstructions] = useState(view.instructions);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<DevtoolsAiEvaluateResult | null>(null);
  const prompt = view.prompts.find((item) => item.hash === selected);
  const action = useAction((body: DevtoolsAiEvaluateRequest) =>
    apiFetch<DevtoolsAiEvaluateResult>("api/ai/evaluate", { method: "POST", body }),
  );

  const run = async () => {
    setProblem(null);

    if (!prompt && !pasted.trim()) {
      setProblem("Pick a recent prompt or paste one, then run the evaluation.");

      return;
    }

    if (pasted.length > PROMPT_MAX) {
      setProblem(
        `The pasted prompt is over ${PROMPT_MAX.toLocaleString("en-US")} characters. Shorten it and run again.`,
      );

      return;
    }

    if (instructions.length > INSTRUCTIONS_MAX) {
      setProblem(
        `The instructions are over ${INSTRUCTIONS_MAX.toLocaleString("en-US")} characters. Shorten them and run again.`,
      );

      return;
    }

    const body: DevtoolsAiEvaluateRequest = prompt
      ? { runId: prompt.runId }
      : { systemPrompt: pasted };

    if (instructions.trim() && instructions !== view.instructions) body.instructions = instructions;

    setResult(null);

    const outcome = await action.run(body);

    if (outcome.ok) setResult(outcome.value);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0 space-y-1.5">
        <SectionTitle>Recent system prompts</SectionTitle>
        {view.prompts.length ? (
          view.prompts.map((item) => (
            <PromptRow
              key={item.hash}
              prompt={item}
              selected={selected === item.hash}
              onSelect={() => setSelected(item.hash)}
            />
          ))
        ) : (
          <EmptyState
            title="No system prompts are kept yet."
            hint="Run an agent in development and its prompt shows up here. You can also paste one."
          />
        )}
        <RowButton
          selected={selected === PASTE}
          className="rounded-xl bg-card p-3"
          onClick={() => setSelected(PASTE)}
        >
          Paste a prompt
        </RowButton>
      </div>
      <div className="min-w-0 space-y-3">
        <DetailSection title="Prompt to grade">
          {prompt ? (
            <>
              <CodeBlock>{prompt.preview}</CodeBlock>
              <p className="text-xs text-muted-foreground">
                {prompt.length > prompt.preview.length
                  ? `The first ${prompt.preview.length} of ${prompt.length.toLocaleString("en-US")} characters are shown; the judge reads the whole prompt from the run.`
                  : "The judge reads this whole prompt."}
              </p>
            </>
          ) : (
            <textarea
              aria-label="System prompt to grade"
              className={cn(areaClass, "min-h-40")}
              placeholder="Paste a system prompt here"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
          )}
          <label className="block text-xs text-muted-foreground" htmlFor="ai-evaluate-instructions">
            {view.judge ? `Grading instructions (judge: ${view.judge})` : "Grading instructions"}
          </label>
          <textarea
            id="ai-evaluate-instructions"
            className={cn(areaClass, "min-h-24")}
            placeholder="What a good prompt must do. Leave empty to use the configured instructions (or the built-in rubric when none are set)."
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={action.pending} onClick={() => void run()}>
              <PlayIcon />
              {action.pending ? "Evaluating…" : "Run evaluation"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Sends the prompt to the judge model, which can cost a little.
            </span>
          </div>
          {problem ? (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : null}
          <ErrorMessage error={action.error} title="The evaluation failed" />
        </DetailSection>
        {result ? <ResultCard result={result} /> : null}
      </div>
    </div>
  );
}

/** Evaluate: grade a system prompt with the judge model configured for Panoptic. */
export function AiEvaluatePanel(_props: DevtoolsPanelProps) {
  const { data, error, loading, reload } = useApi<DevtoolsAiEvaluateView>("api/ai/evaluate");

  return (
    <div>
      <PageHeader
        title="Evaluate"
        description="Grade a system prompt with a judge model: a score, the issues it found, and the judge that gave them."
      />
      {error ? (
        <ErrorMessage
          error={error}
          title="Could not load the evaluator"
          onRetry={reload}
          className="mb-3"
        />
      ) : null}
      {!data && loading ? <LoadingRows /> : null}
      {data && !data.available ? <AiUnavailable answer={data} /> : null}
      {data?.available && !data.configured ? (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">Set up a judge model</h3>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Evaluate needs a model to act as the judge. Add one to your Panoptic config, restart the
            app, and reload this page.
          </p>
          <CodeBlock>{EVALUATE_SETUP_SNIPPET}</CodeBlock>
        </div>
      ) : null}
      {data?.available && data.configured ? <Evaluator view={data} /> : null}
    </div>
  );
}
