import { main } from "./cli/index.mjs";
import { setLoggerConfig } from "./cli/setup-logger.mjs";
import { loadEnv } from "@mongez/dotenv";
import { runMain } from "citty";
//#region ../../@warlock.js/cascade/src/cli.ts
/**
* Standalone Cascade CLI entrypoint.
*
* Executed two ways:
* - **Dev** — `tsx ./@warlock.js/cascade/src/cli.ts ...` via the root
*   `cascade` / `cascade.migrate` scripts.
* - **Production** — `bin/cascade.mjs` side-effect-imports the compiled
*   `esm/cli.js`, which kicks off `runMain` on load.
*
* Nothing is exported on purpose. Importing this module IS the CLI.
*/
setLoggerConfig();
try {
	loadEnv();
} catch {}
runMain(main);
//#endregion
export {};

//# sourceMappingURL=cli.mjs.map