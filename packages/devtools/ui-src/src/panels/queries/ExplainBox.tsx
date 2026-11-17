import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Code, ErrorMessage } from "@/components/ui/panel-kit";

export type ExplainOutcome = { plan: unknown; executing?: boolean; instance?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON value as a tree: objects and arrays fold, leaves print. */
export function PlanTree({ value, label, depth = 0 }: { value: unknown; label?: string; depth?: number }) {
  if (Array.isArray(value) || isRecord(value)) {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value);
    const nodeType = isRecord(value) && typeof value["Node Type"] === "string" ? value["Node Type"] : null;

    return (
      <details open={depth < 3} className="ml-3 text-xs">
        <summary className="cursor-pointer font-mono">
          {label ? `${label}: ` : ""}
          {nodeType ?? (Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`)}
        </summary>
        {entries.map(([key, item]) => (
          <PlanTree key={key} value={item} label={key} depth={depth + 1} />
        ))}
      </details>
    );
  }

  return (
    <div className="ml-6 font-mono text-xs break-words">
      {label ? <span className="text-muted-foreground">{label}: </span> : null}
      {JSON.stringify(value)}
    </div>
  );
}

/**
 * An EXPLAIN button with its result: the running state, the plan as a tree,
 * and a failure shown right here with the server's message.
 */
export function ExplainBox({ run }: { run: () => Promise<ExplainOutcome> }) {
  const [state, setState] = useState<
    | { type: "idle" }
    | { type: "running" }
    | { type: "done"; outcome: ExplainOutcome }
    | { type: "failed"; error: unknown }
  >({ type: "idle" });

  const start = async () => {
    setState({ type: "running" });

    try {
      setState({ type: "done", outcome: await run() });
    } catch (error) {
      setState({ type: "failed", error });
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <Button size="xs" variant="outline" disabled={state.type === "running"} onClick={start}>
        {state.type === "running" ? "Running EXPLAIN…" : "Explain"}
      </Button>
      {state.type === "running" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Asking the database for the plan.
        </p>
      ) : null}
      {state.type === "failed" ? <ErrorMessage error={state.error} title="EXPLAIN failed" /> : null}
      {state.type === "done" ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {state.outcome.executing
              ? "Executing plan: the database ran this query to measure it."
              : "Plan only: the query was not run."}
            {state.outcome.instance ? ` Planned on ${state.outcome.instance}.` : ""}
          </p>
          <div className="max-h-96 overflow-auto rounded-md bg-muted p-2">
            <PlanTree value={state.outcome.plan} />
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer">Raw JSON</summary>
            <Code>{JSON.stringify(state.outcome.plan, null, 2)}</Code>
          </details>
        </div>
      ) : null}
    </div>
  );
}
