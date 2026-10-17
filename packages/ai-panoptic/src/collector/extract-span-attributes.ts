import type { BaseReport } from "@warlock.js/ai";

/**
 * Per-primitive `BaseReport` extension fields the collector surfaces as
 * span attributes. Declared as a structural superset (every field
 * optional) so a single reader can pull whatever the concrete report
 * carried without narrowing on `type` first — a `BaseReport` widened to
 * this shape exposes `undefined` for the fields its primitive doesn't
 * set, and the extractor simply skips those.
 *
 * Mirrors the public per-primitive report types in `@warlock.js/ai`
 * (`AgentReport`, `WorkflowReport`, `SupervisorReport`,
 * `OrchestratorReport`, `ToolCall`) — kept structural rather than a
 * union import so adding a new optional report field upstream is a
 * non-breaking read here.
 */
type ReportExtensions = {
  model?: { name?: string; provider?: string };
  trips?: unknown[];
  promptName?: string;
  promptVersion?: string;
  workflowName?: string;
  supervisorName?: string;
  signature?: string;
  terminatedBy?: string;
  iterations?: number;
  steps?: Record<string, unknown>;
  turns?: unknown[];
  turnIndex?: number;
  tripIndex?: number;
  callId?: string;
  recoveredFrom?: string;
};

/**
 * Build the free-form `TraceSpan.attributes` bag for one report node.
 *
 * The collector keeps the first-class span fields (identity, timing,
 * status, usage, error) on the span itself and routes everything
 * primitive-specific here — trip/step/iteration counts, the model
 * identity an agent ran against, the tool's originating trip index, a
 * supervisor's termination reason. Exporters forward this verbatim as
 * backend span attributes (OTel attributes, Langfuse metadata).
 *
 * Only populated keys are emitted; the function returns `undefined`
 * when the node carried no extra detail, so the optional
 * `TraceSpan.attributes` field stays absent rather than holding an
 * empty object (matches the contract's "absent when empty" note).
 *
 * Retry count is surfaced from the shared `BaseReport.attempts` for
 * every primitive so cost dashboards see the real call count.
 *
 * @example
 * const attributes = extractSpanAttributes(agentReport);
 * // { "agent.trips": 3, "agent.model.name": "gpt-4o", "agent.model.provider": "openai" }
 */
export function extractSpanAttributes(report: BaseReport): Record<string, unknown> | undefined {
  const extensions = report as BaseReport & ReportExtensions;
  const attributes: Record<string, unknown> = {};

  if (report.attempts !== undefined && report.attempts.length > 0) {
    attributes["retries"] = report.attempts.length;
  }

  switch (report.type) {
    case "agent": {
      addAgentAttributes(attributes, extensions);
      break;
    }

    case "workflow": {
      addWorkflowAttributes(attributes, extensions);
      break;
    }

    case "supervisor":
    case "team": {
      // ai.team reuses the supervisor engine, so a team report carries the
      // same supervisorName / terminatedBy / iterations fields.
      addSupervisorAttributes(attributes, extensions);
      break;
    }

    case "orchestrator": {
      addOrchestratorAttributes(attributes, extensions);
      break;
    }

    case "tool": {
      addToolAttributes(attributes, extensions);
      break;
    }

    default: {
      break;
    }
  }

  if (Object.keys(attributes).length === 0) {
    return undefined;
  }

  return attributes;
}

function addAgentAttributes(
  attributes: Record<string, unknown>,
  extensions: ReportExtensions,
): void {
  if (Array.isArray(extensions.trips)) {
    attributes["agent.trips"] = extensions.trips.length;
  }

  if (extensions.model?.name !== undefined) {
    attributes["agent.model.name"] = extensions.model.name;
  }

  if (extensions.model?.provider !== undefined) {
    attributes["agent.model.provider"] = extensions.model.provider;
  }

  // Prompt-version linkage (core `AgentReport.promptName` / `promptVersion`).
  // Present only when the agent ran against a *named* `ai.prompts` builder;
  // surfaced so the dashboard can group / filter runs by `name@version` and
  // attribute behavior shifts to a specific prompt revision.
  if (extensions.promptName !== undefined) {
    attributes["agent.promptName"] = extensions.promptName;
  }

  if (extensions.promptVersion !== undefined) {
    attributes["agent.promptVersion"] = extensions.promptVersion;
  }
}

function addWorkflowAttributes(
  attributes: Record<string, unknown>,
  extensions: ReportExtensions,
): void {
  if (extensions.workflowName !== undefined) {
    attributes["workflow.name"] = extensions.workflowName;
  }

  if (extensions.signature !== undefined) {
    attributes["workflow.signature"] = extensions.signature;
  }

  if (extensions.steps !== undefined) {
    attributes["workflow.steps"] = Object.keys(extensions.steps).length;
  }
}

function addSupervisorAttributes(
  attributes: Record<string, unknown>,
  extensions: ReportExtensions,
): void {
  if (extensions.supervisorName !== undefined) {
    attributes["supervisor.name"] = extensions.supervisorName;
  }

  if (extensions.terminatedBy !== undefined) {
    attributes["supervisor.terminatedBy"] = extensions.terminatedBy;
  }

  if (extensions.iterations !== undefined) {
    attributes["supervisor.iterations"] = extensions.iterations;
  }
}

function addOrchestratorAttributes(
  attributes: Record<string, unknown>,
  extensions: ReportExtensions,
): void {
  if (extensions.turnIndex !== undefined) {
    attributes["orchestrator.turnIndex"] = extensions.turnIndex;
  }

  if (extensions.signature !== undefined) {
    attributes["orchestrator.signature"] = extensions.signature;
  }

  if (Array.isArray(extensions.turns)) {
    attributes["orchestrator.turns"] = extensions.turns.length;
  }
}

function addToolAttributes(
  attributes: Record<string, unknown>,
  extensions: ReportExtensions,
): void {
  if (extensions.tripIndex !== undefined) {
    attributes["tool.tripIndex"] = extensions.tripIndex;
  }

  if (extensions.callId !== undefined) {
    attributes["tool.callId"] = extensions.callId;
  }

  if (extensions.recoveredFrom !== undefined) {
    attributes["tool.recoveredFrom"] = extensions.recoveredFrom;
  }
}
