import { colors } from "@mongez/copper";
import { getFileAsync, putFileAsync } from "@mongez/fs";
import { debounce } from "@mongez/reinforcements";
import chokidar from "chokidar";
import dayjs from "dayjs";
import { transform } from "esbuild";
import path from "path";
import { buildHttpApp, moduleBuilders } from "../builder/build-http-app";
import {
  checkSingleFile,
  configure as configureCodeQuality,
  scanProject,
} from "../code-quality";
import { command } from "../console/command-builder";
import { srcPath } from "../utils";
import { restartServer } from "./http-server-starter";
import { httpLog } from "./serve-log";

// Configure code quality checker (you can change these settings)
configureCodeQuality({
  displayStrategy: "sequential", // Options: "sequential", "combined", "typescript-only", "eslint-only", "silent"
  showSuccessMessages: true,
  showWarnings: true,
  showErrors: true,
  showCodeSnippets: true,
  contextLines: 2,
  enableInitialScan: true, // Run full scan on startup
});

export async function transformSingleFileAndCacheIt(filePath: string) {
  const relativePath = path
    .relative(process.cwd(), filePath)
    .replace(/\\/g, "/");
  const cacheFileName = relativePath.replace(/^\./, "").replace(/\//g, "-");
  const cacheFilePath = path.resolve(
    process.cwd(),
    ".warlock/.cache",
    cacheFileName,
  );

  const content = await getFileAsync(filePath);

  // Check code quality (TypeScript + ESLint, async, non-blocking)
  checkSingleFile(filePath);

  const { code } = await transform(content, {
    loader: filePath.endsWith(".tsx") ? "tsx" : "ts",
    format: "esm",
    sourcemap: undefined,
    target: "esnext",
    jsx: "automatic", // React/JSX support
    logLevel: "silent", // Prevent esbuild spam in console
  });

  // if code length is zero, it means this was just an empty file or a types only file
  let finalCode = code;
  if (code.length === 0) {
    finalCode = "/*_EMPTY_FILE_*/";
  }

  // Write to individual cache file
  await putFileAsync(cacheFilePath, finalCode, "utf8");
}

const log = httpLog;

export async function startHttpApp() {
  log.info("http", "server", "Starting development server...");
  await buildHttpApp();

  await restartServer();

  // Run initial code quality scan (async, background)
  scanProject(srcPath());

  const watcher = chokidar.watch(srcPath(), {
    ignoreInitial: true,
    ignored: ["node_modules/**", "dist/**"],
  });

  const rebuild = debounce(async (event, filePath) => {
    console.log(
      colors.yellowBright(
        `${dayjs().format("YYYY-MM-DD HH:mm:ss")} Restarting development server...`,
      ),
    );
    if (["add", "unlink"].includes(event)) {
      // Rebuild manifest when files are added or removed
      moduleBuilders.mainfest();
      if (filePath.includes("routes.ts")) await moduleBuilders.routes();
      if (filePath.endsWith("main.ts")) await moduleBuilders.main();
      // Regenerate config types when config files change
      if (
        filePath.includes("src/config/") ||
        filePath.includes("src\\config\\")
      ) {
        moduleBuilders.configTypes();
      }
    }

    if (["add", "change"].includes(event)) {
      // recache the file
      await transformSingleFileAndCacheIt(filePath);
    }

    await restartServer();
  }, 50);

  watcher
    .on("add", filePath => rebuild("add", filePath))
    .on("change", filePath => rebuild("change", filePath))
    .on("unlink", filePath => rebuild("unlink", filePath))
    .on("unlinkDir", filePath => rebuild("unlinkDir", filePath));
}

export function registerHttpDevelopmentServerCommand() {
  return command("dev").action(startHttpApp).preload("watch");
}
