import { colors } from "@mongez/copper";
import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getFileAsync,
  getJsonFileAsync,
  putFileAsync,
  removeDirectoryAsync,
} from "@warlock.js/fs";
import esbuild from "esbuild";
import glob from "fast-glob";
import path from "path";
import { tsconfigManager } from "../dev-server/tsconfig-manager";
import { appPath, rootPath, warlockPath } from "../utils";
import { assertGeneratedImportsAreDeclared } from "./assert-generated-imports";
import { nativeNodeModulesPlugin } from "./esbuild-plugins";
import { resolveBuildConfig, type ResolvedBuildConfig } from "./resolve-build-config";
import { toCamelCase, toKebabCase } from "@mongez/reinforcements";

/**
 * Recreates `require`, `__filename` and `__dirname` at the top of an ESM bundle.
 *
 * Bundled CommonJS dependencies call `require("node:assert")` and read
 * `__dirname` to locate their own assets. Neither exists in an ES module, so
 * esbuild substitutes a stub that throws — **after the build has reported
 * success**. `Dynamic require of "node:assert" is not supported` is that stub
 * firing, and it is the defect this shim removes.
 *
 * `__dirname` matters as much as `require`: without it a dependency resolving
 * an asset path silently gets `undefined` and fails later, further from the
 * cause.
 *
 * Written as one line because esbuild inserts a banner verbatim above the
 * bundle and a multi-line string here would shift every mapped line.
 */
const ESM_INTEROP_SHIM =
  "import{createRequire as __wlCreateRequire}from'node:module';" +
  "import{fileURLToPath as __wlFileURLToPath}from'node:url';" +
  "import{dirname as __wlDirname}from'node:path';" +
  "const require=__wlCreateRequire(import.meta.url);" +
  "const __filename=__wlFileURLToPath(import.meta.url);" +
  "const __dirname=__wlDirname(__filename);";

/**
 * Combine the framework's banner with the user's, keeping both.
 *
 * esbuild's `banner` is an object keyed by output type, and every merge in the
 * path to it — the config merge and the options spread — REPLACES that object
 * rather than merging it. So whichever is applied second silently deletes the
 * other. This is the only place the two can coexist.
 *
 * The shim goes first: it defines `require`, which a user banner may use.
 *
 * @param userBanner banner from `warlock.config.ts`, if any
 * @param shim the interop shim, or undefined when it does not apply
 */
function mergeBanner(
  userBanner: Record<string, string> | undefined,
  shim: string | undefined,
): Record<string, string> | undefined {
  if (!shim) return userBanner;

  const userJs = userBanner?.js;

  return {
    ...userBanner,
    js: userJs ? `${shim}${userJs}` : shim,
  };
}

/**
 * Production Builder
 * Generates production-ready files and bundles them for deployment
 * Build options are loaded from warlock.config.ts
 */
export class ProductionBuilder {
  private options!: ResolvedBuildConfig;
  private readonly productionDir = warlockPath("production");

  /**
   * Main build entry point
   */
  public async build(): Promise<void> {
    console.log(colors.cyan("Building for production...\n"));

    // Step 1: Initialize options from config
    await this.initializeOptions();

    // Step 2: Generate combined files
    await this.generateCombinedFiles();

    // Step 3: Generate entry point
    await this.generateEntryPoint();

    // Step 4: Refuse to bundle code the app could not resolve at runtime
    await this.assertGeneratedImports();

    // Step 5: Bundle with esbuild
    await this.bundle();

    // Step 6: Remove production folder
    await removeDirectoryAsync(this.productionDir);

    console.log(colors.green("Build complete!"));
    console.log(`Start production server by running ${colors.cyan("warlock start")}`);
  }

  /**
   * Initialize options from warlock.config.ts
   */
  private async initializeOptions(): Promise<void> {
    this.options = resolveBuildConfig();

    // Ensure production directory exists
    await ensureDirectoryAsync(this.productionDir);
  }

  /**
   * Track which special files were generated
   */
  private generatedFiles = {
    locales: false,
    events: false,
    main: false,
    routes: false,
  };

