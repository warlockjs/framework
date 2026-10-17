import { accessSync, constants, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type {
  CliAdapter,
  CliAgentOptions,
  CliLaunchContext,
  CliLaunchPlan,
  CliProbeResult,
  CliRunOptions,
  CliSession,
} from "./contracts";
import type { ModelContract } from "@warlock.js/ai";
import { CliError } from "./errors";
import { type CliModelConfig, cliModel } from "./model/cli-model";
import { assertCapabilities, probeCli } from "./probe/probe";
import { buildEnvironment } from "./session/environment";
import { createRunDirectories, writeLaunchFiles } from "./session/run-directory";
import { cancelledSession, startSession } from "./session/session";
import { buildInvocation, fitsCommandLine, type Invocation } from "./spawn/invocation";
import {
  type CommandLookup,
  readEnv,
  resolveSpawnTarget,
  type SpawnTarget,
} from "./spawn/resolve-command";

/** A configured coding CLI: run prompts, probe the binary, or use it as an `ai.agent` model. */
export type CliAgent = {
  readonly adapter: CliAdapter;
  readonly options: Readonly<CliAgentOptions>;
  /**
   * Start a session. Rejects (with {@link CliError}) only for setup problems
   * — executable not found, a flag missing from `--help`, an unsupported
   * option; the run's own outcome is reported by `session.done()`.
   */
  run(prompt: string, options?: CliRunOptions): Promise<CliSession>;
  /** Run (or reuse) the capability probe: resolved executable, version and help text. */
  probe(): Promise<CliProbeResult>;
  /** This CLI as an `ai.agent` model (see {@link cliModel}). */
  model(config?: CliModelConfig): ModelContract;
};

/** Host facts, injectable for tests. */
export type CliHost = CommandLookup & { comspec: string };

function isRunnableFile(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(filePath).isFile()) {
      return false;
    }

    if (platform !== "win32") {
      accessSync(filePath, constants.X_OK);
    }

    return true;
  } catch {
    return false;
  }
}

/** The current machine as a {@link CliHost}. */
export function currentHost(): CliHost {
  const platform = process.platform;

  return {
    platform,
    env: process.env,
    isFile: (filePath) => isRunnableFile(filePath, platform),
    readFile: (filePath) => {
      try {
        return readFileSync(filePath, "utf8");
      } catch {
        return undefined;
      }
    },
    execPath: process.execPath,
    comspec: readEnv(process.env, "ComSpec", platform) ?? "cmd.exe",
  };
}

function unsupported(adapter: CliAdapter, message: string): CliError {
  return new CliError(`${adapter.title}: ${message}`, {
    type: "unsupported-option",
    adapter: adapter.name,
  });
}

/**
 * Create a CLI agent from an adapter. The vendor factories
 * (`cli.claudeCode(...)`, `cli.codex(...)`, …) call this with their
 * built-in adapter; call it directly with your own {@link CliAdapter}.
 *
 * @example
 * const agent = createCliAgent(myAdapter, { model: "fast", permission: "standard" });
 * const session = await agent.run("Summarize README.md", { cwd: "/srv/repo" });
 * console.log((await session.done()).text);
 */
