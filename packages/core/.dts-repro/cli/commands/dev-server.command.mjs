import { command } from "../cli-command.mjs";
import { displayStartupBanner } from "../cli-commands.utils.mjs";
import { startDevelopmentServer } from "../../dev-server/start-development-server.mjs";
//#region ../../@warlock.js/core/src/cli/commands/dev-server.command.ts
const devServerCommand = command({
	name: "dev",
	description: "Start development server (HMR, type-gen, health checks)",
	persistent: true,
	preload: {
		runtimeStrategy: "development",
		config: true,
		bootstrap: true,
		prestart: true,
		connectors: true
	},
	preAction: async () => {
		await displayStartupBanner({ environment: "development" });
	},
	action: async (data) => {
		await startDevelopmentServer({
			fresh: Boolean(data.options.fresh),
			generateTypings: data.options["skip-typings"] ? false : void 0,
			healthCheckers: data.options["skip-health"] ? false : void 0
		});
	},
	options: [
		{
			text: "--fresh, -f",
			description: "Delete .warlock/manifest.json before start (force full re-parse from disk)",
			type: "boolean"
		},
		{
			text: "--skip-typings, -st",
			description: "Skip background type generation for this run",
			type: "boolean"
		},
		{
			text: "--skip-health, -sh",
			description: "Skip file health checkers for this run",
			type: "boolean"
		}
	]
});
//#endregion
export { devServerCommand };

//# sourceMappingURL=dev-server.command.mjs.map