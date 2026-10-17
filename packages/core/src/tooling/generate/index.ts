export {
  applyGeneration,
  MAX_FILE_DIFF_BYTES,
  sandboxBackend,
  type ApplyGenerationOptions,
  type GeneratedFile,
  type GenerationBackend,
  type GenerationPlan,
  type GenerationPlanOptions,
  type SandboxBackendOptions,
} from "./generation";
export {
  buildGeneratorArgs,
  isMakeGenerator,
  MAKE_GENERATOR_FLAGS,
  MAKE_GENERATORS,
  type GeneratorArgsOptions,
  type GeneratorSpec,
  type MakeGenerator,
} from "./generator-spec";
export {
  DEFAULT_GENERATION_TIMEOUT_MS,
  describeRun,
  resolveCliEntry,
  spawnCli,
  type CliInvocation,
  type CliRun,
  type CliRunner,
} from "./run-cli";
export { DIFF_CONTEXT_LINES, unifiedDiff, type UnifiedDiffInput } from "./unified-diff";