  /**
   * Generate all combined files
   */
  private async generateCombinedFiles(): Promise<void> {
    console.log(colors.yellow("   Generating production files..."));

    // Generate bootstrap.ts file
    await this.generateBootstrap();

    // Generate config loader
    await this.generateConfigLoader();

    // Generate special files and track which ones have content
    const [locales, events, main, routes] = await Promise.all([
      this.generateLocales(),
      this.generateEvents(),
      this.generateMain(),
      this.generateRoutes(),
    ]);

    this.generatedFiles = { locales, events, main, routes };
  }

  /**
   * Generate bootstrap.ts - ensures bootstrap() runs first and sets production environment
   */
  private async generateBootstrap(): Promise<void> {
    let content = `import { bootstrap, Application } from "@warlock.js/core";

// Set production environment
Application.setRuntimeStrategy("production");
Application.setEnvironment("production");

// Bootstrap the application
bootstrap();
`;
    if (await fileExistsAsync(appPath("bootstrap.ts"))) {
      content += "import './../../src/app/bootstrap';\n";
    }

    await putFileAsync(path.join(this.productionDir, "bootstrap.ts"), content);
  }

  /**
   * Fail the build when generated code imports a package the app does not
   * declare.
   *
   * The bundler is configured `packages: "external"`, so every bare specifier
   * written above survives verbatim into an artifact that resolves against the
   * **consuming app's** node_modules. A framework-internal dependency imported
   * there resolves by accident under npm/yarn hoisting and dies under pnpm —
   * which is how a production app shipped that could not boot. Rewriting the
   * offending import fixes today's bundle; this check is what stops the next
   * change to the generator from quietly reintroducing it.
   */
  private async assertGeneratedImports(): Promise<void> {
    const generatedPaths = await glob("**/*.{ts,tsx,js,mjs}", {
      cwd: this.productionDir,
      absolute: false,
    });

    const [files, appPackage] = await Promise.all([
      Promise.all(
        generatedPaths.map(async (file) => ({
          file,
          content: await getFileAsync(path.join(this.productionDir, file)),
        })),
      ),
      getJsonFileAsync<{ dependencies?: Record<string, string> }>(rootPath("package.json")),
    ]);

    assertGeneratedImportsAreDeclared(files, Object.keys(appPackage.dependencies ?? {}));
  }

  /**
   * Glob for module files matching a pattern
   * Returns relative paths from .warlock/production/ to src/app/
   */
  private async globModule(fileName: string): Promise<string[]> {
    const pattern = `**/${fileName}.{ts,tsx}`;
    const appDirectory = appPath();

    const files = await glob(pattern, {
      cwd: appDirectory,
      absolute: false,
    });

    // Convert to relative paths from .warlock/production/ to src/app/
    // e.g., "users/main" -> "../../src/app/users/main"
    return files.map((file) => "../../src/app/" + file.replace(/\.(ts|tsx)$/, ""));
  }

  /**
   * Glob for files in a specific directory pattern
   * Returns relative paths from .warlock/production/ to src/app/
   */
  private async globModuleDirectory(directory: string): Promise<string[]> {
    const pattern = `**/${directory}/*.{ts,tsx}`;
    const appDirectory = appPath();

    const files = await glob(pattern, {
      cwd: appDirectory,
      absolute: false,
    });

    return files.map((file) => "../../src/app/" + file.replace(/\.(ts|tsx)$/, ""));
  }

  /**
   * Generate config-loader.ts
   */
  private async generateConfigLoader(): Promise<void> {
    const configDirectory = path.join(process.cwd(), "src/config");

    const files = await glob("*.{ts,tsx}", {
      cwd: configDirectory,
      absolute: false,
    });

    const configNames = files.map((f) => f.replace(/\.(ts|tsx)$/, ""));

    // Only `@warlock.js/core` — the one package the app itself declares. See
    // `assertGeneratedImportsAreDeclared`: `@mongez/config` is core's own
    // dependency, so a bare import of it resolved by luck under npm/yarn
    // hoisting and died under pnpm's strict layout.
    const imports: string[] = [
      'import { setConfig, configSpecialHandlers } from "@warlock.js/core";',
    ];
    const configImports: string[] = [];
    const configSetCalls: string[] = [];
    const executors: string[] = [];

    for (const configName of configNames) {
      const properConfigName = toCamelCase(configName);
      const varName = `${properConfigName}Config`;
      configImports.push(`import ${varName} from "../../src/config/${configName}";`);
      configSetCalls.push(`setConfig("${properConfigName}", ${varName});`);
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
      "",
    ].join("\n");

    if (await fileExistsAsync(appPath("prestart.ts"))) {
      content += "import './../../src/app/prestart';\n";
    }

    await putFileAsync(path.join(this.productionDir, "config-loader.ts"), content);
  }

