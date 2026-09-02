import { colors } from "@mongez/copper";
import { Environment } from "../utils";
import { getWarlockVersion } from "../utils/framework-vesion";

export function isMatchingCommandName(commandName: string, targetingCommandName: string) {
  return commandName.split(" ")[0] === targetingCommandName;
}

/**
 * Display the Warlock.js version banner
 */
export async function displayWarlockVersionInTerminal() {
  const version = await getWarlockVersion();
  console.log(`⚡ ${colors.bold("Warlock.js")} ${colors.greenBright(`v${version}`)}`);
}

type StartBannerOptions = {
  environment: Environment;
};

function getTextColorMethod(environment: Environment) {
  switch (environment) {
    case "development":
      return colors.yellowBright;
    case "production":
      return colors.greenBright;
    case "test":
      return colors.blueBright;
    default:
      return colors.whiteBright;
  }
}

/**
 * Display CLI startup banner
 */
export async function displayStartupBanner({ environment }: StartBannerOptions) {
  const version = await getWarlockVersion();
  const textColorMethod = getTextColorMethod(environment);
  console.log(`  ⚡ ${colors.bold(textColorMethod("Warlock.js"))} ${colors.dim(`v${version}`)}`);
  console.log();
}

type ProductionReadyBannerOptions = {
  bootDurationMs?: number;
};

/**
 * Announce that the production server is up — printed on **stdout**, and only
 * after the child process reported a completed boot.
 *
 * Stdout is the channel a supervisor or CI gate greps to decide the service is
 * healthy, so nothing optimistic may be written to it: this function is the
 * single place allowed to say "started", and it is called from exactly one
 * place, the `warlock:ready` handler in the `start` command.
 */
export async function displayProductionReadyBanner({
  bootDurationMs,
}: ProductionReadyBannerOptions = {}) {
  const version = await getWarlockVersion();
  const duration = bootDurationMs ? colors.dim(` in ${bootDurationMs}ms`) : "";

  console.log(
    `  ⚡ ${colors.bold(colors.greenBright("Warlock.js"))} ${colors.dim(`v${version}`)} ${colors.green("✔")} production server started${duration}`,
  );
  console.log();
}

/**
 * Report that the production server died before it ever served anything.
 *
 * Written to **stderr** only. `warlock start` inherits both child streams, and
 * production launchers commonly merge them (`2>&1`), so mirroring this block to
 * stdout prints every line twice. The command's non-zero exit code is the
 * machine-readable failure signal; stdout remains reserved for the ready
 * banner.
 *
 * `causeWasCaptured` gates the "the cause is printed above" line. The
 * supervisor cannot always guarantee the child wrote anything before it
 * died — an import that throws before the logger configures its channels,
 * a bundle with no console channel at all — and claiming a cause is above
 * when nothing was ever captured sends the developer looking for output
 * that doesn't exist, which is worse than admitting the gap.
 */
export function displayProductionStartFailure(
  exitCode: number,
  causeWasCaptured: boolean,
) {
  const causeLine = causeWasCaptured
    ? `  ${colors.dim("the cause is printed above, in the application's own output")}`
    : `  ${colors.dim("no output was captured from the application process — its cause did not reach this terminal")}`;

  const lines = [
    "",
    `  ${colors.red("✖")} ${colors.bold("warlock start")} failed — the server never finished booting`,
    `  ${colors.dim(`the application process exited with code ${exitCode}`)}`,
    causeLine,
    "",
  ];

  for (const line of lines) {
    console.error(line);
  }
}

/**
 * Note that a running child has not reported readiness yet.
 *
 * Emitted on **stderr** only. The process may be perfectly healthy — an older
 * bundle has no readiness signal at all — so saying anything on stdout would be
 * the very false-green this channel exists to prevent.
 *
 * The wording offers the likely causes rather than asserting one. It cannot
 * distinguish an old bundle from a slow boot from a boot that is about to fail,
 * and an earlier version claimed "the bundle predates readiness reporting" —
 * which was simply wrong when a current bundle was mid-crash, and sent the
 * reader after the wrong thing.
 */
