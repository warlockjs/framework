// Copy the optional template into Core's standalone generation payload.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = path.join(packageRoot, "templates/design-system");
const { dependencies } = JSON.parse(readFileSync(path.join(template, "package.json"), "utf8"));
const files = {};
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else
      files[path.relative(template, target).split(path.sep).join("/")] = readFileSync(
        target,
        "utf8",
      );
  }
}
collect(path.join(template, "src"));
writeFileSync(
  path.resolve(packageRoot, "../core/src/generations/design-system-payload.json"),
  `${JSON.stringify({ dependencies, files }, null, 2)}\n`,
);
