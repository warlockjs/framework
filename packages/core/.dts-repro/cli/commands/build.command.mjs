import { command } from "../cli-command.mjs";
import { buildAppProduction } from "../../production/build-app-production.mjs";
//#region ../../@warlock.js/core/src/cli/commands/build.command.ts
const buildCommand = command({
	name: "build",
	description: "Build the project for production",
	action: buildAppProduction,
	preload: { warlockConfig: true }
});
//#endregion
export { buildCommand };

//# sourceMappingURL=build.command.mjs.map