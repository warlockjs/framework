// Contracts — the public type surface (Workspace object, policy, ops,
// backend, and the tool IO shapes), re-exported as pure types.
export type {
  EditFileInput,
  EditFileResult,
  ExecOptions,
  GlobInput,
  GlobResult,
  GrepInput,
  GrepMatch,
  GrepResult,
  ReadFileInput,
  ReadFileResult,
  RunShellInput,
  RunShellResult,
  RunTestsInput,
  Workspace,
  WorkspaceBackend,
  WorkspaceBackendExecOptions,
  WorkspaceBackendExecResult,
  WorkspaceBackendType,
  WorkspaceOps,
  WorkspacePolicy,
  WorkspaceReadPolicy,
  WorkspaceShellPolicy,
  WorkspaceToolName,
  WorkspaceTools,
  WriteFileInput,
  WriteFileResult,
} from "./contracts";

// Errors
export {
  WorkspaceEditError,
  WorkspacePolicyError,
} from "./errors";
export type {
  WorkspaceEditErrorOptions,
  WorkspaceEditFailure,
  WorkspacePolicyErrorOptions,
  WorkspacePolicyViolation,
} from "./errors";

// Policy engine seam
export { buildEnv, isCommandAllowed, resolveInJail } from "./policy/policy";
export type { ResolvedPath } from "./policy/policy";

// Ops layer
export { createOps } from "./ops";

// Backends
export { createLocalBackend } from "./backends/local";
export { createMockBackend } from "./backends/mock";
export type { MockBackendSeed, MockExecResult } from "./backends/mock";

// Tool factories
export { makeEditFileTool } from "./tools/edit-file";
export { makeGlobTool } from "./tools/glob";
export type { MakeGlobToolOptions } from "./tools/glob";
export { makeGrepTool } from "./tools/grep";
export type { MakeGrepToolOptions } from "./tools/grep";
export { makeReadFileTool } from "./tools/read-file";
export { makeRunShellTool } from "./tools/run-shell";
export type { MakeRunShellToolOptions } from "./tools/run-shell";
export { makeRunTestsTool } from "./tools/run-tests";
export type { MakeRunTestsToolOptions } from "./tools/run-tests";
export { makeWriteFileTool } from "./tools/write-file";

// The factory + the `ai.workspace(...)` registration. Importing this
// module (transitively, via the barrel) registers the verb on the shared
// `ai` object.
export { workspace } from "./workspace";
