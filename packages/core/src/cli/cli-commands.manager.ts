import { colors } from "@mongez/copper";
import { fileExistsAsync } from "@warlock.js/fs";
import { Application } from "../application";
import { bootstrap } from "../bootstrap";
import { loadConfigFiles } from "../config/load-config-files";
import { connectorsManager } from "../connectors/connectors-manager";
import { registerConfiguredConnectors } from "../connectors/register-configured-connectors";
import { ConnectorLifecyclePhase } from "../connectors/types";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { manifestManager } from "../manifest/manifest-manager";
import { appPath } from "../utils";
import { loadEnvironmentFiles } from "../utils/load-environment";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";
import { CLICommand } from "../commands/cli-command";
import {
  displayBootError,
  displayCommandError,
  displayCommandHelp,
  displayCommandNotFound,
  displayCommandSuccess,
  displayExecutingCommand,
  displayHelp,
  displayMissingCommand,
  displayMissingOptions,
  displayWarlockVersionInTerminal,
  type HelpCommandInfo,
  isMatchingCommandName,
} from "./cli-commands.utils";
import { cliCommandsLoader } from "./commands-loader";
import { frameworkCommands } from "./framework-cli-commands";
import { CliOptionValueError, ParsedCliArgs, parseCliArgs } from "./parse-cli-args";
import { findSimilar } from "./string-similarity";
import { CommandActionData, ResolvedCLICommandOption } from "../commands/types";

/**
 * Best-effort budget (ms) for draining stdout/stderr before a forced exit.
 * Bounded so a stuck stream can never hang the CLI.
 */
const EXIT_FLUSH_BUDGET = 500;

/**
 * Exit with `code` once stdout/stderr have drained.
 *
 * `process.exit()` truncates writes still queued on a non-TTY stdout — a pipe,
 * a CI log — which is how the *reason* for a failure gets lost even when the
 * exit code is right. `exitCode` is set up front so that a natural exit (should
 * the drain outlive the process's remaining work) is non-zero too.
 */
function exitAfterFlush(code: number) {
  process.exitCode = code;

  const timer = setTimeout(() => process.exit(code), EXIT_FLUSH_BUDGET);
  timer.unref?.();

  let pending = 2;
  const drained = () => {
    if (--pending > 0) return;

    clearTimeout(timer);
    process.exit(code);
  };

  // A zero-length write's callback fires once everything queued ahead of it has
  // been handed to the OS.
  process.stdout.write("", drained);
  process.stderr.write("", drained);
}

/**
 * How a command run ended, from the process's point of view.
 *
 * - `succeeded` — finished, nothing rejected afterwards; the CLI may exit 0.
 * - `failed` — reported an error; the exit code is owned by whoever reported it.
 * - `running` — a persistent command (dev/start) now owns the process.
 *
 * `execute` returns this instead of exiting on success itself. A method that
 * terminates the process out from under its caller cannot be awaited honestly:
 * the exit it schedules outlives the call, so the success it represents is
 * still unsettled when `execute` resolves — which is exactly how a green check
 * ends up printed next to the failure that contradicts it.
 */
export type CommandRunVerdict = "succeeded" | "failed" | "running";

export class CLICommandsManager {
  /**
   * List of commands
   */
  public commands: CLICommand[] = [];

  /**
   * Commands map (name -> command)
   */
  public commandsMap: Map<string, CLICommand> = new Map();

  /**
   * Alias map (alias -> command name)
   */
  public aliasMap: Map<string, string> = new Map();

  /**
   * Register the given commands
   */
  public register(...commands: CLICommand[]): this {
    this.commands.push(...commands);

    commands.forEach((command) => {
      const commandKey = command.name.split(" ")[0];

      manifestManager.addCommandToList(command.name, {
        relativePath: command.commandRelativePath,
        source: command.commandSource || "project",
        description: command.commandDescription,
        alias: command.commandAlias,
        options: command.commandOptions.length > 0 ? command.commandOptions : undefined,
      });

      this.commandsMap.set(commandKey, command);

      // Register alias if exists
      if (command.commandAlias) {
        this.aliasMap.set(command.commandAlias, commandKey);
      }
    });

    return this;
  }

  /**
   * Get command by name or alias
   */
  public getCommand(name: string): CLICommand | undefined {
    // First try direct lookup
    let command = this.commandsMap.get(name);
    if (command) return command;

    // Try alias lookup
    const realName = this.aliasMap.get(name);
    if (realName) {
      return this.commandsMap.get(realName);
    }

    return;
  }

