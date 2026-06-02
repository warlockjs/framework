import { appPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { Application } from "../application/application.mjs";
import "../application/index.mjs";
import { bootstrap } from "../bootstrap.mjs";
import "../connectors/types.mjs";
import { connectorsManager } from "../connectors/connectors-manager.mjs";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager.mjs";
import { filesOrchestrator } from "../dev-server/files-orchestrator.mjs";
import { loadConfigFiles } from "../config/load-config-files.mjs";
import { manifestManager } from "../manifest/manifest-manager.mjs";
import { displayCommandError, displayCommandHelp, displayCommandNotFound, displayCommandSuccess, displayExecutingCommand, displayHelp, displayMissingCommand, displayMissingOptions, displayWarlockVersionInTerminal, isMatchingCommandName } from "./cli-commands.utils.mjs";
import { cliCommandsLoader } from "./commands-loader.mjs";
import { frameworkCommands } from "./framework-cli-commands.mjs";
import { parseCliArgs } from "./parse-cli-args.mjs";
import { findSimilar } from "./string-similarity.mjs";
import { loadEnv } from "@mongez/dotenv";
import { colors } from "@mongez/copper";
import { fileExistsAsync } from "@warlock.js/fs";
//#region ../../@warlock.js/core/src/cli/cli-commands.manager.ts
var CLICommandsManager = class {
	constructor() {
		this.commands = [];
		this.commandsMap = /* @__PURE__ */ new Map();
		this.aliasMap = /* @__PURE__ */ new Map();
	}
	/**
	* Register the given commands
	*/
	register(...commands) {
		this.commands.push(...commands);
		commands.forEach((command) => {
			const commandKey = command.name.split(" ")[0];
			manifestManager.addCommandToList(command.name, {
				relativePath: command.commandRelativePath,
				source: command.commandSource || "project",
				description: command.commandDescription,
				alias: command.commandAlias,
				options: command.commandOptions.length > 0 ? command.commandOptions : void 0
			});
			this.commandsMap.set(commandKey, command);
			if (command.commandAlias) this.aliasMap.set(command.commandAlias, commandKey);
		});
		return this;
	}
	/**
	* Get command by name or alias
	*/
	getCommand(name) {
		let command = this.commandsMap.get(name);
		if (command) return command;
		const realName = this.aliasMap.get(name);
		if (realName) return this.commandsMap.get(realName);
	}
	/**
	* Get all command names and aliases
	* Used for fuzzy matching suggestions
	*/
	getAllCommandNames() {
		const names = [];
		for (const name of this.commandsMap.keys()) names.push(name);
		for (const alias of this.aliasMap.keys()) names.push(alias);
		const manifestCommands = manifestManager.commandsJson?.commands || {};
		for (const name of Object.keys(manifestCommands)) {
			const baseName = name.split(" ")[0];
			if (!names.includes(baseName)) names.push(baseName);
			const alias = manifestCommands[name].alias;
			if (alias && !names.includes(alias)) names.push(alias);
		}
		return names;
	}
	/**
	* Start the cli manager
	*/
	async start() {
		const { name, options, args } = parseCliArgs(process.argv);
		if (options.noCache) {
			manifestManager.clearCommandsCache();
			await manifestManager.removeCommandsFile();
		}
		if (options.version || options.v) {
			await displayWarlockVersionInTerminal();
			process.exit(0);
		}
		await manifestManager.loadCommands();
		this.register(...frameworkCommands.map((command) => {
			if (!command.commandSource) command.commandSource = "framework";
			return command;
		}));
		const isHelpCommand = options.help || options.h;
		if (!name && isHelpCommand) {
			await this.showGlobalHelp();
			process.exit(0);
		}
		if (options.warmCache) {
			await this.warmCache();
			process.exit(0);
		}
		if (!name) {
			displayMissingCommand();
			process.exit(1);
		}
		const command = await this.lazyGetCommand(name);
		if (manifestManager.hasChanges) await manifestManager.saveCommands();
		if (!command) {
			displayCommandNotFound(name, findSimilar(name, this.getAllCommandNames()).map((s) => s.value));
			process.exit(1);
		}
		if (isHelpCommand) {
			displayCommandHelp({
				name: command.name,
				alias: command.commandAlias,
				description: command.commandDescription,
				options: command.commandOptions
			});
			process.exit(0);
		}
		await this.execute(command, {
			options,
			args
		});
	}
	/**
	* Show global help with all commands
	* Uses manifest if available for fast display
	*/
	async showGlobalHelp() {
		if (manifestManager.isCommandLoaded && Object.keys(manifestManager.commandsJson?.commands || {}).length > 0) {
			await displayHelp(Object.entries(manifestManager.commandsJson?.commands || {}).map(([name, cmd]) => ({
				name,
				alias: cmd.alias,
				description: cmd.description,
				source: cmd.source
			})));
			return;
		}
		await this.loadPluginsCommands();
		const projectCommands = await cliCommandsLoader.scanAll();
		this.register(...projectCommands);
		await manifestManager.saveCommands();
		await displayHelp(this.commands.map((cmd) => ({
			name: cmd.name,
			alias: cmd.commandAlias,
			description: cmd.commandDescription,
			source: cmd.commandSource || "project"
		})));
	}
	/**
	* Warm cache - scan all project commands and save to manifest
	*/
	async warmCache() {
		console.log();
		console.log(`  ${colors.cyan("â€º")} Scanning project commands...`);
		const projectCommands = await cliCommandsLoader.scanAll();
		this.register(...projectCommands);
		await manifestManager.saveCommands();
		console.log(`  ${colors.green("âœ”")} Cached ${colors.bold(String(projectCommands.length))} project commands`);
		console.log();
	}
	/**
	* Load plugins commands
	*/
	async loadPluginsCommands() {
		await warlockConfigManager.load();
		if (warlockConfigManager.isLoaded) this.register(...(warlockConfigManager.get("cli")?.commands || []).map((command) => {
			if (!command.commandSource) command.commandSource = "plugin";
			return command;
		}));
	}
	/**
	* Try to find the command based on the given command name or alias
	*/
	async lazyGetCommand(name) {
		let command = this.getCommand(name);
		if (command) return command;
		await this.loadPluginsCommands();
		command = this.getCommand(name);
		if (command) return command;
		await this.loadProjectCommands(name);
		command = this.getCommand(name);
		if (command) return command;
		return null;
	}
	/**
	* Load project commands
	*/
	async loadProjectCommands(name) {
		const jsonCommandsFile = await manifestManager.loadCommands();
		if (jsonCommandsFile) for (const fullCommandName in jsonCommandsFile.commands) {
			const cmdMeta = jsonCommandsFile.commands[fullCommandName];
			if (isMatchingCommandName(fullCommandName, name) || cmdMeta.alias === name) {
				const commandPath = cmdMeta.relativePath;
				if (commandPath) {
					const executedCommand = await cliCommandsLoader.load(commandPath);
					if (executedCommand) {
						executedCommand.$relativePath(commandPath);
						this.register(executedCommand);
						return;
					}
				}
			}
		}
		const command = await cliCommandsLoader.locate(name);
		if (command) {
			this.register(command);
			return;
		}
	}
	/**
	* Validate required options
	*/
	validateOptions(command, options) {
		const missing = [];
		command.commandOptions.forEach((opt) => {
			if (opt.required) {
				if (!(options[opt.name] !== void 0 || opt.alias && options[opt.alias] !== void 0)) missing.push(opt);
			}
		});
		return missing;
	}
	/**
	* Apply default values to options
	*/
	applyDefaultOptions(command, options) {
		const result = { ...options };
		command.commandOptions.forEach((opt) => {
			if (opt.defaultValue !== void 0) {
				if (!(result[opt.name] !== void 0 || opt.alias && result[opt.alias] !== void 0)) result[opt.name] = opt.defaultValue;
			}
			if (opt.alias !== void 0 && result[opt.alias] && result[opt.name] === void 0) result[opt.name] = result[opt.alias];
		});
		return result;
	}
	/**
	* Execute the given command
	*/
	async execute(command, data) {
		const startTime = Date.now();
		const missingOptions = this.validateOptions(command, data.options);
		if (missingOptions.length > 0) {
			displayMissingOptions(missingOptions);
			process.exit(1);
		}
		data.options = this.applyDefaultOptions(command, data.options);
		displayExecutingCommand(command.name);
		if (command.commandPreAction) await command.commandPreAction(data);
		if (command.commandPreload) await this.loadPreloaders(command);
		try {
			await command.execute(data);
			if (!command.isPersistent) {
				displayCommandSuccess(command.name, Date.now() - startTime);
				process.exit(0);
			}
		} catch (error) {
			displayCommandError(command.name, error);
			if (!command.isPersistent) process.exit(1);
		}
	}
	/**
	* Load preloaders
	*/
	async loadPreloaders(command) {
		const preloaders = command.commandPreload || {};
		if (preloaders.runtimeStrategy) Application.setRuntimeStrategy(preloaders.runtimeStrategy);
		if (preloaders.environemnt) Application.setEnvironment(preloaders.environemnt);
		await warlockConfigManager.load();
		if (preloaders.config || preloaders.bootstrap || preloaders.prestart) await filesOrchestrator.init();
		if (preloaders.env && !preloaders.bootstrap) await loadEnv();
		else if (preloaders.bootstrap) {
			await bootstrap();
			if (await fileExistsAsync(appPath("bootstrap.ts"))) await filesOrchestrator.load("src/app/bootstrap.ts");
		}
		if (preloaders.config) await loadConfigFiles(preloaders.config);
		if (preloaders.prestart) {
			if (await fileExistsAsync(appPath("prestart.ts"))) await filesOrchestrator.load("src/app/prestart.ts");
		}
		if (preloaders.connectors) if (preloaders.connectors === true) await connectorsManager.startPhase("early");
		else await connectorsManager.start(preloaders.connectors);
	}
};
//#endregion
export { CLICommandsManager };

//# sourceMappingURL=cli-commands.manager.mjs.map