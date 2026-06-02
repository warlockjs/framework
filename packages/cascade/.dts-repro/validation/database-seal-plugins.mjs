import { databaseRulesPlugin } from "./plugins/database-rules-plugin.mjs";
import { embedValidator } from "./plugins/embed-validator-plugin.mjs";
import { registerPlugin } from "@warlock.js/seal";
//#region ../../@warlock.js/cascade/src/validation/database-seal-plugins.ts
registerPlugin(embedValidator);
registerPlugin(databaseRulesPlugin);
//#endregion
export {};

//# sourceMappingURL=database-seal-plugins.mjs.map