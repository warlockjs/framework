//#region ../../@warlock.js/core/src/cli/cli-command.ts
var CLICommand = class {
	/**
	* Constructor
	*/
	constructor(name, description) {
		this.name = name;
		this.commandOptions = [];
		this.isPersistent = false;
		if (description) this.commandDescription = description;
		return this;
	}
	/**
	* Add command source
	*/
	source(source) {
		this.commandSource = source;
		return this;
	}
	/**
	* Set command description
	*/
	description(description) {
		this.commandDescription = description;
		return this;
	}
	/**
	* Determine if the command is persistent
	*/
	persistent(isPersistent = true) {
		this.isPersistent = isPersistent;
		return this;
	}
	/**
	* Set command alias (short name)
	* @example .alias("m") for "migrate"
	*/
	alias(alias) {
		this.commandAlias = alias;
		return this;
	}
	/**
	* Command action
	*/
	action(action) {
		this.commandAction = action;
		return this;
	}
	/**
	* Command pre action
	* This will be executed before loading preloaders
	*/
	preAction(action) {
		this.commandPreAction = action;
		return this;
	}
	/**
	* Add command options
	*/
	options(options) {
		options.map((option) => this.option(option));
		return this;
	}
	/**
	* Add command relative path
	*/
	$relativePath(relativePath) {
		this.commandRelativePath = relativePath;
		return this;
	}
	option(...args) {
		let option;
		if (args.length === 1) option = args[0];
		else option = {
			text: args[0],
			description: args[1],
			...args[2],
			name: ""
		};
		this.commandOptions.push(this.parseOption(option));
		return this;
	}
	/**
	* Parse option name and alias if exists
	*
	* Supports formats:
	* - "--port, -p" → name: "port", alias: "p"
	* - "-p, --port" → name: "port", alias: "p"
	* - "--port" → name: "port", alias: undefined
	* - "-p" → name: "p", alias: undefined
	*/
	parseOption(option) {
		const parts = option.text.trim().split(",").map((part) => part.trim());
		let name = "";
		let alias = "";
		if (parts.length === 1) name = this.extractOptionName(parts[0]);
		else if (parts.length === 2) {
			const first = parts[0];
			const second = parts[1];
			if (first.startsWith("--")) {
				name = this.extractOptionName(first);
				alias = this.extractOptionName(second);
			} else {
				name = this.extractOptionName(second);
				alias = this.extractOptionName(first);
			}
		}
		if (alias === "h" || name === "help") throw new Error("Help option is not allowed, it's reserved for displaying command help");
		return {
			...option,
			name,
			alias
		};
	}
	/**
	* Extract option name from text (removes -- or -)
	*
	* @example
	* extractOptionName("--port") → "port"
	* extractOptionName("-p") → "p"
	* extractOptionName("--port=3000") → "port"
	*/
	extractOptionName(text) {
		let name = text.replace(/^-+/, "");
		const equalIndex = name.indexOf("=");
		if (equalIndex !== -1) name = name.slice(0, equalIndex);
		const spaceIndex = name.indexOf(" ");
		if (spaceIndex !== -1) name = name.slice(0, spaceIndex);
		return name.trim();
	}
	/**
	* Command preload
	*/
	preload(options) {
		this.commandPreload = options;
		return this;
	}
	/**
	* Execute the command
	*/
	async execute(data) {
		if (!this.commandAction) throw new Error(`Command "${this.name}" has no action defined`);
		await this.commandAction(data);
	}
};
function command(options) {
	const commandInstnace = new CLICommand(options.name, options.description);
	if (options.preload) commandInstnace.preload(options.preload);
	if (options.persistent) commandInstnace.persistent(options.persistent);
	if (options.alias) commandInstnace.alias(options.alias);
	commandInstnace.action(options.action);
	if (options.options) commandInstnace.options(options.options);
	if (options.preAction) commandInstnace.preAction(options.preAction);
	return commandInstnace;
}
//#endregion
export { CLICommand, command };

//# sourceMappingURL=cli-command.mjs.map