import { colors } from "@mongez/copper";
import { fileExistsAsync } from "@mongez/fs";
import path from "path";
import { executeTsFile } from "../esbuild";
import type { ResolvedWarlockConfig } from "./types";

let configurations: ResolvedWarlockConfig | null = null;

export async function getWarlockConfig(): Promise<ResolvedWarlockConfig> {
  if (configurations) return configurations;

  const configPath = path.resolve(process.cwd(), "warlock.config.ts");

  if (!(await fileExistsAsync(configPath))) {
    console.log(
      `Warlock: No configuration file found at ${colors.yellow(configPath)}`,
    );
    return {} as ResolvedWarlockConfig;
  }

  configurations = (await executeTsFile(configPath)).default;

  return configurations!;
}
