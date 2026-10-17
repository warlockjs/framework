// Contracts — the public type surface (events, adapter, options, MCP).
export type {
  CliAdapter,
  CliAdapterVerification,
  CliAgentOptions,
  CliEndStatus,
  CliErrorEvent,
  CliEvent,
  CliHome,
  CliLaunchContext,
  CliLaunchFile,
  CliLaunchPlan,
  CliMcpRemoteServer,
  CliMcpServer,
  CliMcpServers,
  CliMcpStdioServer,
  CliMessageEvent,
  CliParsedEvent,
  CliPermission,
  CliProbeResult,
  CliProbeSpec,
  CliPromptTransport,
  CliResult,
  CliRunOptions,
  CliSession,
  CliSessionEndedEvent,
  CliSessionStartedEvent,
  CliStreamParser,
  CliToolCallEvent,
  CliToolResultEvent,
  CliUsage,
  CliUsageEvent,
} from "./contracts";

// Errors
export { CliError } from "./errors";
export type { CliErrorOptions, CliErrorType } from "./errors";

// Core
export { createCliAgent, currentHost } from "./cli-agent";
export type { CliAgent, CliHost } from "./cli-agent";
export { cliModel, renderPrompt, toUsage } from "./model/cli-model";
export type { CliModelConfig } from "./model/cli-model";

// Building blocks for custom adapters
export {
  asArray,
  asRecord,
  jsonLinesParser,
  numberField,
  outputText,
  parseJsonLine,
  recordField,
  stringField,
} from "./stream/json-lines";
export type { JsonRecord } from "./stream/json-lines";
export { toToml } from "./utils/toml";
export type { TomlTable, TomlValue } from "./utils/toml";
export { helpLists, missingFlags, parseVersion } from "./probe/probe";

// Spawn rules (pure functions, usable for diagnostics)
export { findExecutable, parseCmdShim, resolveSpawnTarget } from "./spawn/resolve-command";
export type { CmdShimTarget, CommandLookup, SpawnTarget } from "./spawn/resolve-command";
export { buildInvocation, fitsCommandLine, quoteForCmd } from "./spawn/invocation";
export type { Invocation } from "./spawn/invocation";

// Built-in adapters
export * from "./adapters";

// The namespace + the `ai.cli` registration (importing the barrel registers it).
export { cli, cliAdapters } from "./cli";
export type { CliVendor } from "./cli";
