// Every contract in this package is a pure type declaration (interfaces +
// unions), so all re-exports are `export type`. Value exports (factories,
// classes) live outside `contracts/` — the policy engine, tools, and
// error classes.

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
  WorkspaceToolName,
  WriteFileInput,
  WriteFileResult,
} from "./tool-io.type";
export type {
  WorkspaceBackend,
  WorkspaceBackendExecOptions,
  WorkspaceBackendExecResult,
} from "./workspace-backend.contract";
export type { WorkspaceOps } from "./workspace-ops.contract";
export type {
  WorkspaceBackendType,
  WorkspacePolicy,
  WorkspaceReadPolicy,
  WorkspaceShellPolicy,
} from "./workspace-policy.type";
export type { Workspace, WorkspaceTools } from "./workspace.contract";