  /**
   * Get all command names and aliases
   * Used for fuzzy matching suggestions
   */
  public getAllCommandNames(): string[] {
    const names: string[] = [];

    // Add all command names
    for (const name of this.commandsMap.keys()) {
      names.push(name);
    }

    // Add all aliases
    for (const alias of this.aliasMap.keys()) {
      names.push(alias);
    }

    // Also include cached commands from manifest
    const manifestCommands = manifestManager.commandsJson?.commands || {};
    for (const name of Object.keys(manifestCommands)) {
      const baseName = name.split(" ")[0];
      if (!names.includes(baseName)) {
        names.push(baseName);
      }
      const alias = manifestCommands[name].alias;
      if (alias && !names.includes(alias)) {
        names.push(alias);
      }
    }

    return names;
  }

  /**
   * Start the cli manager
   */
  public async start() {
    // Schema-less first pass: it exists to discover the command name and the
    // command-independent flags (--help, --version, --no-cache). Values here are
    // raw strings; the typed pass below is the one whose options reach a command.
    const { name, options } = parseCliArgs(process.argv);

    if (options.noCache) {
      manifestManager.clearCommandsCache();
      // remove the commands.json file as wel
      await manifestManager.removeCommandsFile();
    }

    if (options.version || options.v) {
      await displayWarlockVersionInTerminal();
      process.exit(0);
    }

    // Try to load from manifest first (fastest path)
    await manifestManager.loadCommands();

    // Register framework commands first (needed for help)
    this.register(
      ...frameworkCommands.map((command) => {
        if (!command.commandSource) {
          command.commandSource = "framework";
        }
        return command;
      }),
    );

    const isHelpCommand = options.help || options.h;

    // Handle global help (no command)
    if (!name && isHelpCommand) {
      await this.showGlobalHelp();
      process.exit(0);
    }

    // Handle warm cache
    if (options.warmCache) {
      await this.warmCache();
      process.exit(0);
    }

    if (!name) {
      displayMissingCommand();
      process.exit(1);
    }

    const command = await this.lazyGetCommand(name);

    if (manifestManager.hasChanges) {
      await manifestManager.saveCommands();
    }

    if (!command) {
      // Find similar commands for suggestions
      const allCommandNames = this.getAllCommandNames();
      const suggestions = findSimilar(name, allCommandNames).map((s) => s.value);

      displayCommandNotFound(name, suggestions);
      process.exit(1);
    }

    // Handle command-specific help
    if (isHelpCommand) {
      displayCommandHelp({
        name: command.name,
        alias: command.commandAlias,
        description: command.commandDescription,
        options: command.commandOptions,
      });
      process.exit(0);
    }

    // The first parse above had no command to consult, so every value in it is
    // a raw string. Now that the command is resolved, re-read argv against its
    // declared options so a `type: "boolean"` option arrives as a boolean.
    const resolved = this.resolveCommandArgs(command);

    const verdict = await this.execute(command, {
      options: resolved.options,
      args: resolved.args,
    });

    // The process-level exit belongs to the entrypoint, not to `execute`.
    // A one-shot command can leave a handle open (a db connection, a watcher a
    // plugin forgot to close), so the CLI exits explicitly rather than waiting
    // for the loop to drain — but only on a verdict of `succeeded`. `failed`
    // already exited non-zero through whoever reported it, and `running` means
    // a persistent command owns the process now.
    if (verdict === "succeeded") {
      exitAfterFlush(0);
    }
  }

  /**
   * Re-parse argv against the resolved command's declared options.
   *
   * parseCliArgs runs twice on purpose. The first run produces the command
   * name, and there is no schema to consult yet; the second one, here, can be
   * type-aware. Re-reading argv (rather than post-processing the first result)
   * is what makes `--rollback users.ts` recoverable: by the time the first pass
   * returns, the swallowed positional is indistinguishable from a value.
   */
  protected resolveCommandArgs(command: CLICommand, argv: string[] = process.argv): ParsedCliArgs {
    try {
      return parseCliArgs(argv, command.commandOptions);
    } catch (error) {
      if (error instanceof CliOptionValueError) {
        console.log();
        console.log(`  ${colors.redBright("Error:")} ${error.message}`);
        console.log();
        process.exit(1);
      }

      throw error;
    }
  }

