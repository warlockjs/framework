import { warlockPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { getJsonFileAsync, putJsonFileAsync, unlinkAsync } from "@warlock.js/fs";
//#region ../../@warlock.js/core/src/manifest/manifest-manager.ts
var ManifestManager = class {
	constructor() {
		this._hasChanges = false;
		this._isLoaded = false;
	}
	/**
	* Get if commands json has changes
	*/
	get hasChanges() {
		return this._hasChanges;
	}
	/**
	* Check if commands json is loaded
	*/
	get isCommandLoaded() {
		return this._isLoaded;
	}
	/**
	* Load commands.json file
	*/
	async loadCommands() {
		if (this._isLoaded) return this._commandsJson;
		try {
			this._commandsJson = await getJsonFileAsync(warlockPath("commands.json"));
			this._isLoaded = true;
			return this._commandsJson;
		} catch {
			return;
		}
	}
	/**
	* Get commands json content
	*/
	get commandsJson() {
		return this._commandsJson;
	}
	/**
	* Save commands in commands.json file
	*/
	async saveCommands() {
		await putJsonFileAsync(warlockPath("commands.json"), this._commandsJson);
		this._isLoaded = true;
		this._hasChanges = false;
	}
	/**
	* Add command info to commands list (But do not save commands)
	*/
	addCommandToList(name, command) {
		if (!this._commandsJson) this._commandsJson = { commands: {} };
		this._commandsJson.commands[name] = command;
		this._hasChanges = true;
	}
	/**
	* Clear commands cache
	*/
	clearCommandsCache() {
		this._commandsJson = void 0;
		this._hasChanges = false;
		this._isLoaded = false;
	}
	/**
	* Remove commands.json file
	*/
	async removeCommandsFile() {
		try {
			await unlinkAsync(warlockPath("commands.json"));
		} catch {}
	}
};
const manifestManager = new ManifestManager();
//#endregion
export { manifestManager };

//# sourceMappingURL=manifest-manager.mjs.map