import { toCamelCase } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/cli/parse-cli-args.ts
/**
* Parse CLI arguments from process.argv
*
* @example
* parseCliArgs(["node", "warlock", "migrate", "--rollback", "file.ts"])
* // Returns: { name: "migrate", args: [], options: { rollback: "file.ts" } }
*
* @example
* parseCliArgs(["node", "warlock", "dev", "--port=3000", "--fresh"])
* // Returns: { name: "dev", args: [], options: { port: "3000", fresh: true } }
*/
function parseCliArgs(argv) {
	const potentialCommand = argv[2] || "";
	const isFirstArgOption = potentialCommand.startsWith("-");
	const command = isFirstArgOption ? "" : potentialCommand;
	const args = [];
	const options = {};
	const startIndex = isFirstArgOption ? 2 : 3;
	for (let i = startIndex; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const withoutDashes = arg.slice(2);
			const equalIndex = withoutDashes.indexOf("=");
			if (equalIndex !== -1) {
				const key = toCamelCase(withoutDashes.slice(0, equalIndex));
				options[key] = withoutDashes.slice(equalIndex + 1);
			} else {
				const key = toCamelCase(withoutDashes);
				const nextArg = argv[i + 1];
				if (nextArg && !nextArg.startsWith("-")) {
					options[key] = nextArg;
					i++;
				} else options[key] = true;
			}
		} else if (arg.startsWith("-") && arg.length > 1) {
			const flags = arg.slice(1);
			const equalIndex = flags.indexOf("=");
			if (equalIndex !== -1) {
				const key = toCamelCase(flags.slice(0, equalIndex));
				options[key] = flags.slice(equalIndex + 1);
			} else if (flags.length === 1) {
				const nextArg = argv[i + 1];
				if (nextArg && !nextArg.startsWith("-")) {
					options[toCamelCase(flags)] = nextArg;
					i++;
				} else options[toCamelCase(flags)] = true;
			} else for (const flag of flags) options[toCamelCase(flag)] = true;
		} else args.push(arg);
	}
	return {
		name: command,
		args,
		options
	};
}
//#endregion
export { parseCliArgs };

//# sourceMappingURL=parse-cli-args.mjs.map