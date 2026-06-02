import { config } from "../../config/config-getter.mjs";
import "../../config/index.mjs";
import { storage } from "../../storage/storage.mjs";
import "../../storage/index.mjs";
import path from "path";
import fs from "fs/promises";
//#region ../../@warlock.js/core/src/cli/commands/storage-put.action.ts
/**
* Action for `warlock storage.put <localPath> [destination] [--driver <name>] [--concurrency <n>]`
*
* Uploads a local file or directory into any configured storage driver.
* Auto-detects whether <localPath> is a file or directory and calls the
* appropriate storage method.
*
* @example
* # Upload entire uploads directory to R2 (root of bucket)
* warlock storage.put ./uploads --driver r2
*
* @example
* # Upload to a specific destination prefix
* warlock storage.put ./uploads backups/2026 --driver r2
*
* @example
* # Single file upload with custom concurrency
* warlock storage.put ./public/logo.png assets/logo.png --driver s3
*/
async function storagePutAction({ args, options }) {
	const [localPath, destination = ""] = args;
	if (!localPath) {
		console.error("✖  Missing required argument: <localPath>");
		console.error("   Usage: warlock storage.put <localPath> [destination] [--driver <name>]");
		process.exit(1);
	}
	const absolutePath = path.resolve(process.cwd(), localPath);
	const driverName = options.driver;
	const concurrency = options.concurrency ? Number(options.concurrency) : 5;
	let stat;
	try {
		stat = await fs.stat(absolutePath);
	} catch {
		console.error(`✖  Path not found: ${absolutePath}`);
		process.exit(1);
	}
	const store = driverName ? storage.use(driverName) : storage;
	const driverLabel = driverName ?? config.get("storage.default");
	console.log(`\n  Driver    : ${driverLabel}`);
	console.log(`  Source    : ${absolutePath}`);
	console.log(`  Dest      : ${destination || "(root)"}\n`);
	if (stat.isDirectory()) {
		const result = await store.putDirectory(absolutePath, destination, {
			concurrency,
			filter: (_, rel) => !path.basename(rel).startsWith("."),
			onProgress: (done, total, file) => {
				process.stdout.write(`\r  Progress  : ${done}/${total}  ${file.path}`);
			}
		});
		process.stdout.write("\n");
		console.log(`\n  ✔  ${result.uploaded.length} file(s) uploaded`);
		if (result.failed.length > 0) {
			console.warn(`\n  ⚠  ${result.failed.length} file(s) failed:`);
			for (const { localPath: fp, error } of result.failed) console.warn(`     - ${fp}: ${error.message}`);
		}
	} else {
		const storagePath = destination || path.basename(absolutePath);
		console.log(`  Uploading : ${path.basename(absolutePath)} → ${storagePath}`);
		const file = await store.put(absolutePath, storagePath);
		console.log(`\n  ✔  Uploaded: ${file.url}`);
	}
	console.log();
}
//#endregion
export { storagePutAction };

//# sourceMappingURL=storage-put.action.mjs.map