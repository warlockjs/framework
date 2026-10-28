// Contracts — the public type surface (Workspace object, policy, ops,
// backend, and the tool IO shapes), re-exported as pure types.
export type {
  ApplyPatchFileResult,
  ApplyPatchInput,
  ApplyPatchResult,
  EditFileInput,
  EditFileResult,
  ExecOptions,
  GlobInput,
  GlobResult,
  GrepInput,
  GrepMatch,
  GrepResult,
  ListDirEntry,
  ListDirEntryType,
  ListDirInput,
  ListDirOptions,
  ListDirResult,
  MultiEditInput,
  MultiEditOperation,
  MultiEditResult,
  ReadFileInput,
  ReadFileResult,
  RunShellBackgroundResult,
  RunShellInput,
  RunShellResult,
  RunTestsInput,
  ShellJobInfo,
  ShellJobStatus,
  ShellKillInput,
  ShellOutputInput,
  ShellOutputOptions,
  ShellOutputResult,
  StartShellOptions,
  TodoListResult,
  TodoWriteInput,
  Workspace,
  WorkspaceAllowCommand,
  WorkspaceBackend,
  WorkspaceBackendExecOptions,
  WorkspaceBackendExecResult,
  WorkspaceBackendProcess,
  WorkspaceBackendStartOptions,
  WorkspaceBackendStat,
  WorkspaceBackendType,
  WorkspaceBackgroundPolicy,
  WorkspaceCommandCheckContext,
  WorkspaceCommandPattern,
  WorkspaceListPolicy,
  WorkspaceOps,
  WorkspaceOutputStream,
  WorkspacePolicy,
  WorkspaceReadPolicy,
  WorkspaceShellInterpreter,
  WorkspaceShellPolicy,
  WorkspaceTodo,
  WorkspaceTodoInput,
  WorkspaceTodoStatus,
  WorkspaceToolName,
  WorkspaceTools,
  WriteFileInput,
  WriteFileResult,
} from "./contracts";

// Errors
export { WorkspaceEditError, WorkspaceJobError, WorkspacePolicyError } from "./errors";
export type {
  WorkspaceEditErrorOptions,
  WorkspaceEditFailure,
  WorkspaceJobErrorOptions,
  WorkspaceJobFailure,
  WorkspacePolicyErrorOptions,
  WorkspacePolicyViolation,
  WorkspaceShellRefusalReason,
} from "./errors";

// Policy engine seam
export { buildEnv, isCommandAllowed, resolveInJail } from "./policy/policy";
export type { ResolvedPath } from "./policy/policy";
export { checkShellCommand } from "./policy/shell-check";
export type {
  WorkspaceShellCheck,
  WorkspaceShellPath,
  WorkspaceShellPathAccess,
} from "./policy/shell-check";
export { analyzeArgvCommand, tokenizeCommand } from "./policy/tokenize-command";
export type { ArgvAnalysis } from "./policy/tokenize-command";

// Patch engine (pure: parse a unified diff, apply hunks to text)
export { applyHunks } from "./patch/apply-hunks";
export { parsePatch } from "./patch/parse-patch";
export type { FilePatch, FilePatchKind, PatchHunk, PatchLine } from "./patch/parse-patch";

// Ops layer
export { createOps } from "./ops";

// Backends
export { createLocalBackend } from "./backends/local";
export { createMockBackend } from "./backends/mock";
export type { MockBackendSeed, MockExecResult } from "./backends/mock";

// Tool factories
export { makeApplyPatchTool } from "./tools/apply-patch";
export { makeEditFileTool } from "./tools/edit-file";
export { makeGlobTool } from "./tools/glob";
export type { MakeGlobToolOptions } from "./tools/glob";
export { makeGrepTool } from "./tools/grep";
export type { MakeGrepToolOptions } from "./tools/grep";
export { makeListDirTool } from "./tools/list-dir";
export { makeMultiEditTool } from "./tools/multi-edit";
export { makeReadFileTool } from "./tools/read-file";
export { makeRunShellTool } from "./tools/run-shell";
export type { MakeRunShellToolOptions } from "./tools/run-shell";
export { makeRunTestsTool } from "./tools/run-tests";
export type { MakeRunTestsToolOptions } from "./tools/run-tests";
export { makeShellKillTool } from "./tools/shell-kill";
export { makeShellOutputTool } from "./tools/shell-output";
export { makeTodoReadTool, makeTodoWriteTool } from "./tools/todo";
export { makeWriteFileTool } from "./tools/write-file";

// Todo list store (backs the todo tools)
export { TodoStore } from "./todos";

// The factory + the `ai.workspace(...)` registration. Importing this
// module (transitively, via the barrel) registers the verb on the shared
// `ai` object.
export { workspace } from "./workspace";
