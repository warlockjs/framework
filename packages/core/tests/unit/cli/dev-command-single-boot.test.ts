import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLICommandsManager } from "../../../src/cli/cli-commands.manager";
import { CLICommand } from "../../../src/commands/cli-command";
import { WORKER_ENV_FLAG } from "../../../src/dev-server/supervisor";

/*
  ── WHAT THIS FILE IS DEFENDING ──────────────────────────────────────────────

  Owner report, `warlock dev` on 5.0.2:

      $ warlock dev
        › Running dev...

        › Running dev...

        ⚡ Warlock.js v5.0.2

  The question was NOT "why is the line printed twice", it was "did the
  application boot twice". It did not. `warlock dev` is deliberately two
  processes:

    supervisor  the invocation the user typed. Owns the terminal, spawns and
                respawns the worker, loads NO config and NO connectors.
    worker      the re-spawn, carrying WARLOCK_DEV_WORKER=1. The actual server.

  Both are `warlock dev`, so both ran `CLICommandsManager.execute()` and both
  printed the header. But `dev-server.command.ts`'s `preAction` returns
  `superviseDevServer()`, whose promise NEVER settles, so the supervisor's
  `await commandPreAction(...)` never resolves and `loadPreloaders()` /
  `command.execute()` are unreachable in it.

  That last sentence is the invariant. The header is cosmetic; the invariant is
  not. If a future change ever lets the supervisor fall through to its
  preloaders, `warlock dev` really would boot twice — two schedulers, two sets
  of listeners, doubled per-request work — and the tests below are what fail.
*/

/** Reaches the protected boot path so the assertions can be about behaviour. */
class ObservableManager extends CLICommandsManager {
  public preloadCalls = 0;

  protected async loadPreloaders(): Promise<void> {
    this.preloadCalls++;
  }
}

/**
 * The dev command's structure, reproduced rather than imported: importing the
 * real one drags in the whole dev-server module graph, and the shape under test
 * is the CONTRACT between `preAction` and `execute`, not that command's body.
 */
function devLikeCommand(options: {
  onSupervise: () => Promise<never>;
  onAction: () => void;
}): CLICommand {
  const command = new CLICommand("dev");

  command.isPersistent = true;
  command.commandPreload = { config: true, bootstrap: true, connectors: true };

  command.preAction(async () => {
    if (process.env[WORKER_ENV_FLAG] !== "1") {
      return options.onSupervise();
    }
  });

  command.action(async () => {
    options.onAction();
  });

  return command;
}

describe("`warlock dev` — the header prints once per invocation, not once per process", () => {
  const original = process.env[WORKER_ENV_FLAG];
  let logged: string[];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (original === undefined) {
      delete process.env[WORKER_ENV_FLAG];
    } else {
      process.env[WORKER_ENV_FLAG] = original;
    }
  });

  const headerLines = () => logged.filter((line) => line.includes("Running"));

  it("prints the header in the supervisor — the process the user actually started", async () => {
    delete process.env[WORKER_ENV_FLAG];

    const manager = new ObservableManager();
    const command = devLikeCommand({
      // Stands in for `superviseDevServer()`: a promise that never settles.
      onSupervise: () => new Promise<never>(() => {}),
      onAction: () => {
        throw new Error("the supervisor must never reach the action");
      },
    });

    void manager.execute(command, { options: {}, args: [] });

    // One turn is enough: the header is printed before `preAction` is awaited.
    await new Promise((resolve) => setImmediate(resolve));

    expect(headerLines()).toHaveLength(1);
  });

  it("prints NO header in the re-spawned worker, so one invocation yields one header", async () => {
    process.env[WORKER_ENV_FLAG] = "1";

    const manager = new ObservableManager();
    const command = devLikeCommand({
      onSupervise: () => {
        throw new Error("the worker must never supervise");
      },
      onAction: () => {},
    });

    await manager.execute(command, { options: {}, args: [] });

    expect(headerLines()).toHaveLength(0);
  });
});

describe("`warlock dev` — only ONE process may run the boot path", () => {
  const original = process.env[WORKER_ENV_FLAG];

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (original === undefined) {
      delete process.env[WORKER_ENV_FLAG];
    } else {
      process.env[WORKER_ENV_FLAG] = original;
    }
  });

  it("never loads preloaders or runs the action in the supervisor", async () => {
    delete process.env[WORKER_ENV_FLAG];

    const manager = new ObservableManager();
    let actionRuns = 0;

    const command = devLikeCommand({
      onSupervise: () => new Promise<never>(() => {}),
      onAction: () => {
        actionRuns++;
      },
    });

    void manager.execute(command, { options: {}, args: [] });

    // Generous: any number of turns must not be enough, because the supervisor's
    // preAction is a dead end by construction rather than merely slow.
    for (let turn = 0; turn < 20; turn++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    // THE double-boot assertion. A supervisor that reaches either of these is a
    // second application boot inside one `warlock dev`.
    expect(manager.preloadCalls).toBe(0);
    expect(actionRuns).toBe(0);
  });

  it("loads preloaders exactly once in the worker", async () => {
    process.env[WORKER_ENV_FLAG] = "1";

    const manager = new ObservableManager();
    let actionRuns = 0;

    const command = devLikeCommand({
      onSupervise: () => {
        throw new Error("the worker must never supervise");
      },
      onAction: () => {
        actionRuns++;
      },
    });

    await manager.execute(command, { options: {}, args: [] });

    expect(manager.preloadCalls).toBe(1);
    expect(actionRuns).toBe(1);
  });
});