  /**
   * Generate locales.ts (only if there are locale files)
   * @returns true if file was generated with content
   */
  private async generateLocales(): Promise<boolean> {
    const files = await this.globModule("utils/locales");
    if (files.length === 0) return false;
    await this.generateImportsFile(files, "locales.ts");
    return true;
  }

  /**
   * Generate events.ts (only if there are event files)
   * @returns true if file was generated with content
   */
  private async generateEvents(): Promise<boolean> {
    const files = await this.globModuleDirectory("events");
    if (files.length === 0) return false;
    await this.generateImportsFile(files, "events.ts");
    return true;
  }

  /**
   * Generate main.ts (only if there are main files)
   * @returns true if file was generated with content
   */
  private async generateMain(): Promise<boolean> {
    const files = await this.globModule("main");
    if (files.length === 0) return false;
    await this.generateImportsFile(files, "main.ts");
    return true;
  }

  /**
   * Generate routes.ts (only if there are route files)
   * @returns true if file was generated with content
   */
  private async generateRoutes(): Promise<boolean> {
    const files = await this.globModule("routes");
    if (files.length === 0) return false;
    await this.generateImportsFile(files, "routes.ts");
    return true;
  }

  /**
   * Generate a file with imports from all given files
   */
  private async generateImportsFile(importPaths: string[], outputFile: string): Promise<void> {
    const imports = importPaths.map((importPath) => `import "${importPath}";`);
    const content = imports.join("\n") + "\n";
    await putFileAsync(path.join(this.productionDir, outputFile), content);
  }

  /**
   * Generate the main entry point (app.ts)
   */
  private async generateEntryPoint(): Promise<void> {
    console.log(colors.yellow("   Generating entry point..."));

    // Build imports based on which files were generated
    const imports: string[] = [
      "// 1. Bootstrap (loads .env, initializes framework)",
      'import "./bootstrap";',
      "",
      "// 2. Load configs",
      'import "./config-loader";',
      "",
      "// 3. Start early-phase connectors (database, cache, logger, ...)",
      "//    so data sources, cache, etc. are ready before app code runs",
      'import { Application, connectorsManager, ConnectorLifecyclePhase } from "@warlock.js/core";',
      "await connectorsManager.startPhase(ConnectorLifecyclePhase.Early);",
    ];

    // App code uses dynamic `await import(...)` so each module's side
    // effects fire at THIS point in execution. Static imports would be
    // hoisted to module-instantiation time (before the early-phase await
    // resolves), which is exactly the bug this split is meant to fix.
    //
    // The guarantee comes from the imports being DYNAMIC — esbuild wraps a
    // dynamically-imported module in its `__esm(() => {…})` helper and runs
    // it at the await, not at instantiation. It does NOT come from
    // `splitting: true`, which only decides one-file-vs-chunks. This
    // previously said splitting was required; it is not, and `singleBundle`
    // (splitting: false) preserves the ordering.
    imports.push("", "// 4. Load app code (events, locales, main, routes)");

    if (this.generatedFiles.events) {
      imports.push('await import("./events");');
    }
    if (this.generatedFiles.locales) {
      imports.push('await import("./locales");');
    }
    if (this.generatedFiles.main) {
      imports.push('await import("./main");');
    }
    if (this.generatedFiles.routes) {
      imports.push('await import("./routes");');
    }

    // Start late-phase connectors after app code registers routes/listeners
    imports.push(
      "",
      "// 5. Start late-phase connectors (http, socket) â€” routes and",
      "//    listeners registered by app code are now ready to bind",
      "await connectorsManager.startPhase(ConnectorLifecyclePhase.Late);",
      "",
      "// 6. Signal a complete boot so `Application.onceBooted(...)` listeners fire",
      "Application.markBooted({ environment: Application.environment, runtimeStrategy: Application.runtimeStrategy });",
      "connectorsManager.shutdownOnProcessKill();",
    );

    const content = imports.join("\n") + "\n";
    await putFileAsync(path.join(this.productionDir, "app.ts"), content);
  }

