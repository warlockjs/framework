import { appPath, warlockPath } from "../utils/paths.mjs";
import "../utils/index.mjs";
import { tsconfigManager } from "../dev-server/tsconfig-manager.mjs";
import { nativeNodeModulesPlugin } from "./esbuild-plugins.mjs";
import { resolveBuildConfig } from "./resolve-build-config.mjs";
import path from "path";
import { toCamelCase } from "@mongez/reinforcements";
import { colors } from "@mongez/copper";
import { ensureDirectoryAsync, fileExistsAsync, putFileAsync, removeDirectoryAsync } from "@warlock.js/fs";
import glob from "fast-glob";
import esbuild from "esbuild";
//#region ../../@warlock.js/core/src/production/production-builder.ts
/**
* Production Builder
* Generates production-ready files and bundles them for deployment
* Build options are loaded from warlock.config.ts
*/
var ProductionBuilder = class {
	constructor() {
		this.productionDir = warlockPath("production");
		this.generatedFiles = {
			locales: false,
			events: false,
			main: false,
			routes: false
		};
	}
	/**
	* Main build entry point
	*/
	async build() {
		console.log(colors.cyan("Building for production...\n"));
		await this.initializeOptions();
		await this.generateCombinedFiles();
		await this.generateEntryPoint();
		await this.bundle();
		await removeDirectoryAsync(this.productionDir);
		console.log(colors.green("Build complete!"));
		console.log(`Start production server by running ${colors.cyan("warlock start")}`);
	}
	/**
	* Initialize options from warlock.config.ts
	*/
	async initializeOptions() {
		this.options = resolveBuildConfig();
		await ensureDirectoryAsync(this.productionDir);
	}
	/**
	* Generate all combined files
	*/
	async generateCombinedFiles() {
		console.log(colors.yellow("   Generating production files..."));
		await this.generateBootstrap();
		await this.generateConfigLoader();
		const [locales, events, main, routes] = await Promise.all([
			this.generateLocales(),
			this.generateEvents(),
			this.generateMain(),
			this.generateRoutes()
		]);
		this.generatedFiles = {
			locales,
			events,
			main,
			routes
		};
	}
	/**
	* Generate bootstrap.ts - ensures bootstrap() runs first and sets production environment
	*/
	async generateBootstrap() {
		let content = `import { bootstrap, Application } from "@warlock.js/core";

// Set production environment
Application.setRuntimeStrategy("production");
Application.setEnvironment("production");

// Bootstrap the application
bootstrap();
`;
		if (await fileExistsAsync(appPath("bootstrap.ts"))) content += "import './../../src/app/bootstrap';\n";
		await putFileAsync(path.join(this.productionDir, "bootstrap.ts"), content);
	}
	/**
	* Glob for module files matching a pattern
	* Returns relative paths from .warlock/production/ to src/app/
	*/
	async globModule(fileName) {
		return (await glob(`**/${fileName}.{ts,tsx}`, {
			cwd: appPath(),
			absolute: false
		})).map((file) => "../../src/app/" + file.replace(/\.(ts|tsx)$/, ""));
	}
	/**
	* Glob for files in a specific directory pattern
	* Returns relative paths from .warlock/production/ to src/app/
	*/
	async globModuleDirectory(directory) {
		return (await glob(`**/${directory}/*.{ts,tsx}`, {
			cwd: appPath(),
			absolute: false
		})).map((file) => "../../src/app/" + file.replace(/\.(ts|tsx)$/, ""));
	}
	/**
	* Generate config-loader.ts
	*/
	async generateConfigLoader() {
		const configNames = (await glob("*.{ts,tsx}", {
			cwd: path.join(process.cwd(), "src/config"),
			absolute: false
		})).map((f) => f.replace(/\.(ts|tsx)$/, ""));
		const imports = ["import config from \"@mongez/config\";", "import { configSpecialHandlers } from \"@warlock.js/core\";"];
		const configImports = [];
		const configSetCalls = [];
		const executors = [];
		for (const configName of configNames) {
			const properConfigName = toCamelCase(configName);
			const varName = `${properConfigName}Config`;
			configImports.push(`import ${varName} from "../../src/config/${configName}";`);
			configSetCalls.push(`config.set("${properConfigName}", ${varName});`);
			executors.push(`await configSpecialHandlers.execute("${properConfigName}", ${varName});`);
		}
		let content = [
			...imports,
			"",
			"// Config imports",
			...configImports,
			"",
			"// Register configs",
			...configSetCalls,
			"",
			"// Special handlers",
			...executors,
			""
		].join("\n");
		if (await fileExistsAsync(appPath("prestart.ts"))) content += "import './../../src/app/prestart';\n";
		await putFileAsync(path.join(this.productionDir, "config-loader.ts"), content);
	}
	/**
	* Generate locales.ts (only if there are locale files)
	* @returns true if file was generated with content
	*/
	async generateLocales() {
		const files = await this.globModule("utils/locales");
		if (files.length === 0) return false;
		await this.generateImportsFile(files, "locales.ts");
		return true;
	}
	/**
	* Generate events.ts (only if there are event files)
	* @returns true if file was generated with content
	*/
	async generateEvents() {
		const files = await this.globModuleDirectory("events");
		if (files.length === 0) return false;
		await this.generateImportsFile(files, "events.ts");
		return true;
	}
	/**
	* Generate main.ts (only if there are main files)
	* @returns true if file was generated with content
	*/
	async generateMain() {
		const files = await this.globModule("main");
		if (files.length === 0) return false;
		await this.generateImportsFile(files, "main.ts");
		return true;
	}
	/**
	* Generate routes.ts (only if there are route files)
	* @returns true if file was generated with content
	*/
	async generateRoutes() {
		const files = await this.globModule("routes");
		if (files.length === 0) return false;
		await this.generateImportsFile(files, "routes.ts");
		return true;
	}
	/**
	* Generate a file with imports from all given files
	*/
	async generateImportsFile(importPaths, outputFile) {
		const content = importPaths.map((importPath) => `import "${importPath}";`).join("\n") + "\n";
		await putFileAsync(path.join(this.productionDir, outputFile), content);
	}
	/**
	* Generate the main entry point (app.ts)
	*/
	async generateEntryPoint() {
		console.log(colors.yellow("   Generating entry point..."));
		const imports = [
			"// 1. Bootstrap (loads .env, initializes framework)",
			"import \"./bootstrap\";",
			"",
			"// 2. Load configs",
			"import \"./config-loader\";",
			"",
			"// 3. Start early-phase connectors (database, cache, logger, ...)",
			"//    so data sources, cache, etc. are ready before app code runs",
			"import { connectorsManager, ConnectorLifecyclePhase } from \"@warlock.js/core\";",
			"await connectorsManager.startPhase(ConnectorLifecyclePhase.Early);"
		];
		imports.push("", "// 4. Load app code (events, locales, main, routes)");
		if (this.generatedFiles.events) imports.push("await import(\"./events\");");
		if (this.generatedFiles.locales) imports.push("await import(\"./locales\");");
		if (this.generatedFiles.main) imports.push("await import(\"./main\");");
		if (this.generatedFiles.routes) imports.push("await import(\"./routes\");");
		imports.push("", "// 5. Start late-phase connectors (http, socket) â€” routes and", "//    listeners registered by app code are now ready to bind", "await connectorsManager.startPhase(ConnectorLifecyclePhase.Late);", "connectorsManager.shutdownOnProcessKill();");
		const content = imports.join("\n") + "\n";
		await putFileAsync(path.join(this.productionDir, "app.ts"), content);
	}
	/**
	* Bundle with esbuild
	*/
	async bundle() {
		console.log(colors.magenta("   Bundling with esbuild..."));
		const entryPoint = path.join(this.productionDir, "app.ts");
		const outDir = this.options.outDirectory;
		const outFileName = this.options.outFile;
		const entryName = path.basename(outFileName, path.extname(outFileName));
		await ensureDirectoryAsync(outDir);
		const alias = this.buildAliasMapFromTsconfig();
		await esbuild.build({
			platform: "node",
			entryPoints: [entryPoint],
			bundle: true,
			splitting: true,
			packages: "external",
			minify: this.options.minify,
			sourcemap: this.options.sourcemap === true ? "linked" : this.options.sourcemap,
			format: "esm",
			target: ["node22"],
			outdir: outDir,
			entryNames: entryName,
			alias,
			plugins: [nativeNodeModulesPlugin]
		});
	}
	/**
	* Build an alias map from tsconfig `paths` so esbuild resolves local
	* source aliases (e.g. `@warlock.js/cascade`) to their on-disk source
	* folders during bundling. Without this, `packages: "external"` would
	* leave those bare specifiers as raw imports and Node would fail to
	* resolve them at runtime (they aren't installed in node_modules).
	*
	* Only exact (non-wildcard) aliases are included â€” esbuild's `alias`
	* option doesn't support glob-style mappings.
	*/
	buildAliasMapFromTsconfig() {
		tsconfigManager.init();
		const alias = {};
		const baseUrl = path.resolve(process.cwd(), tsconfigManager.baseUrl);
		for (const [from, to] of Object.entries(tsconfigManager.aliases)) {
			if (from.endsWith("/*") || !Array.isArray(to) || to.length === 0) continue;
			alias[from] = path.resolve(baseUrl, to[0]);
		}
		return alias;
	}
};
//#endregion
export { ProductionBuilder };

//# sourceMappingURL=production-builder.mjs.map