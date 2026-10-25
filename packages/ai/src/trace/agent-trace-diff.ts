import type { AgentTrace } from "./agent-trace.type";

/** What differs between the requests two runs sent to the model. */
export type AgentTraceDiff = {
  /** `true` when the system prompt and every tool definition are identical. */
  identical: boolean;
  systemPrompt: {
    changed: boolean;
    /** Lines only in the second run; present when both runs kept the prompt text. */
    addedLines?: string[];
    /** Lines only in the first run; present when both runs kept the prompt text. */
    removedLines?: string[];
  };
  tools: {
    /** Offered only in the second run. */
    added: string[];
    /** Offered only in the first run. */
    removed: string[];
    /** Offered in both with a different definition. */
    changed: string[];
  };
};

/** The tool name to definition hash map of a run's first turn, or of all turns merged. */
function toolHashes(trace: AgentTrace): Map<string, string> {
  const hashes = new Map<string, string>();

  for (const turn of trace.turns) {
    for (const tool of turn.toolsOffered) hashes.set(tool.name, tool.schemaHash);
  }

  return hashes;
}

/**
 * Compare what two runs sent to the model: the system prompt (a changed
 * flag, plus changed lines when both kept the text) and the tool
 * definitions by name and schema hash. Answers "did these two versions
 * send identical tools?" without hand-written request dumps.
 *
 * @example
 * const diff = diffAgentTraces(agentTraces.get(a)!, agentTraces.get(b)!);
 * if (!diff.identical) console.log(diff.tools.changed);
 */
export function diffAgentTraces(before: AgentTrace, after: AgentTrace): AgentTraceDiff {
  const beforeTools = toolHashes(before);
  const afterTools = toolHashes(after);
  const added = [...afterTools.keys()].filter((name) => !beforeTools.has(name));
  const removed = [...beforeTools.keys()].filter((name) => !afterTools.has(name));
  const changed = [...afterTools.keys()].filter(
    (name) => beforeTools.has(name) && beforeTools.get(name) !== afterTools.get(name),
  );
  const promptChanged = before.systemPrompt?.hash !== after.systemPrompt?.hash;
  const beforeText = before.systemPrompt?.text;
  const afterText = after.systemPrompt?.text;
  const lines =
    promptChanged && beforeText !== undefined && afterText !== undefined
      ? {
          addedLines: lineDifference(afterText, beforeText),
          removedLines: lineDifference(beforeText, afterText),
        }
      : {};

  return {
    identical: !promptChanged && added.length === 0 && removed.length === 0 && changed.length === 0,
    systemPrompt: { changed: promptChanged, ...lines },
    tools: { added, removed, changed },
  };
}

/** Lines of `text` that do not appear in `other`. */
function lineDifference(text: string, other: string): string[] {
  const known = new Set(other.split("\n"));

  return text.split("\n").filter((line) => !known.has(line));
}

/**
 * A plain-text rendering of one trace for terminals and logs: the run line,
 * then each turn with its tools offered, calls, refusals, contract actions
 * and usage. Uncolored.
 *
 * @example
 * console.log(formatAgentTrace(agentTraces.get(runId)!));
 */
export function formatAgentTrace(trace: AgentTrace): string {
  const lines = [
    `${trace.agent}  ${trace.runId}  ${trace.status}  ${trace.model.provider}/${trace.model.name}`,
    `  input: ${trace.input}`,
  ];

  if (trace.systemPrompt) lines.push(`  system prompt: ${trace.systemPrompt.hash}`);

  for (const turn of trace.turns) {
    const cost = turn.cost === undefined ? "" : `  $${turn.cost.toFixed(6)}`;

    lines.push(
      `  turn ${turn.index}  ${turn.finishReason ?? "running"}  ${turn.durationMs.toFixed(0)}ms  in ${turn.usage.input} out ${turn.usage.output}${cost}`,
      `    tools offered (${turn.toolsOffered.length}, ~${turn.toolsOffered.reduce((sum, tool) => sum + tool.tokens, 0)} tokens): ${turn.toolsOffered.map((tool) => `${tool.name}@${tool.schemaHash.slice(0, 8)}`).join(", ") || "none"}`,
    );

    for (const call of turn.toolCalls) {
      lines.push(
        `    call ${call.name}  ${call.status}  ${call.durationMs.toFixed(0)}ms  ${JSON.stringify(call.input)}`,
      );
      if (call.refusal) lines.push(`      refused: ${call.refusal}`);
      else if (call.error) lines.push(`      error: ${call.error.message}`);
      else if (call.output !== undefined) lines.push(`      result: ${JSON.stringify(call.output)}`);
    }

    for (const event of turn.contract) {
      lines.push(`    contract ${event.type}${"tool" in event ? ` ${event.tool}` : ""}${"name" in event ? ` ${event.name}` : ""}`);
    }

    if (turn.error) lines.push(`    error: ${turn.error.message}`);
  }

  const cost = trace.cost === undefined ? "" : `  $${trace.cost.toFixed(6)}`;

  lines.push(`  total: in ${trace.usage.input} out ${trace.usage.output}${cost}`);

  if (trace.error) lines.push(`  error: ${trace.error.message}`);

  return lines.join("\n");
}
