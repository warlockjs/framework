/**
 * `@warlock.js/core/tooling` — the machine-readable side of the CLI, as
 * functions: `inspectApp()` (what `warlock inspect` prints), `runCheck()`
 * (`warlock check`), `runTests()`, `runTypecheck()` (`warlock typecheck`),
 * `startWarlockMcpServer()` (`warlock mcp`), `traceRequest()` (`warlock
 * trace`), `writeAgentsMd()` (`warlock agents-md`), the agent board (`warlock
 * board`), the sandboxed generator diffs, and the shared problem shape every
 * one of them reports.
 *
 * A separate entry because it pulls in the TypeScript compiler and ESLint,
 * which must not reach an app's production module graph through the root
 * barrel. Error codes are on `@warlock.js/core/errors` (and the root).
 */
export * from "./agents-md";
export * from "./board";
export * from "./check";
export * from "./dev-state/dev-server-state";
export * from "./devtools/devtools-client";
export * from "./generate";
export * from "./inspect";
export * from "./mcp";
export {
  createProblem,
  type ProblemInput,
  type ProblemSource,
  type ToolingProblem,
} from "./problem";
export * from "./trace";
export * from "./typecheck";