  /**
   * Show global help with all commands
   * Uses manifest if available for fast display
   */
  protected async showGlobalHelp() {
    if (
      manifestManager.isCommandLoaded &&
      Object.keys(manifestManager.commandsJson?.commands || {}).length > 0
    ) {
      // Use manifest directly - no need to load command files
      const helpCommands: HelpCommandInfo[] = Object.entries(
        manifestManager.commandsJson?.commands || {},
      ).map(([name, cmd]) => ({
        name,
        alias: cmd.alias,
        description: cmd.description,
        source: cmd.source,
      }));

      await displayHelp(helpCommands);
      return;
    }

    // Fallback: No manifest, build from registered commands
    // This happens on first run before warm-cache
    await this.loadPluginsCommands();

    const projectCommands = await cliCommandsLoader.scanAll();

    this.register(...projectCommands);

    await manifestManager.saveCommands();

    // Build help info from registered commands
    const helpCommands: HelpCommandInfo[] = this.commands.map((cmd) => ({
      name: cmd.name,
      alias: cmd.commandAlias,
      description: cmd.commandDescription,
      source: cmd.commandSource || "project",
    }));

    await displayHelp(helpCommands);
  }

  /**
   * Warm cache - scan all project commands and save to manifest
   */
  protected async warmCache() {
    console.log();
    console.log(`  ${colors.cyan("â€º")} Scanning project commands...`);

    const projectCommands = await cliCommandsLoader.scanAll();

    this.register(...projectCommands);

    await manifestManager.saveCommands();

    console.log(
      `  ${colors.green("âœ”")} Cached ${colors.bold(String(projectCommands.length))} project commands`,
    );
    console.log();
  }

  /**
   * Load plugins commands
   */
  protected async loadPluginsCommands() {
    await warlockConfigManager.load();

    if (warlockConfigManager.isLoaded) {
      this.register(
        ...(warlockConfigManager.get("cli")?.commands || []).map((command) => {
          if (!command.commandSource) {
            command.commandSource = "plugin";
          }
          return command;
        }),
      );
    }
  }

  /**
   * Try to find the command based on the given command name or alias
   */
  protected async lazyGetCommand(name: string) {
    // first step, try to find it directly through current commands
    let command = this.getCommand(name);
    if (command) {
      return command;
    }

    // second step, try to find it through warlock config commands
    await this.loadPluginsCommands();

    command = this.getCommand(name);

    if (command) {
      return command;
    }

    // third step, try to find it through project commands
    await this.loadProjectCommands(name);

    command = this.getCommand(name);
    if (command) {
      return command;
    }

    return null;
  }

  /**
   * Load project commands
   */
  protected async loadProjectCommands(name: string) {
    // first get the commands.json contents as an object
    const jsonCommandsFile = await manifestManager.loadCommands();

    if (jsonCommandsFile) {
      // Check by name or alias
      for (const fullCommandName in jsonCommandsFile.commands) {
        const cmdMeta = jsonCommandsFile.commands[fullCommandName];

        // Match by name or alias
        if (isMatchingCommandName(fullCommandName, name) || cmdMeta.alias === name) {
          const commandPath = cmdMeta.relativePath;
          if (commandPath) {
            const executedCommand = await cliCommandsLoader.load(commandPath);

            if (executedCommand) {
              executedCommand.$relativePath(commandPath);
              this.register(executedCommand);
              return;
            }
          }
        }
      }
    }

    const command = await cliCommandsLoader.locate(name);

    if (command) {
      this.register(command);
      return;
    }
  }

  /**
   * Validate required options
   */
  protected validateOptions(
    command: CLICommand,
    options: Record<string, string | boolean | number>,
  ): ResolvedCLICommandOption[] {
    const missing: ResolvedCLICommandOption[] = [];

    command.commandOptions.forEach((opt) => {
      if (opt.required) {
        // Check if option is provided by name or alias
        const hasOption =
          options[opt.name] !== undefined || (opt.alias && options[opt.alias] !== undefined);
        if (!hasOption) {
          missing.push(opt);
        }
      }
    });

    return missing;
  }

  /**
   * Apply default values to options
   */
  protected applyDefaultOptions(
    command: CLICommand,
    options: Record<string, string | boolean | number>,
  ): Record<string, string | boolean | number> {
    const result = { ...options };

    command.commandOptions.forEach((opt) => {
      if (opt.defaultValue !== undefined) {
        const hasOption =
          result[opt.name] !== undefined || (opt.alias && result[opt.alias] !== undefined);
        if (!hasOption) {
          result[opt.name] = opt.defaultValue;
        }
      }

      // `!== undefined`, not truthiness: `-r=false` now resolves to the boolean
      // `false`, and a truthiness test would drop it before it ever reached the
      // canonical name — leaving `rollback` undefined instead of explicitly off.
      if (
        opt.alias !== undefined &&
        result[opt.alias] !== undefined &&
        result[opt.name] === undefined
      ) {
        result[opt.name] = result[opt.alias];
      }
    });

    return result;
  }

