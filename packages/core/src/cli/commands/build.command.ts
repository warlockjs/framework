import { buildAppProduction } from "../../production/build-app-production";
import { command } from "../../commands/cli-command";
import { unverifiedBuildRuntimeNotice } from "../../utils/runtime";

export const buildCommand = command({
  name: "build",
  description: "Build the project for production",
  action: buildAppProduction,
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
