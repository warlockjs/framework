// Keep install commands inside MDX Tabs as block code after formatting.
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
    for (const line of findCollapsedTabItemFences(await readFile(file, "utf8"))) {
      report(
        `${relative(contentRoot, file)}:${line}: TabItem code fence must start on its own line, after a blank line.`,
      );
      violations++;
    }
  }
  return { files: files.length, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const contentRoot = fileURLToPath(new URL("../src/content/docs/v/latest/", import.meta.url));
  const result = await checkTabCodeFences(contentRoot);
  console.log(
    `TabItem code-fence guard: ${result.files} .mdx files checked, ${result.violations} collapsed fences.`,
  );
  if (result.violations) process.exitCode = 1;
}