  /**
   * Execute the given command and report how it ended.
   *
   * Returning the verdict — rather than exiting on success from in here — is
   * what makes the awaited result trustworthy: see {@link CommandRunVerdict}.
   */
  public async execute(command: CLICommand, data: CommandActionData): Promise<CommandRunVerdict> {
    const startTime = Date.now();

    // Validate required options
    const missingOptions = this.validateOptions(command, data.options);
    if (missingOptions.length > 0) {
      displayMissingOptions(missingOptions);
      process.exit(1);
    }

    // Apply default values
    data.options = this.applyDefaultOptions(command, data.options);

    displayExecutingCommand(command.name);

    if (command.commandPreAction) {
      await command.commandPreAction(data);
    }

    // load preloaders
    if (command.commandPreload) {
      try {
        await this.loadPreloaders(command);
      } catch (error) {
        // A preload failure (a bad import in a config file, a connector that
        // throws on boot, a missing module export) happens BEFORE the command's
        // action runs — there is no run loop to recover into, so it is ALWAYS
        // fatal, persistent command (dev/start) or not. Surface the real cause
        // and the offending file, then exit. This MUST stay outside the
        // command-execute try/catch below: letting a preload rejection escape
        // turned `warlock dev` into a silent hang — the unhandled rejection slid
        // past while the already-started loader worker thread kept the process
        // alive, freezing just after the banner with no error printed.
        displayBootError(command.name, error as Error);
        process.exit(1);
      }
    }

    this.captureFatalAsyncErrors(command);

    try {
      await command.execute(data);

      // Persistent commands (dev/start) hand control to their run loop here.
      // There is no success banner to print and nothing to exit for.
      if (command.isPersistent) return "running";

      // Yield one full event-loop turn before declaring success, and AWAIT that
      // yield. Node flags an unhandled rejection only after the current turn's
      // microtasks drain, so reporting success synchronously here fired FIRST
      // and erased the failure — a `build` whose async work rejected exited 0
      // having emitted nothing.
      //
      // The await is the load-bearing part, not the yield. Scheduling this as a
      // bare `setImmediate` let `execute()` RESOLVE while the verdict was still
      // pending: the callback outlived the call it belonged to, so the green
      // check could surface after the caller had already moved on — in a later
      // command, or after a rejection reported in the interim, which the guard
      // below cannot see because by then it reads the state of a run that has
      // already ended. Awaiting binds the banner to THIS invocation: `execute`
      // does not resolve until the verdict it is about to report has settled.
      //
      // `setImmediate` runs in the same loop iteration's check phase, so this
      // cannot hang on a lingering handle the way dropping the exit would; it
      // only lets `captureFatalAsyncErrors` win the race when there is one.
      await new Promise<void>((resolve) => setImmediate(resolve));

      // The yield is what gives a floating rejection the chance to be reported;
      // this is what acts on it. A green check printed after that error would
      // contradict it, and the exit that follows would reset `process.exitCode`
      // to 0 — re-erasing the very failure this whole path exists to surface.
      if (this.fatalAsyncErrorReported) return "failed";

      displayCommandSuccess(command.name, Date.now() - startTime);

      return "succeeded";
    } catch (error) {
      displayCommandError(command.name, error as Error);
      // Persistent commands (dev/start) own their startup-failure exits;
      // by the time an error reaches here they've already entered their
      // run loop, so it's a runtime error we log but don't crash on â€”
      // HMR or process supervisors can recover. Non-persistent
      // one-shot commands always exit on failure.
      if (!command.isPersistent) {
        process.exit(1);
      }

      return "failed";
    }
  }

  /**
   * Fail loudly on async errors that escape the command's own promise.
   *
   * `execute` awaits `command.execute(data)`, but work the command merely
   * *started* settles outside that await — `@mongez/events` `trigger` /
   * `triggerAll` are synchronous and do not await their listeners, so an async
   * listener that throws leaves a floating rejection behind. Node reports it at
   * the end of the turn, by which point the CLI had already exited 0: the
   * failure was erased and the command looked green.
   *
   * Persistent commands (dev/start) are exempt from the exit for the same
   * reason as the catch block in `execute`: by the time they reach this point
   * they own a run loop that is expected to survive runtime errors so HMR or a
   * supervisor can recover. They still print — silence is what made this class
   * of failure invisible in the first place.
   */
  protected fatalAsyncErrorReported = false;