export function createCliAgent(
  adapter: CliAdapter,
  options: CliAgentOptions = {},
  host: CliHost = currentHost(),
): CliAgent {
  const probes = new Map<string, Promise<CliProbeResult>>();
  const command = options.command ?? adapter.command;

  const resolveTarget = (): SpawnTarget => {
    const target = resolveSpawnTarget(command, host);

    if (target === undefined) {
      throw new CliError(
        `${adapter.title}: could not find "${command}" on PATH. Install the CLI or pass its absolute path as \`command\`.`,
        { type: "not-found", adapter: adapter.name },
      );
    }

    return target;
  };

  const probeEnvironment = (): Record<string, string> =>
    buildEnvironment({
      source: host.env,
      inherit: options.inheritEnv ?? true,
      managed: [],
      user: options.env,
      platform: host.platform,
    });

  const probeTarget = (target: SpawnTarget): Promise<CliProbeResult> => {
    const cached = probes.get(target.executable);

    if (cached !== undefined) {
      return cached;
    }

    const pending = probeCli({
      adapter,
      target,
      env: probeEnvironment(),
      cwd: path.resolve(options.cwd ?? process.cwd()),
      comspec: host.comspec,
      platform: host.platform,
    });

    probes.set(target.executable, pending);
    // A failed probe is retried on the next run instead of being cached.
    pending.catch(() => probes.delete(target.executable));

    return pending;
  };

  const run = async (prompt: string, runOptions: CliRunOptions = {}): Promise<CliSession> => {
    const merged: CliRunOptions = {
      ...options,
      ...runOptions,
      env: { ...options.env, ...runOptions.env },
      args: [...(options.args ?? []), ...(runOptions.args ?? [])],
      mcp: runOptions.mcp ?? options.mcp,
    };
    const permission = merged.permission ?? "standard";

    if (permission !== "standard" && permission !== "bypass") {
      throw unsupported(
        adapter,
        `unknown permission "${String(permission)}" (use "standard" or "bypass").`,
      );
    }

    if (merged.effort !== undefined && adapter.effort !== true) {
      throw unsupported(adapter, "this CLI has no reasoning-effort control; drop `effort`.");
    }

    const mcp =
      merged.mcp !== undefined && Object.keys(merged.mcp).length > 0 ? merged.mcp : undefined;

    if (mcp !== undefined && adapter.mcp !== true) {
      throw unsupported(adapter, "this CLI cannot attach per-run MCP servers; drop `mcp`.");
    }

    if (merged.apiKey !== undefined && adapter.apiKeyEnv.length === 0) {
      throw unsupported(adapter, "this CLI reads no API key from the environment; drop `apiKey`.");
    }

    const home = options.home ?? "private";

    if (home !== "inherit" && adapter.homeEnv.length === 0) {
      throw unsupported(
        adapter,
        'this CLI cannot relocate its config home; use `home: "inherit"`.',
      );
    }

    const cwd = path.resolve(merged.cwd ?? process.cwd());
    const target = resolveTarget();
    const probe = options.probe === false ? undefined : await probeTarget(target);

    if (merged.signal?.aborted) {
      return cancelledSession(adapter.name, merged.resume);
    }

    const directories = await createRunDirectories(home, cwd);

    try {
      let chosen:
        | { plan: CliLaunchPlan; invocation: Invocation; context: CliLaunchContext }
        | undefined;
      const reasons: string[] = [];

      for (const transport of adapter.transports) {
        const context: CliLaunchContext = {
          prompt,
          transport,
          cwd,
          model: merged.model,
          effort: merged.effort,
          permission,
          resume: merged.resume,
          mcp,
          apiKey: merged.apiKey,
          home: directories.home,
          homeIsPrivate: directories.homeIsPrivate,
          runDir: directories.runDir,
          platform: host.platform,
        };
        const plan = adapter.plan(context);

        if (probe !== undefined) {
          assertCapabilities(adapter, probe, plan.requires);
        }

        const invocation = buildInvocation(
          target,
          [...plan.args, ...(merged.args ?? []), ...(plan.tail ?? [])],
          host.comspec,
        );

        if ("refused" in invocation) {
          reasons.push(`${transport}: ${invocation.refused}`);
          continue;
        }

        if (!fitsCommandLine(invocation, host.platform)) {
          reasons.push(`${transport}: the command line exceeds the platform limit`);
          continue;
        }

        chosen = { plan, invocation, context };
        break;
      }

      if (chosen === undefined) {
        throw new CliError(
          `${adapter.title}: the prompt cannot be passed to "${target.executable}" (${reasons.join("; ")}).`,
          { type: "prompt-transport", adapter: adapter.name, executable: target.executable },
        );
      }

      await writeLaunchFiles(chosen.plan.files ?? [], directories);

      const apiKeyEnv = adapter.apiKeyEnv[0];
      const env = buildEnvironment({
        source: host.env,
        inherit: options.inheritEnv ?? true,
        managed: home === "inherit" ? [] : adapter.homeEnv,
        // A CLI that prefers $PWD over its real cwd must not see the host's.
        plan: host.platform === "win32" ? chosen.plan.env : { PWD: cwd, ...chosen.plan.env },
        user: merged.env,
        apiKey:
          merged.apiKey !== undefined && apiKeyEnv !== undefined
            ? { name: apiKeyEnv, value: merged.apiKey }
            : undefined,
        platform: host.platform,
      });

      return startSession({
        adapter: adapter.name,
        invocation: chosen.invocation,
        cwd,
        env,
        stdin: chosen.plan.stdin,
        parser: adapter.parser(chosen.context),
        signal: merged.signal,
        timeoutMs: merged.timeoutMs,
        killGraceMs: options.killGraceMs ?? 2000,
        platform: host.platform,
        resume: merged.resume,
        cleanup: directories.dispose,
      });
    } catch (error) {
      await directories.dispose();
      throw error;
    }
  };

  const agent: CliAgent = {
    adapter,
    options,
    run,
    probe: () => probeTarget(resolveTarget()),
    model: (config) => cliModel(agent, config),
  };

  return agent;
}
