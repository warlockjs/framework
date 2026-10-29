// Copy the optional templates into Core's standalone generation payloads.
//
// Two kits share one contract. The kit-agnostic hooks and prop types are
// authored once, in the shadcn template, and copied into the Mantine template
// here, so the two kits can never drift apart. Everything else in each
// template is that kit's own.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Files authored in the shadcn template and mirrored byte for byte into the Mantine one. */
export const SHARED_FILES = [
  "src/web/design-system/hooks/use-control.ts",
  "src/web/design-system/hooks/use-date-control.ts",
  "src/web/design-system/hooks/use-file-control.ts",
  "src/web/design-system/hooks/use-select-control.ts",
  "src/web/design-system/hooks/use-submit-control.ts",
  "src/web/design-system/types/control-props.ts",
];

function collect(template, directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(template, target, files);
    else
      files[path.relative(template, target).split(path.sep).join("/")] = readFileSync(
        target,
        "utf8",
      );
  }
}

function payloadFor(templateName, outputName) {
  const template = path.join(packageRoot, "templates", templateName);
  const manifest = JSON.parse(readFileSync(path.join(template, "package.json"), "utf8"));
  const files = {};
  collect(template, path.join(template, "src"), files);
  writeFileSync(
    path.resolve(packageRoot, "../core/src/generations", outputName),
    `${JSON.stringify({ ...manifest, files }, null, 2)}\n`,
  );
}

const shadcn = path.join(packageRoot, "templates/design-system");
const mantine = path.join(packageRoot, "templates/design-system-mantine");
for (const file of SHARED_FILES) {
  mkdirSync(path.dirname(path.join(mantine, file)), { recursive: true });
  copyFileSync(path.join(shadcn, file), path.join(mantine, file));
}

payloadFor("design-system", "design-system-payload.json");
payloadFor("design-system-mantine", "design-system-mantine-payload.json");
