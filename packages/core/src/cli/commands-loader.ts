import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { Path } from "../utils/normalized-path";
import { getFilesFromDirectory } from "../dev-server/utils";
import { srcPath } from "../utils";
import { CLICommand } from "../commands/cli-command";
import { isTestFile } from "../utils/is-test-file";
import { isMatchingCommandName } from "./cli-commands.utils";

const COMMANDS_PATTERN = "**/commands/*.{ts,tsx}";

/**
 * Absolute paths of every app command file. Spec and test files that sit next
 * to a command are skipped: importing one outside a test runner crashes the CLI.
 */
async function commandFiles(): Promise<string[]> {
  const files = await getFilesFromDirectory(srcPath("app"), COMMANDS_PATTERN);

  return files.filter((file) => !isTestFile(file));
}

export class CLICommandsLoader {
  /**
   * Locate command by name
   */
  public async locate(commandName: string): Promise<CLICommand | undefined> {
    const files = await commandFiles();
    // now convert them into relative paths
    const relativeFiles = files.map((path) => Path.toRelative(path));

    for (const relativeFile of relativeFiles) {
      const command = await this.load(relativeFile);
      if (command) {
        command.$relativePath(relativeFile);
        if (isMatchingCommandName(command.name, commandName)) {
          return command;
        }
      }
    }

    return;
  }

  /**
   * Scan all project commands and return them
   * Used for warm cache functionality
   */
  public async scanAll(): Promise<CLICommand[]> {
    const files = await commandFiles();
    const relativeFiles = files.map((path) => Path.toRelative(path));
    const commands: CLICommand[] = [];

    for (const relativeFile of relativeFiles) {
      const command = await this.load(relativeFile);
      if (command) {
        command.$relativePath(relativeFile);
        commands.push(command);
      }
    }

    return commands;
  }

  /**
   * Load command from a relative path
   */
  public async load(relativePath: string): Promise<CLICommand | undefined> {
    const output = await filesOrchestrator.load<{ default: CLICommand }>(relativePath);

    return output?.default;
  }
}

export const cliCommandsLoader = new CLICommandsLoader();
