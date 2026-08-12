import { buildAppProduction } from "../../production/build-app-production";
import { command } from "../../commands/cli-command";

export const buildCommand = command({
  name: "build",
  description: "Build the project for production",
  action: buildAppProduction,
  preload: {
    warlockConfig: true,
  },
});
