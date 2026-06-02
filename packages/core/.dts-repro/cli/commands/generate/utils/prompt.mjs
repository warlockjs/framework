import readline from "node:readline";
//#region ../../@warlock.js/core/src/cli/commands/generate/utils/prompt.ts
/**
* Prompt user for confirmation
*/
async function confirm(message, defaultValue = false) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	return new Promise((resolve) => {
		const defaultText = defaultValue ? "Y/n" : "y/N";
		rl.question(`${message} (${defaultText}): `, (answer) => {
			rl.close();
			if (!answer.trim()) {
				resolve(defaultValue);
				return;
			}
			const normalized = answer.toLowerCase().trim();
			resolve(normalized === "y" || normalized === "yes");
		});
	});
}
//#endregion
export { confirm };

//# sourceMappingURL=prompt.mjs.map