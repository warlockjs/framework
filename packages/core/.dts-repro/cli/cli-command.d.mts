import { CLICommandAction, CLICommandOption, CLICommandOptions, CLICommandPreload, CLICommandSource, CommandActionData, ResolvedCLICommandOption } from "./types.mjs";

//#region ../../@warlock.js/core/src/cli/cli-command.d.ts
declare class CLICommand {
  name: string;
  /**
   * Command source
   */
  commandSource?: CLICommandSource;
  /**
   * Command action
   */
  commandAction?: CLICommandAction;
  /**
   * Command pre action
   * This will be executed before loading preloaders
   */
  commandPreAction?: CLICommandAction;
  /**
   *    Command preload
   */
  commandPreload?: CLICommandPreload;
  /**
   * Command description
   */
  commandDescription?: string;
  /**
   * Command options
   */
  commandOptions: ResolvedCLICommandOption[];
  /**
   * Command relative path
   * Available only for project commands
   * Auto injected by the framework itself
   */
  commandRelativePath?: string;
  /**
   * Determine if the command is persistent
   */
  isPersistent: boolean;
  /**
   * Command alias (short name)
   */
  commandAlias?: string;
  /**
   * Constructor
   */
  constructor(name: string, description?: string);
  /**
   * Add command source
   */
  source(source: CLICommandSource): this;
  /**
   * Set command description
   */
  description(description: string): this;
  /**
   * Determine if the command is persistent
   */
  persistent(isPersistent?: boolean): this;
  /**
   * Set command alias (short name)
   * @example .alias("m") for "migrate"
   */
  alias(alias: string): this;
  /**
   * Command action
   */
  action(action: CLICommandAction): this;
  /**
   * Command pre action
   * This will be executed before loading preloaders
   */
  preAction(action: CLICommandAction): this;
  /**
   * Add command options
   */
  options(options: CLICommandOption[]): this;
  /**
   * Add command relative path
   */
  $relativePath(relativePath: string): this;
  /**
   * Add command option
   */
  option(option: CLICommandOption): this;
  option(name: string, description?: string, options?: Omit<CLICommandOption, "name">): this;
  /**
   * Parse option name and alias if exists
   *
   * Supports formats:
   * - "--port, -p" → name: "port", alias: "p"
   * - "-p, --port" → name: "port", alias: "p"
   * - "--port" → name: "port", alias: undefined
   * - "-p" → name: "p", alias: undefined
   */
  protected parseOption(option: CLICommandOption): ResolvedCLICommandOption;
  /**
   * Extract option name from text (removes -- or -)
   *
   * @example
   * extractOptionName("--port") → "port"
   * extractOptionName("-p") → "p"
   * extractOptionName("--port=3000") → "port"
   */
  private extractOptionName;
  /**
   * Command preload
   */
  preload(options: CLICommandPreload): this;
  /**
   * Execute the command
   */
  execute(data: CommandActionData): Promise<void>;
}
declare function command(options: CLICommandOptions): CLICommand;
//#endregion
export { CLICommand, command };
//# sourceMappingURL=cli-command.d.mts.map