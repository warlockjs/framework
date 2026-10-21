import { ProductionBuilder } from "../../production/production-builder";
import type { CommandActionData } from "../../commands/types";
import { withConsoleOnStderr } from "./routes/with-console-on-stderr";
import { command } from "../../commands/cli-command";
import { unverifiedBuildRuntimeNotice } from "../../utils/runtime";

export const buildCommand = command({
  name: "build",
  description: "Build the project for production",
  action: buildCommandAction,
  options: [
    { text: "--json", description: "Print the build budget report as JSON", type: "boolean" },
  ],
  preload: {
    warlockConfig: true,
  },
  preAction: () => {
    // Bun and Deno can usually run the build, but only the Node build is
    // verified; say so on stderr without failing the command.
    const notice = unverifiedBuildRuntimeNotice();

    if (notice !== undefined) {
      console.error(notice);
    }
  },
});

export async function buildCommandAction({ options }: CommandActionData): Promise<void> {
  const builder = new ProductionBuilder();
  if (!options.json) {
    await builder.build();
    return;
  }
  try {
    await withConsoleOnStderr(() => builder.build());
    console.log(JSON.stringify({ success: true, budgets: builder.budgetReport }));
  } catch (error) {
    console.log(
      JSON.stringify({
        success: false,
        budgets: builder.budgetReport,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}
