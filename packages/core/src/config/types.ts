import type { CommandBuilder } from "../console/command-builder";
import type { CommandOptions } from "../console/types";

export type WarlockConfigServe = {
  //
};

export type WarlockConfigBuild = {
  /**
   * The path to the output directory.
   *
   * @default "dist"
   */
  outDirectory?: string;
  /**
   * Output file name for the application entry point.
   *
   * @default "main.js"
   */
  outFile?: string;
  /**
   * Whether to bundle the dependencies or not.
   *
   * @default false
   */
  bundle?: boolean;
};

export type WarlockConfig = {
  /**
   * Development server options
   */
  server?: WarlockConfigServe;
  /**
   * Build Options
   */
  build?: WarlockConfigBuild;
  /**
   * Cli options
   */
  cli?: {
    commands?: (CommandBuilder | CommandOptions)[];
  };
};

export type ResolvedWarlockConfig = {
  /**
   * Development server options
   */
  server: Required<WarlockConfigServe>;
  /**
   * Build Options
   */
  build: Required<WarlockConfigBuild>;
  /**
   * Cli options
   */
  cli: {
    commands: (CommandBuilder | CommandOptions)[];
  };
};