  /**
   * Bundle with esbuild
   */
  private async bundle(): Promise<void> {
    console.log(colors.magenta("   Bundling with esbuild..."));

    const entryPoint = path.join(this.productionDir, "app.ts");
    const outDir = this.options.outdir!;
    const outFileName = this.options.outFile!;
    // Strip extension so entryNames produces "<base>.js" via esbuild
    const entryName = path.basename(outFileName, path.extname(outFileName));

    // `singleBundle` and `esmShim` are ours, not esbuild's — it throws on
    // unknown keys, and the user options are spread into its call verbatim.
    const singleBundle = this.options.singleBundle === true;
    const esmShim = this.options.esmShim !== false;
    // Read before deleting: the merged banner is applied AFTER the user
    // spread, so a user banner must not be lost to it or clobber the shim.
    const userBanner = this.options.banner;

    delete this.options.outFile;
    delete this.options.entryPath;
    delete this.options.singleBundle;
    delete this.options.esmShim;
    delete this.options.banner;

    await ensureDirectoryAsync(outDir);

    const alias = this.buildAliasMapFromTsconfig();

    // The user can override `format`, so gate the shim on the EFFECTIVE
    // format rather than on the default below. A CJS build already has
    // `require` and friends; injecting them there would be a redefinition.
    const isEsm = (this.options.format ?? "esm") === "esm";
    const banner = mergeBanner(userBanner, esmShim && isEsm ? ESM_INTEROP_SHIM : undefined);

    if (singleBundle) {
      console.log(
        colors.magenta(
          "   Single-bundle mode — one JS file" +
            (esmShim && isEsm ? " with the ESM interop shim" : "") +
            ". Native .node addons are still emitted alongside it.",
        ),
      );
    }


    try {
      
    await esbuild.build({
      platform: "node",
      entryPoints: [entryPoint],
      bundle: true,
      // Both are DEFAULTS the user can override — they sit before the
      // `...this.options` spread deliberately. `singleBundle` moves them,
      // an explicit `splitting`/`packages` in warlock.config.ts beats both.
      //
      // Phase ordering does not depend on `splitting`: it comes from the
      // generated app.ts using dynamic `await import(...)` (see
      // generateAppEntry above), which esbuild defers to the call site in
      // either mode. Splitting only decides one file vs chunks.
      splitting: !singleBundle,
      packages: singleBundle ? "bundle" : "external",
      minify: this.options!.minify,
      sourcemap: this.options!.sourcemap === true ? "linked" : this.options!.sourcemap,
      format: "esm",
      // Targeting a concrete Node version (not "esnext") so esbuild
      // transpiles TC39 stage 3 decorators into helpers â€” Node does not
      // implement them natively yet.
      target: ["node22"],
      outdir: outDir,
      entryNames: entryName,
      alias,
      plugins: [nativeNodeModulesPlugin],
      ...(this.options as any),
      // AFTER the spread, and intentionally so: `banner` is an object, and
      // both the config merge and this spread REPLACE it wholesale rather
      // than merging. Left as a default above, any user banner would delete
      // the shim; left to the spread, the shim would delete theirs. The
      // merge is the only form that keeps both.
      ...(banner ? { banner } : {}),
    });
    } catch (e) {
      console.log(e);
      throw e;
    }
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
  private buildAliasMapFromTsconfig(): Record<string, string> {
    tsconfigManager.init();

    const alias: Record<string, string> = {};
    const baseUrl = path.resolve(process.cwd(), tsconfigManager.baseUrl);

    for (const [from, to] of Object.entries(tsconfigManager.aliases)) {
      if (from.endsWith("/*") || !Array.isArray(to) || to.length === 0) {
        continue;
      }

      alias[from] = path.resolve(baseUrl, to[0]);
    }

    return alias;
  }
}