export function displayMissingReadinessNotice(waitedMs: number) {
  console.error();
  console.error(
    `  ${colors.yellow("!")} still running after ${Math.round(waitedMs / 1000)}s with no readiness signal`,
  );
  console.error(`  ${colors.dim("either the boot is still in progress, or this bundle was built")}`);
  console.error(
    `  ${colors.dim("before readiness reporting — re-run")} ${colors.cyan("warlock build")} ${colors.dim("if the banner never appears")}`,
  );
  console.error();
}

/**
 * Display command execution header
 */
export function displayExecutingCommand(commandName: string) {
  console.log(`  ${colors.cyan("›")} Running ${colors.bold(colors.white(commandName))}...`);
  console.log();
}

/**
 * Display command not found error with optional suggestions
 */
export function displayCommandNotFound(commandName: string, suggestions?: string[]) {
  console.log();
  console.log(`  ${colors.red("✖")} Command ${colors.magenta(commandName)} not found`);

  if (suggestions && suggestions.length > 0) {
    console.log();
    console.log(`  ${colors.yellow("Did you mean?")}`);
    suggestions.forEach((suggestion) => {
      console.log(`    ${colors.cyan("→")} ${colors.white(suggestion)}`);
    });
  }

  console.log();
  console.log(
    `  ${colors.dim("Run")} ${colors.cyan("warlock --help")} ${colors.dim("to see available commands")}`,
  );
  console.log();
}

/**
 * Display missing command error
 */
export function displayMissingCommand() {
  console.log();
  console.log(`  ${colors.red("✖")} No command specified`);
  console.log(
    `  ${colors.dim("Run")} ${colors.cyan("warlock --help")} ${colors.dim("to see available commands")}`,
  );
  console.log();
}

/**
 * Display command success message
 */
export function displayCommandSuccess(commandName: string, durationMs?: number) {
  const duration = durationMs ? colors.dim(` (${durationMs}ms)`) : "";
  console.log();
  console.log(
    `  ${colors.green("✔")} ${colors.bold(commandName)} completed successfully${duration}`,
  );
  console.log();
}

/**
 * Display command error message
 */
export function displayCommandError(commandName: string, error: Error) {
  console.log();
  console.log(`  ${colors.red("✖")} ${colors.bold(commandName)} failed`);
  console.log(`  ${colors.dim(error.message)}`);
  console.log();
}

/**
 * Display a FATAL boot/preload failure and exit information.
 *
 * Preload failures — a bad import in a config file, a connector that throws
 * on startup, a missing module export — happen BEFORE the command's run loop
 * exists, so there is nothing to recover into: they are always fatal. Unlike
 * `displayCommandError`, this prints the full stack (not just `error.message`)
 * because the stack names the exact file + line of the offending import, which
 * is the single most useful clue when a config file pulls in a broken module.
 *
 * Surfacing this loudly is the difference between a clear error and a silent
 * hang: an unhandled preload rejection used to escape while the already-started
 * loader worker thread kept the process alive, leaving `warlock dev` frozen
 * just after the banner with no message at all.
 *
 * @example
 * // SyntaxError: The requested module '@warlock.js/cascade' does not
 * //   provide an export named 'belongsTo'
 * //   at src/app/.../permission.model.ts:2
 */
export function displayBootError(commandName: string, error: Error) {
  console.log();
  console.log(`  ${colors.red("✖")} ${colors.bold(commandName)} failed to start`);
  console.log(`  ${colors.red(error.message)}`);
  if (error.stack) {
    console.log();
    console.log(colors.dim(error.stack));
  }
  console.log();
}

/**
 * Display missing required options error
 */
export function displayMissingOptions(options: { name: string; text: string }[]) {
  console.log();
  console.log(`  ${colors.red("✖")} Missing required options:`);
  options.forEach((opt) => {
    console.log(`     ${colors.yellow(opt.text)} ${colors.dim(`(--${opt.name})`)}`);
  });
  console.log();
}

