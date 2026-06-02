import { command } from "../cli-command.mjs";
import { displayStartupBanner } from "../cli-commands.utils.mjs";
import { resolveBuildConfig } from "../../production/resolve-build-config.mjs";
import { spawn } from "child_process";
//#region ../../@warlock.js/core/src/cli/commands/start-production.command.ts
const startProductionCommand = command({
	name: "start",
	description: "Start production server",
	persistent: true,
	preload: { warlockConfig: true },
	preAction: async () => {
		displayStartupBanner({ environment: "production" });
	},
	action: async () => {
		const { entryPath, sourcemap } = resolveBuildConfig();
		const nodeArgs = [];
		if (sourcemap !== false) nodeArgs.push("--enable-source-maps");
		nodeArgs.push(entryPath);
		const startIndex = process.argv.findIndex((arg) => arg === "start");
		if (startIndex !== -1 && startIndex < process.argv.length - 1) {
			const extraArgs = process.argv.slice(startIndex + 1);
			nodeArgs.push(...extraArgs);
		}
		console.log(`🚀 Starting production server...\n`);
		const child = spawn("node", nodeArgs, {
			stdio: "inherit",
			cwd: process.cwd(),
			env: process.env,
			detached: false
		});
		let isShuttingDown = false;
		const forwardSignal = (signal) => {
			if (isShuttingDown) return;
			isShuttingDown = true;
			child.kill(signal);
		};
		process.on("SIGTERM", () => forwardSignal("SIGTERM"));
		process.on("SIGINT", () => {
			isShuttingDown = true;
		});
		child.on("exit", (code) => {
			process.exit(code ?? 0);
		});
	}
});
//#endregion
export { startProductionCommand };

//# sourceMappingURL=start-production.command.mjs.map