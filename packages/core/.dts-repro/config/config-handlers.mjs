import { configSpecialHandlers } from "./config-special-handlers.mjs";
//#region ../../@warlock.js/core/src/config/config-handlers.ts
/**
* App Config Handler
* Handles locale loading for dayjs
*/
const registerAppConfig = async (config) => {
	const locales = config.locales || ["en"];
	for (const locale of locales) {
		if (locale === "en") continue;
		try {
			await import(`dayjs/locale/${locale}.js`);
		} catch (error) {
			console.warn(`   ⚠️  Failed to load dayjs locale: ${locale}`);
		}
	}
};
configSpecialHandlers.register("app", registerAppConfig);
//#endregion
export { registerAppConfig };

//# sourceMappingURL=config-handlers.mjs.map