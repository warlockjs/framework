import { ProductionBuilder } from "./production-builder.mjs";
//#region ../../@warlock.js/core/src/production/build-app-production.ts
/**
* Build the application for production
* Options are loaded from warlock.config.ts
*/
async function buildAppProduction() {
	await new ProductionBuilder().build();
}
//#endregion
export { buildAppProduction };

//# sourceMappingURL=build-app-production.mjs.map