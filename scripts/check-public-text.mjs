import { readFileSync, readdirSync } from "node:fs";
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

export function findPublicTextIssues(
  repositoryRoot = root,
  privateAppNames = config.privateAppNames,
) {
  const patterns = [
    /\b(?:WR|FW)-[0-9]{2,3}\b/g,
    ...privateAppNames.map(
      (name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
    ),
  ];
  const issues = [];
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "dist", ".git"].includes(entry.name)) scan(file);
      } else if (entry.isFile()) {
        const bytes = readFileSync(file);
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
    }
  }
  scan(path.join(repositoryRoot, "packages"));
  scan(path.join(repositoryRoot, "docs/src"));
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
