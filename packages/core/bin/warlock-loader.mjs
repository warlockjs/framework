import { fileExistsAsync, isDirectoryAsync } from "@mongez/fs";
import { transform } from "esbuild";
import fs from "fs/promises";
import path from "path";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "url";
const configText = await fs.readFile(process.cwd() + "/tsconfig.json", "utf8");

const { config: tsconfigRaw } = ts.parseConfigFileTextToJson(
  process.cwd() + "/tsconfig.json",
  configText,
);

let manifest = {
  aliases: {},
  importLookup: {},
  directoryIndexLookup: {},
};

const manifestPath = path.resolve(process.cwd(), ".warlock/manifest.json");

const supportedExtensions = [".ts", ".tsx"];

const cacheFilesDirectory = path.resolve(process.cwd(), ".warlock/.cache");
const srcDirectory = path.resolve(process.cwd(), "src");

/**
 * Normalize Windows paths into forward slashes (for URL consistency)
 */
function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

/**
 * Load manifest file for efficient path resolution.
 */
async function loadManifest(force = false) {
  if (!force && Object.keys(manifest.importLookup).length) {
    return manifest;
  }

  try {
    const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest = {
      aliases: manifestRaw.aliases ?? {},
      importLookup: manifestRaw.importLookup ?? {},
      directoryIndexLookup: manifestRaw.directoryIndexLookup ?? {},
    };
  } catch (err) {
    console.warn(
      "⚠️ Warlock loader: could not load manifest.json — using empty lookups.",
    );
    manifest = {
      aliases: {},
      importLookup: {},
      directoryIndexLookup: {},
    };
  }

  return manifest;
}

// Load manifest initially
await loadManifest(true);

/**
 * Resolve hook — maps aliases and missing extensions using manifest.
 */
export async function resolve(specifier, context, nextResolve) {
  const { parentURL = import.meta.url } = context;

  // Skip custom resolution for node_modules - use default Node.js behavior
  if (
    specifier.includes("node_modules") ||
    parentURL.includes("node_modules")
  ) {
    return nextResolve(specifier, context, nextResolve);
  }

  const loadedManifest = await loadManifest();

  // 1. Handle tsconfig aliases using manifest
  for (const [alias, aliasInfo] of Object.entries(loadedManifest.aliases)) {
    if (specifier.startsWith(alias)) {
      const relativePart = specifier.slice(alias.length);
      const importPath = normalizePath(path.join(aliasInfo.path, relativePart));

      // Try direct import lookup first (e.g., "app/main" -> "app/main.ts")
      if (loadedManifest.importLookup[importPath]) {
        const fileInfo = loadedManifest.importLookup[importPath];
        const fullPath = path.resolve(srcDirectory, fileInfo.path);
        return {
          url: pathToFileURL(fullPath).href,
          shortCircuit: true,
        };
      }

      // Try directory index lookup (e.g., "app" -> "app/index.ts")
      if (loadedManifest.directoryIndexLookup[importPath]) {
        const fileInfo = loadedManifest.directoryIndexLookup[importPath];
        const fullPath = path.resolve(srcDirectory, fileInfo.path);
        return {
          url: pathToFileURL(fullPath).href,
          shortCircuit: true,
        };
      }

      // Fallback to file system checks if not in manifest (for new files)
      const resolvedPath = path.resolve(
        srcDirectory,
        aliasInfo.path,
        relativePart,
      );
      for (const extension of supportedExtensions) {
        if (await fileExistsAsync(resolvedPath + extension)) {
          return {
            url: pathToFileURL(resolvedPath + extension).href,
            shortCircuit: true,
          };
        }
      }

      if (await fileExistsAsync(path.resolve(resolvedPath, "index.ts"))) {
        return {
          url: pathToFileURL(path.resolve(resolvedPath, "index.ts")).href,
          shortCircuit: true,
        };
      }

      if (await fileExistsAsync(path.resolve(resolvedPath, "index.tsx"))) {
        return {
          url: pathToFileURL(path.resolve(resolvedPath, "index.tsx")).href,
          shortCircuit: true,
        };
      }

      throw new Error(`Failed to resolve file: ${resolvedPath}`);
    }
  }

  // 2. Handle relative imports using manifest
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parentPath = fileURLToPath(parentURL);
    const filePath = path.resolve(path.dirname(parentPath), specifier);
    const extension = path.extname(filePath);

    // If already has extension, use it directly
    if (supportedExtensions.includes(extension)) {
      return { url: pathToFileURL(filePath).href, shortCircuit: true };
    }

    // Calculate the import path relative to src directory
    const relativeToSrc = normalizePath(path.relative(srcDirectory, filePath));

    // Try direct import lookup
    if (loadedManifest.importLookup[relativeToSrc]) {
      const fileInfo = loadedManifest.importLookup[relativeToSrc];
      const fullPath = path.resolve(srcDirectory, fileInfo.path);
      return {
        url: pathToFileURL(fullPath).href,
        shortCircuit: true,
      };
    }

    // Try directory index lookup
    if (loadedManifest.directoryIndexLookup[relativeToSrc]) {
      const fileInfo = loadedManifest.directoryIndexLookup[relativeToSrc];
      const fullPath = path.resolve(srcDirectory, fileInfo.path);
      return {
        url: pathToFileURL(fullPath).href,
        shortCircuit: true,
      };
    }

    // Fallback to file system checks for new files
    for (const ext of supportedExtensions) {
      const fullPath = filePath + ext;
      if (await fileExistsAsync(fullPath)) {
        return { url: pathToFileURL(fullPath).href, shortCircuit: true };
      }
    }

    if (await isDirectoryAsync(filePath)) {
      return {
        url: pathToFileURL(path.resolve(filePath, "index.ts")).href,
        shortCircuit: true,
      };
    }

    throw new Error(`Failed to resolve file: ${filePath}`);
  }

  // 3. Fallback to Node default resolver
  return nextResolve(specifier, context, nextResolve);
}

/**
 * Load hook — transpiles TS/TSX into ESM on the fly.
 */
export async function load(url, context, nextLoad) {
  if (url.includes("node_modules")) {
    return nextLoad(url, context, nextLoad);
  }

  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const filePath = fileURLToPath(url);
    const relativePath = path
      .relative(process.cwd(), filePath)
      .replace(/\\/g, "/");

    // we will create a cache file name by replacing / to - so we can store it in a single file
    // make sure to trim any . dots at beginning of the path
    const cacheFileName = relativePath.replace(/^\./, "").replace(/\//g, "-");

    // Fallback to individual file read (for new files not in bundle)
    try {
      const cachedFile = await fs.readFile(
        cacheFilesDirectory + "/" + cacheFileName,
        "utf8",
      );

      return {
        format: "module",
        source: cachedFile,
        shortCircuit: true,
      };
    } catch (error) {
      // File not in cache at all, transpile it
      const source = await fs.readFile(filePath, "utf8");

      const { code } = await transform(source, {
        loader: url.endsWith(".tsx") ? "tsx" : "ts",
        format: "esm",
        // sourcemap: "inline",
        sourcemap: true,
        tsconfigRaw,
      });

      // if code length is zero, it means this was just an empty file or a types only file
      let finalCode = code;
      if (code.length === 0) {
        finalCode = "/*_EMPTY_FILE_*/";
      }

      fs.writeFile(path.resolve(cacheFilesDirectory, cacheFileName), finalCode);

      return {
        format: "module",
        source: code,
        shortCircuit: true,
      };
    }
  }

  return nextLoad(url, context, nextLoad);
}
