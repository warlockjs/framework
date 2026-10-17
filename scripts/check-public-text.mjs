import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  readFileSync(new URL("./public-text.config.json", import.meta.url), "utf8"),
);
if (
  !Array.isArray(config.privateAppNames) ||
  config.privateAppNames.some((name) => typeof name !== "string" || !name.trim())
) {
  throw new Error(
    "public-text.config.json must contain a privateAppNames array of non-empty strings",
  );
}

/** Roots that must exist; a missing one is an error. */
const requiredRoots = ["packages", "docs/src"];
/** Roots scanned when present (the deployed llms files live here). */
const optionalRoots = ["docs/public"];

/**
 * Tracked files under the scan roots, or `undefined` when `repositoryRoot` is not the top of a git
 * work tree (or git is unavailable). Scanning the tracked list keeps local build output such as
 * `esm/`, `cjs/`, `coverage/` or `.astro/` out of the check.
 */
function trackedFiles(repositoryRoot) {
  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (realpathSync(topLevel) !== realpathSync(repositoryRoot)) return undefined;
    const output = execFileSync(
      "git",
      ["ls-files", "-z", "--", ...requiredRoots, ...optionalRoots],
      { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    return output
      .split("\0")
      .filter(Boolean)
      .map((file) => path.join(repositoryRoot, file));
  } catch {
    return undefined;
  }
}

function walkedFiles(repositoryRoot) {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "dist", ".git"].includes(entry.name)) walk(file);
      } else if (entry.isFile()) {
        files.push(file);
      }
    }
  }
  for (const directory of requiredRoots) walk(path.join(repositoryRoot, directory));
  for (const directory of optionalRoots) {
    const absolute = path.join(repositoryRoot, directory);
    if (existsSync(absolute)) walk(absolute);
  }
  return files;
}

export function findPublicTextIssues(
  repositoryRoot = root,
  privateAppNames = config.privateAppNames,
) {
  const patterns = [
    /\b(?:WR|FW)-[0-9]{2,3}\b/gi,
    ...privateAppNames.map(
      (name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
    ),
  ];
  for (const directory of requiredRoots) {
    // Fails with ENOENT, like the walk, so a misconfigured root is never reported as clean.
    statSync(path.join(repositoryRoot, directory));
  }
  const files = trackedFiles(repositoryRoot) ?? walkedFiles(repositoryRoot);
  const issues = [];
  for (const file of files) {
    let bytes;
    try {
      if (!statSync(file).isFile()) continue;
      bytes = readFileSync(file);
    } catch (error) {
      // A tracked file deleted in the working tree has nothing left to publish.
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (bytes.includes(0)) continue;
    const lines = bytes.toString("utf8").split("\n");
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        for (const match of line.matchAll(pattern)) {
          issues.push({
            file: path.relative(repositoryRoot, file).split(path.sep).join("/"),
            line: index + 1,
            match: match[0],
          });
        }
      }
    });
  }
  return issues;
}

export function assertPublicTextClean(
  repositoryRoot = root,
  privateAppNames = config.privateAppNames,
) {
  const issues = findPublicTextIssues(repositoryRoot, privateAppNames);
  if (issues.length) {
    throw new Error(
      `Private references in public text:\n${issues.map((issue) => `${issue.file}:${issue.line}: ${issue.match}`).join("\n")}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assertPublicTextClean();
    console.log("Public text: no internal identifiers or configured private application names.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
