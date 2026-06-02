import { environment } from "../utils/environment.mjs";
import "../utils/index.mjs";
import { colors } from "@mongez/copper";
//#region ../../@warlock.js/core/src/bootstrap/setup.ts
function displayEnvironmentMode() {
	const env = environment();
	const envColor = (env) => {
		switch (env) {
			case "development": return colors.yellow(env);
			case "production": return colors.green(env);
			case "test": return colors.magentaBright(env);
		}
	};
	console.log(colors.blueBright("ℹ"), colors.yellow(`(${(/* @__PURE__ */ new Date()).toISOString()})`), colors.orange("[warlock]"), colors.magenta(`bootstrap`), colors.blueBright(`Starting application in ${envColor(env)} mode`));
}
//#endregion
export { displayEnvironmentMode };

//# sourceMappingURL=setup.mjs.map