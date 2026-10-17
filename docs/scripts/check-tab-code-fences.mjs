// Keep install commands inside MDX Tabs as block code after formatting, and keep each
// package-manager tab running its own package manager's commands.
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Return lines where a TabItem opens directly onto a collapsed code fence. */
export function findCollapsedTabItemFences(source) {
  const violations = [];
  let fence;
  for (const [index, line] of source.split("\n").entries()) {
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = undefined;
      }
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    if (/<TabItem\b[^>]*>[ \t]*`{3,}/.test(line)) violations.push(index + 1);
  }
  return violations;
}

/** Command prefixes each package-manager tab may run. */
const packageManagerCommands = {
  npm: ["npm", "npx"],
  yarn: ["yarn"],
  pnpm: ["pnpm"],
};

/**
 * Return `{ line, label, command }` for each line inside an npm/yarn/pnpm `TabItem` that starts with
 * another package manager's command, such as `pnpm add` under the yarn tab.
 */
export function findForeignPackageManagerCommands(source) {
  const violations = [];
  let label;
  for (const [index, line] of source.split("\n").entries()) {
    const opening = line.match(/<TabItem\b[^>]*\blabel="([^"]+)"/);
    if (opening) label = opening[1].toLowerCase();
    const allowed = label ? packageManagerCommands[label] : undefined;
    const command = line.match(/^[ \t]*(npm|npx|yarn|pnpm)\b/)?.[1];
    if (allowed && command && !allowed.includes(command)) {
      violations.push({ line: index + 1, label, command });
    }
    if (/<\/TabItem>/.test(line)) label = undefined;
  }
  return violations;
}

async function collectMdxFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMdxFiles(target)));
    else if (entry.isFile() && extname(entry.name) === ".mdx") files.push(target);
  }
  return files.sort();
}

export async function checkTabCodeFences(contentRoot, report = console.error) {
  const files = await collectMdxFiles(contentRoot);
  let violations = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const line of findCollapsedTabItemFences(source)) {
      report(
        `${relative(contentRoot, file)}:${line}: TabItem code fence must start on its own line, after a blank line.`,
      );
      violations++;
    }
    for (const { line, label, command } of findForeignPackageManagerCommands(source)) {
      report(
        `${relative(contentRoot, file)}:${line}: the "${label}" TabItem runs a ${command} command; use ${label}.`,
      );
      violations++;
    }
  }
  return { files: files.length, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Every documentation version, including the archived ones.
  const contentRoot = fileURLToPath(new URL("../src/content/docs/v/", import.meta.url));
  const result = await checkTabCodeFences(contentRoot);
  console.log(
    `TabItem code-fence guard: ${result.files} .mdx files checked, ${result.violations} violations.`,
  );
  if (result.violations) process.exitCode = 1;
}
