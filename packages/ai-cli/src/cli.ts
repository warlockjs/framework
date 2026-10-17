import { ai } from "@warlock.js/ai";
import { aiderAdapter } from "./adapters/aider";
import { ampAdapter } from "./adapters/amp";
import { antigravityAdapter } from "./adapters/antigravity";
import { claudeCodeAdapter } from "./adapters/claude-code";
import { codexAdapter } from "./adapters/codex";
import { copilotAdapter } from "./adapters/copilot";
import { cursorAdapter } from "./adapters/cursor";
import { droidAdapter } from "./adapters/droid";
import { grokAdapter } from "./adapters/grok";
import { kimiAdapter } from "./adapters/kimi";
import { mistralVibeAdapter } from "./adapters/mistral-vibe";
import { opencodeAdapter } from "./adapters/opencode";
import { qwenCodeAdapter } from "./adapters/qwen-code";
import { reasonixAdapter } from "./adapters/reasonix";
import { type CliAgent, createCliAgent } from "./cli-agent";
import type { CliAdapter, CliAgentOptions } from "./contracts";
import { cliModel } from "./model/cli-model";

/** Every built-in adapter, keyed by its factory name. */
export const cliAdapters = {
  claudeCode: claudeCodeAdapter,
  codex: codexAdapter,
  antigravity: antigravityAdapter,
  qwenCode: qwenCodeAdapter,
  kimi: kimiAdapter,
  cursor: cursorAdapter,
  copilot: copilotAdapter,
  grok: grokAdapter,
  opencode: opencodeAdapter,
  amp: ampAdapter,
  droid: droidAdapter,
  mistralVibe: mistralVibeAdapter,
  aider: aiderAdapter,
  reasonix: reasonixAdapter,
} as const;

/** Name of a built-in adapter factory. */
export type CliVendor = keyof typeof cliAdapters;

type VendorFactories = { [Vendor in CliVendor]: (options?: CliAgentOptions) => CliAgent };

const factories = Object.fromEntries(
  Object.entries(cliAdapters).map(([vendor, adapter]) => [
    vendor,
    (options?: CliAgentOptions) => createCliAgent(adapter, options),
  ]),
) as VendorFactories;

/**
 * The CLI-agent namespace: one factory per vendor, `custom()` for your own
 * adapter, `model()` to hand a CLI agent to `ai.agent`. Also available as
 * `ai.cli` once the package is imported.
 *
 * @example
 * import { cli } from "@warlock.js/ai-cli";
 *
 * const claude = cli.claudeCode({ model: "sonnet", cwd: "/srv/repo" });
 * const session = await claude.run("Fix the failing test");
 * for await (const event of session.events) console.log(event.type);
 * const { text, usage, sessionRef } = await session.done();
 */
export const cli: VendorFactories & {
  /** A CLI agent for an adapter you wrote. */
  custom(adapter: CliAdapter, options?: CliAgentOptions): CliAgent;
  /** A CLI agent as an `ai.agent` model. */
  model: typeof cliModel;
  /** The built-in adapters, for inspection or extension. */
  adapters: typeof cliAdapters;
} = {
  ...factories,
  custom: (adapter, options) => createCliAgent(adapter, options),
  model: cliModel,
  adapters: cliAdapters,
};

declare module "@warlock.js/ai" {
  interface Ai {
    /** Drive vendor coding CLIs (Claude Code, Codex, Copilot, …) as agents. */
    cli: typeof cli;
  }
}

// Runtime registration: importing the package attaches `cli` to the shared `ai` object.
ai.cli = cli;
