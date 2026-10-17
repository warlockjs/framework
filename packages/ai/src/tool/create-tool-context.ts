import type { ToolContext } from "../contracts/tool.contract";

/** Options for {@link createToolContext}. */
export type CreateToolContextOptions<TArtifacts> = {
  /** The side-channel bag; a fresh empty object when omitted. */
  artifacts?: TArtifacts;
  /** Cancellation for cancellation-aware tools. */
  signal?: AbortSignal;
};

/**
 * Build a {@link ToolContext} for calling a tool outside the agent loop —
 * a script, a test, an HTTP handler, an MCP bridge — without faking the
 * `artifacts` bag the agent normally supplies.
 *
 * @example
 * const controller = new AbortController();
 * const ctx = createToolContext({ signal: controller.signal });
 * const result = await searchTool.invoke({ query: "warlock" }, ctx);
 * console.log(result, ctx.artifacts); // artifacts the tool wrote, if any
 */
export function createToolContext<TArtifacts = Record<string, unknown>>(
  options: CreateToolContextOptions<TArtifacts> = {},
): ToolContext<TArtifacts> {
  return {
    // An empty bag is the documented "no artifacts yet" state; callers
    // that need required keys pass `artifacts` explicitly.
    artifacts: options.artifacts ?? ({} as TArtifacts),
    ...(options.signal ? { signal: options.signal } : {}),
  };
}
