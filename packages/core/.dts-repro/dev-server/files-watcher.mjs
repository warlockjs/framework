import { rootPath, srcPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { Path } from "./path.mjs";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager.mjs";
import { Random } from "@mongez/reinforcements";
import events from "@mongez/events";
import chokidar from "chokidar";
//#region ../../@warlock.js/core/src/dev-server/files-watcher.ts
/**
* Default patterns to exclude from watching
*/
const DEFAULT_EXCLUDE = [
	"**/node_modules/**",
	"**/dist/**",
	"**/.warlock/**",
	"**/.git/**"
];
/**
* All .env file variants to watch
*/
const ENV_FILES = [
	".env",
	".env.local",
	".env.development",
	".env.development.local",
	".env.test",
	".env.test.local",
	".env.production",
	".env.production.local"
];
var FilesWatcher = class {
	constructor() {
		this.id = Random.string();
	}
	/**
	* Watch for files changes
	* @param config Optional watch configuration
	*/
	async watch(config) {
		const userWatchConfig = (await warlockConfigManager.lazyGet("devServer"))?.watch;
		const basePaths = [
			...ENV_FILES.map((file) => rootPath(file)),
			rootPath("warlock.config.ts"),
			srcPath()
		];
		const additionalPaths = userWatchConfig?.include || config?.include || [];
		const paths = [...basePaths, ...additionalPaths].map((path) => Path.normalize(path));
		const ignored = [
			...DEFAULT_EXCLUDE,
			...userWatchConfig?.exclude || [],
			...config?.exclude || []
		];
		const watcher = chokidar.watch(paths, {
			ignoreInitial: true,
			ignored,
			persistent: true,
			usePolling: false,
			interval: 100,
			binaryInterval: 300,
			awaitWriteFinish: {
				stabilityThreshold: 100,
				pollInterval: 50
			},
			depth: 99
		});
		watcher.on("add", (filePath) => this.triggerEvent("add", filePath));
		watcher.on("change", (filePath) => this.triggerEvent("change", filePath));
		watcher.on("unlink", (filePath) => this.triggerEvent("delete", filePath));
		watcher.on("addDir", (filePath) => this.triggerEvent("addDir", filePath));
		watcher.on("unlinkDir", (filePath) => this.triggerEvent("unlinkDir", filePath));
		process.on("SIGINT", async () => {
			await watcher.close();
		});
	}
	/**
	* Trigger event immediately (no debouncing here)
	* Debouncing is handled at the orchestrator level for batch processing
	*/
	triggerEvent(event, filePath, error) {
		events.trigger(`file-watcher.${this.id}.${event}`, Path.normalize(filePath), error);
	}
	/**
	* On file change event
	*/
	onFileChange(callback) {
		return this.on("change", callback);
	}
	/**
	* On file delete event
	*/
	onFileDelete(callback) {
		return this.on("delete", callback);
	}
	/**
	* On file add event
	*/
	onFileAdd(callback) {
		return this.on("add", callback);
	}
	/**
	* On file error event
	*/
	onFileError(callback) {
		return this.on("error", callback);
	}
	/**
	* On file add dir event
	*/
	onDirectoryAdd(callback) {
		return this.on("addDir", callback);
	}
	/**
	* On file unlink dir event
	*/
	onDirectoryRemove(callback) {
		return this.on("unlinkDir", callback);
	}
	/**
	* On file event
	*/
	on(event, callback) {
		return events.subscribe(`file-watcher.${this.id}.${event}`, callback);
	}
};
//#endregion
export { FilesWatcher };

//# sourceMappingURL=files-watcher.mjs.map