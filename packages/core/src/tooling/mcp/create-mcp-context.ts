import path from "node:path";
import { childTypecheckRunner } from "../../cli/commands/check/child-typecheck";
import { WarlockError } from "../../errors/warlock-error";
import { runCheck } from "../check/run-check";
import { runTests } from "../check/run-tests";
import { connectDevtools, type ConnectDevtoolsOptions } from "../devtools/devtools-client";
import { applyGeneration, resolveCliEntry, sandboxBackend } from "../generate";
import type { InspectReport, InspectSection } from "../inspect/inspect-report.types";
import { type DocsCorpus, loadDocsCorpus } from "./docs-search";
import type { WarlockMcpContext } from "./mcp-tools";

/** Options of {@link createMcpContext}. */
export type CreateMcpContextOptions = {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string;
  /** Let generate tools write into the project. Default `false`. */
  allowWrites?: boolean;
  /** How the app is described: a booted snapshot (`warlock mcp`) or the live process (`warlock dev --mcp`). */
  inspect: (sections: readonly InspectSection[]) => Promise<InspectReport>;
  /**
   * The `warlock` CLI script. Runs the typecheck in a child process (so a heap
   * overflow cannot end the server) and the generators. Default: core's bin.
   */
  cliEntry?: string;
  /** Where the dev server is, for `requests_recent`. Default: `.warlock/dev-server.json`. */
  devtools?: Omit<ConnectDevtoolsOptions, "cwd">;
  /** The `warlock add` feature names to advertise. */
  features?: readonly string[];
};

/** The project's `warlock` bin, or `undefined` (the generators then report the problem when used). */
function findCliEntry(cwd: string): string | undefined {
  try {
    return resolveCliEntry(cwd);
  } catch {
    return undefined;
  }
}

/**
 * The real {@link WarlockMcpContext}: `warlock check`, `runTests`, the devtools
 * client, the sandboxed generators and the installed-docs corpus (loaded once).
 */
export function createMcpContext(options: CreateMcpContextOptions): WarlockMcpContext {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const allowWrites = options.allowWrites === true;
  const cliEntry = options.cliEntry ?? findCliEntry(cwd);
  const sandbox = sandboxBackend(cliEntry ? { cliEntry } : {});
  let corpus: Promise<DocsCorpus> | undefined;

  return {
    cwd,
    allowWrites,
    inspect: options.inspect,
    check: ({ changed, base, skip }) => {
      const flags = [...(changed ? ["--changed"] : []), ...(base ? ["--base", base] : [])];

      return runCheck({
        cwd,
        changed,
        base,
        skip,
        ...(cliEntry ? { typecheck: childTypecheckRunner(cliEntry, flags) } : {}),
      });
    },
    tests: ({ files, changed, base }) => runTests({ cwd, files, changed, base }),
    devtools: () => connectDevtools({ cwd, ...options.devtools }),
    generation: {
      plan: (spec) => sandbox.plan(spec, { cwd }),
      apply: async (spec) => {
        if (!allowWrites) {
          throw new WarlockError(
            "WL7005",
            "This MCP server is read-only; restart it with --allow-writes to let generate tools write.",
          );
        }

        return applyGeneration(spec, { cwd, ...(cliEntry ? { cliEntry } : {}) });
      },
    },
    docs: () => {
      corpus ??= loadDocsCorpus(cwd);

      return corpus;
    },
    features: options.features,
  };
}