  protected captureFatalAsyncErrors(command: CLICommand) {
    const onFatalAsyncError = (reason: unknown) => {
      // A rejection reason is not necessarily an Error (`Promise.reject("x")`),
      // and a crash handler must never itself throw.
      const error = reason instanceof Error ? reason : new Error(String(reason));

      // Set before printing, so the deferred success banner is suppressed even
      // if displaying the error yields.
      this.fatalAsyncErrorReported = true;

      displayCommandError(command.name, error);

      if (!command.isPersistent) {
        exitAfterFlush(1);
      }
    };

    process.on("unhandledRejection", onFatalAsyncError);
    process.on("uncaughtException", onFatalAsyncError);
  }

  /**
   * Load preloaders
   */
  protected async loadPreloaders(command: CLICommand) {
    const preloaders = command.commandPreload || {};

    if (preloaders.runtimeStrategy) {
      Application.setRuntimeStrategy(preloaders.runtimeStrategy);
    }

    // Override, not a default: a command that declares an environment gets it
    // regardless of what the shell exported. Then read it back — `process.env`
    // is process-global and anything may have written to it, so a value that
    // did not take must fail here, loudly, rather than surface later as a
    // production React bundle under `warlock dev`.
    if (preloaders.environment) {
      Application.setEnvironment(preloaders.environment);

      if (process.env.NODE_ENV !== preloaders.environment) {
        throw new Error(
          `Command "${command.name}" set NODE_ENV to "${preloaders.environment}", but it read back as ` +
            `"${process.env.NODE_ENV}". The environment did not take, and every decision made ` +
            `downstream of it — env file selection, bundler dep optimisation — would be wrong.`,
        );
      }
    }

    // Env BEFORE config, unconditionally, for every command.
    //
    // `warlock.config.ts` is a module whose body runs on import, and projects
    // legitimately call `env("BUILD_OUT", "dist")` in it. Loading config first
    // evaluated that body against an empty env store, so every such call
    // silently returned its default — under `build` and `start`, which never
    // loaded env at all, and under `dev` too, because config was loaded first
    // regardless. The ordering is load-bearing in the other direction as well:
    // `loadEnv()` reads `process.env.NODE_ENV` at call time to choose
    // `.env.<NODE_ENV>` over `.env`, so it must follow `setEnvironment` above.
    await loadEnvironmentFiles();

    await warlockConfigManager.load();

    if (preloaders.config || preloaders.bootstrap || preloaders.prestart) {
      await filesOrchestrator.init();
    }

    // `preloaders.env` is gone: env is loaded above for every command, so the
    // branch that used to serve it could only re-parse the same files and
    // re-override `process.env` a second time.
    if (preloaders.bootstrap) {
      await bootstrap();

      if (await fileExistsAsync(appPath("bootstrap.ts"))) {
        await filesOrchestrator.load("src/app/bootstrap.ts");
      }
    }

    // Load configuration files
    if (preloaders.config) {
      await loadConfigFiles(preloaders.config);
    }

    if (preloaders.prestart) {
      if (await fileExistsAsync(appPath("prestart.ts"))) {
        await filesOrchestrator.load("src/app/prestart.ts");
      }
    }

    // Initialize connectors.
    // `connectors: true` only starts the early phase here â€” late-phase
    // connectors (http, socket) start after the command's action loads
    // app code. Explicit lists bypass phase splitting (caller knows
    // exactly which connectors they want).
    if (preloaders.connectors) {
      // REGISTER before starting — the non-bundled counterpart of section 2.5
      // of the generated production entry, and the "dev preloader" path
      // `register-configured-connectors.ts` documents.
      //
      // Without this, `warlock.config.ts > connectors` drove the BUILD only:
      // `warlock build` read the array to drain each connector's contribution,
      // but under `warlock dev` nothing ever registered it, so an app had to
      // call `connectorsManager.register(...)` from its own `main.ts` to get a
      // connector running. Apps that did BOTH then registered the same
      // connector twice in production — once here from the baked config, once
      // from their own app code — and it booted twice, which surfaced as
      // `Route name "..." is already taken` while installing page routes.
      //
      // The array is omitted deliberately, so the function reads the config
      // loaded above; `expectedNames` is omitted too, because drift is a
      // build↔runtime relationship and dev has no build to drift from.
      //
      // The idempotency this function provides is against ITSELF — a second
      // call skips names the first registered. It does NOT protect against an
      // app calling `connectorsManager.register()` directly, which pushes
      // unconditionally, and which runs AFTER this point in both modes. So a
      // connector belongs in the config array or in app code, never both:
      // listing it in both is the duplicate this comment's route-name error
      // describes.
      registerConfiguredConnectors();

      if (preloaders.connectors === true) {
        await connectorsManager.startPhase(ConnectorLifecyclePhase.Early);
      } else {
        await connectorsManager.start(preloaders.connectors);
      }
    }
  }
}