/**
 * Command info for help display
 */
export type HelpCommandInfo = {
  name: string;
  alias?: string;
  description?: string;
  source: "framework" | "plugin" | "project";
};

/**
 * Display global help with all commands grouped by source
 */
export async function displayHelp(commands: HelpCommandInfo[]) {
  const version = await getWarlockVersion();

  console.log();
  console.log(
    `  ⚡ ${colors.bold(colors.yellowBright("Warlock.js"))} CLI ${colors.dim(`v${version}`)}`,
  );
  console.log();
  console.log(
    `  ${colors.bold("Usage:")} ${colors.cyan("warlock")} ${colors.dim("<command>")} ${colors.dim("[options]")}`,
  );
  console.log();

  // Group by source
  const grouped: Record<string, HelpCommandInfo[]> = {
    framework: [],
    plugin: [],
    project: [],
  };

  commands.forEach((cmd) => {
    grouped[cmd.source]?.push(cmd);
  });

  // Display each group
  const groupLabels: Record<string, string> = {
    framework: "Framework Commands",
    plugin: "Plugin Commands",
    project: "Project Commands",
  };

  for (const [source, cmds] of Object.entries(grouped)) {
    if (cmds.length === 0) continue;

    console.log(`  ${colors.bold(colors.white(groupLabels[source]))}`);
    console.log();

    // Find max name length for alignment
    const maxLen = Math.max(...cmds.map((c) => c.name.length + (c.alias ? c.alias.length + 4 : 0)));

    cmds.forEach((cmd) => {
      const aliasStr = cmd.alias ? colors.dim(` (${cmd.alias})`) : "";
      const nameWithAlias = cmd.name + (cmd.alias ? ` (${cmd.alias})` : "");
      const padding = " ".repeat(maxLen - nameWithAlias.length + 2);
      // const desc = cmd.description || colors.dim("No description");
      const desc = cmd.description || "";
      console.log(`    ${colors.cyan(cmd.name)}${aliasStr}${padding}${desc}`);
    });
    console.log();
  }

  // Display global flags
  console.log(`  ${colors.bold(colors.white("Global Flags"))}`);
  console.log();

  const globalFlags = [
    { flag: "--help, -h", description: "Show help for a command" },
    { flag: "--version, -v", description: "Show Warlock version" },
    { flag: "--no-cache", description: "Force reload without cache" },
    { flag: "--warm-cache", description: "Pre-cache all project commands" },
  ];

  const maxFlagLen = Math.max(...globalFlags.map((f) => f.flag.length));

  globalFlags.forEach(({ flag, description }) => {
    const padding = " ".repeat(maxFlagLen - flag.length + 2);
    console.log(`    ${colors.yellow(flag)}${padding}${description}`);
  });
  console.log();

  console.log(
    `  ${colors.dim("Run")} ${colors.cyan("warlock <command> --help")} ${colors.dim("for command-specific help")}`,
  );
  console.log();
}

/**
 * Display help for a specific command
 */
export function displayCommandHelp(command: {
  name: string;
  alias?: string;
  description?: string;
  options?: { name: string; text: string; description?: string; required?: boolean }[];
}) {
  console.log();
  console.log(
    `  ${colors.bold(colors.cyan(command.name))}${command.alias ? colors.dim(` (${command.alias})`) : ""}`,
  );

  if (command.description) {
    console.log(`  ${command.description}`);
  }
  console.log();

  if (command.options && command.options.length > 0) {
    console.log(`  ${colors.bold("Options:")}`);
    console.log();

    const maxLen = Math.max(...command.options.map((o) => o.text.length));

    command.options.forEach((opt) => {
      const padding = " ".repeat(maxLen - opt.text.length + 2);
      const required = opt.required ? colors.red(" (required)") : "";
      const desc = opt.description || "";
      console.log(`    ${colors.green(opt.text)}${padding}${desc}${required}`);
    });
    console.log();
  } else {
    console.log(`  ${colors.dim("No options available")}`);
    console.log();
  }
}
