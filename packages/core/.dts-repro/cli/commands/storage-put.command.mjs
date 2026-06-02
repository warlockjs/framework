import { command } from "../cli-command.mjs";
import { storagePutAction } from "./storage-put.action.mjs";
//#region ../../@warlock.js/core/src/cli/commands/storage-put.command.ts
/**
* `storage.put` CLI command
*
* Uploads a local file or directory to any configured storage driver.
* Auto-detects file vs directory and streams each file (no full buffer in memory).
*
* @example
* # Upload full uploads/ directory to R2 (migrating from local to cloud)
* warlock storage.put ./uploads --driver r2
*
* @example
* # Upload under a specific prefix
* warlock storage.put ./uploads backups/2026 --driver r2
*
* @example
* # Single file upload to default driver
* warlock storage.put ./public/logo.png assets/logo.png
*/
const storagePutCommand = command({
	name: "storage.put <localPath> [destination]",
	alias: "sput",
	action: storagePutAction,
	description: "Upload a local file or directory to storage",
	preload: {
		env: true,
		config: ["storage"],
		connectors: ["storage"]
	},
	options: [{
		text: "--driver, -d",
		description: "Storage driver name (as defined in config). Defaults to the configured default driver."
	}, {
		text: "--concurrency, -c",
		description: "Number of concurrent uploads when uploading a directory",
		type: "number",
		defaultValue: 5
	}]
});
//#endregion
export { storagePutCommand };

//# sourceMappingURL=storage-put.command.mjs.map