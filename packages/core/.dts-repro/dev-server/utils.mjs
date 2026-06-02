import { srcPath, warlockPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { Path } from "./path.mjs";
import { ensureDirectoryAsync } from "@warlock.js/fs";
import glob from "fast-glob";
//#region ../../@warlock.js/core/src/dev-server/utils.ts
/**
* Ensure the .warlock/ directory exists. Used by the loader-hook
* registration which writes its bundled hook file into this directory.
*/
async function ensureWarlockDirectory() {
	await ensureDirectoryAsync(warlockPath());
}
/**
* Glob the project's `src/` directory for `.ts`/`.tsx` files. Returns
* normalised absolute paths.
*/
async function getFilesFromDirectory(directoryPath = srcPath(), pattern = "**/*.{ts,tsx}") {
	return (await glob(`${Path.normalize(directoryPath)}/${pattern}`, { absolute: true })).map((file) => Path.normalize(file));
}
async function getCertainFilesFromDirectory(directoryPath, filesNames) {
	return getFilesFromDirectory(directoryPath, (filesNames.length === 1 ? filesNames[0] : `(${filesNames.join("|")})`) + ".{ts,tsx}");
}
function areSetsEqual(set1, set2) {
	if (set1.size !== set2.size) return false;
	for (const item of set1) if (!set2.has(item)) return false;
	return true;
}
//#endregion
export { areSetsEqual, ensureWarlockDirectory, getCertainFilesFromDirectory, getFilesFromDirectory };

//# sourceMappingURL=utils.mjs.map