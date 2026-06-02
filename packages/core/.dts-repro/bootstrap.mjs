import { loadEnv } from "@mongez/dotenv";
import { captureAnyUnhandledRejection } from "@warlock.js/logger";
import { initializeDayjs } from "@mongez/time-wizard";
//#region ../../@warlock.js/core/src/bootstrap.ts
async function bootstrap() {
	await loadEnv();
	initializeDayjs();
	captureAnyUnhandledRejection();
}
//#endregion
export { bootstrap };

//# sourceMappingURL=bootstrap.mjs.map