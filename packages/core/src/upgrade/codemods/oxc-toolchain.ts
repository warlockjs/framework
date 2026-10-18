import type { Codemod, CodemodContext, CodemodOutput } from "../types";
import { TOOLCHAIN_TEMPLATES } from "./toolchain-templates";

/** Snapshots ship with core; parity specs keep them aligned with create-warlock. */
function asset(name: string): string {
  const content = TOOLCHAIN_TEMPLATES[name];
  if (content === undefined) throw new Error(`Unknown toolchain template: ${name}`);
  return content;
}

export const OXC_VERSIONS = { oxlint: "1.88.0", oxfmt: "0.73.0", typescript: "7.0.2" };
export const OXC_SCRIPTS = {
  lint: "oxlint --fix ./src --max-warnings=0",
  "lint:check": "oxlint ./src --max-warnings=0",
  format: "oxfmt --ignore-path .gitignore --ignore-path .oxfmtignore --write ./src",
  "format:check": "oxfmt --ignore-path .gitignore --ignore-path .oxfmtignore --check ./src",
};

function legacyDependency(name: string): boolean {
  return (
    /^(eslint|prettier|@types\/prettier|eslint-config-prettier)$/.test(name) ||
    name.startsWith("@typescript-eslint/") ||
    /(?:^|\/)eslint-plugin-/.test(name) ||
    /(?:^|\/)prettier-plugin-/.test(name) ||
    name.startsWith("@prettier/plugin-")
  );
}

function sameGenerated(source: string, expected: string): boolean {
  // JSON may have been reformatted by the app; compare its data. Executable
  // configs are deliberately exact (apart from line endings/trailing space).
  try {
    return JSON.stringify(JSON.parse(source)) === JSON.stringify(JSON.parse(expected));
  } catch {
    return source.replace(/\r\n/g, "\n").trim() === expected.replace(/\r\n/g, "\n").trim();
  }
}

function review(output: CodemodOutput, file: string, hint: string, line = 1): void {
  output.manual.push({ file, line, hint });
}

function migrateHealthSwitches(context: CodemodContext, output: CodemodOutput): void {
  const file = "warlock.config.ts";
  const source = context.text.read(file);
  if (source === undefined) return;
  const project = new context.tsMorph.Project({ useInMemoryFileSystem: true });
  const config = project.createSourceFile(file, source);
  const switches = config
    .getDescendantsOfKind(context.tsMorph.SyntaxKind.PropertyAssignment)
    .filter((property) => property.getName() === "healthCheckers");
  let changed = false;
  for (const property of switches) {
    const value = property.getInitializer();
    if (!value || !context.tsMorph.Node.isObjectLiteralExpression(value)) {
      if (value?.getText() !== "false")
        review(
          output,
          file,
          "Review custom healthCheckers; remove ESLint checkers and enable Oxlint. ESLint support is removed in 5.34.0.",
          property.getStartLineNumber(),
        );
      continue;
    }
    for (const spread of value.getProperties().filter(context.tsMorph.Node.isSpreadAssignment)) {
      review(
        output,
        file,
        "Review spread healthCheckers options; set eslint: false and oxlint: true explicitly after the spread.",
        spread.getStartLineNumber(),
      );
    }
    for (const [name, next] of [
      ["eslint", "false"],
      ["oxlint", "true"],
    ] as const) {
      const option = value.getProperty(name);
      if (!option) continue;
      if (
        !context.tsMorph.Node.isPropertyAssignment(option) ||
        !["true", "false"].includes(option.getInitializer()?.getText() ?? "")
      ) {
        review(
          output,
          file,
          `Set healthCheckers.${name} to ${next} after reviewing this computed option.`,
          option.getStartLineNumber(),
        );
        continue;
      }
      if (option.getInitializer()?.getText() !== next) {
        option.setInitializer(next);
        changed = true;
      }
    }
  }
  if (changed)
    context.text.write(file, config.getFullText(), {
      line: 1,
      description: "Select Oxlint instead of ESLint for background health checks",
    });
}

export const oxcToolchain: Codemod = {
  id: "oxc-toolchain",
  version: "5.33.0",
  package: "@warlock.js/core",
  title: "Migrate ESLint and Prettier to Oxlint and Oxfmt",
  skill: "upgrade-from-5-29",
  run(context) {
    const output: CodemodOutput = { edits: [], manual: [] };
    const source = context.text.read("package.json");
    if (source === undefined) return output;
    const pkg = JSON.parse(source) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const legacyFiles = context.text
      .list()
      .filter((file) =>
        /^(eslint\.config\..+|\.eslintrc(?:\..+)?|\.prettierrc(?:\..+)?|prettier\.config\..+|\.prettierignore)$/.test(
          file,
        ),
      );
    const dependencies = [pkg.dependencies, pkg.devDependencies];
    const legacyScripts = Object.values(pkg.scripts ?? {}).some((script) =>
      /\b(?:eslint|prettier)\b/.test(script),
    );
    if (
      !legacyFiles.length &&
      !legacyScripts &&
      !dependencies.some((deps) => Object.keys(deps ?? {}).some(legacyDependency))
    )
      return output;

    const change = {
      line: 1,
      description: "Replace ESLint/Prettier with the default Oxlint/Oxfmt toolchain",
    };
    for (const deps of dependencies) {
      for (const name of Object.keys(deps ?? {})) {
        if (deps && (legacyDependency(name) || name in OXC_VERSIONS)) delete deps[name];
      }
    }
    pkg.devDependencies = { ...pkg.devDependencies, ...OXC_VERSIONS };
    pkg.scripts = { ...pkg.scripts, ...OXC_SCRIPTS };
    if (/\beslint\b/.test(pkg.scripts.fix ?? "")) pkg.scripts.fix = OXC_SCRIPTS.lint;
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (/\b(?:eslint|prettier)\b/.test(command))
        review(
          output,
          "package.json",
          `Replace the custom ${name} script (${command}) with oxlint or oxfmt; the legacy tools have been removed from dependencies.`,
        );
    }
    context.text.write("package.json", `${JSON.stringify(pkg, null, 2)}\n`, change);

    for (const file of [".oxlintrc.json", ".oxfmtrc.json"]) {
      if (context.text.read(file) === undefined)
        context.text.write(file, asset(file.slice(1)), change);
    }
    for (const file of legacyFiles) {
      const content = context.text.read(file);
      const known = ["eslint.config.js", ".prettierrc.json", ".prettierignore"].includes(file);
      if (content === undefined) continue;
      if (!known || !sameGenerated(content, asset(`legacy-${file.replace(/^\./, "")}`))) {
        review(
          output,
          file,
          "Customized legacy config retained. Port its rules, plugins, formatting or ignore patterns to .oxlintrc.json / .oxfmtrc.json / .oxfmtignore, then remove this file. Legacy support is removed in 5.34.0.",
        );
        continue;
      }
      if (file === ".prettierignore") {
        const existing = context.text.read(".oxfmtignore");
        if (existing === undefined) context.text.write(".oxfmtignore", content, change);
        else if (existing.trim() !== content.trim()) {
          review(
            output,
            file,
            "Merge these ignore patterns into the existing .oxfmtignore, then remove .prettierignore.",
          );
          continue;
        }
      }
      context.text.remove(file, change);
    }
    // Oxfmt 0.73 uses .prettierignore by default (verified with --help).
    // Explicit script ignore paths make the migrated .oxfmtignore effective.
    if (context.text.read(".oxfmtignore") === undefined) {
      context.text.write(".oxfmtignore", "node_modules\ndist\n", change);
    }
    for (const name of ["settings.json", "extensions.json"]) {
      const file = `.vscode/${name}`;
      const content = context.text.read(file);
      if (content === undefined) continue;
      if (name === "settings.json" && sameGenerated(content, asset(`legacy-vscode-${name}`)))
        context.text.write(file, asset(`oxc-vscode-${name}`), change);
      else
        review(
          output,
          file,
          "Review editor settings: select oxc.oxc-vscode as the formatter, enable source.fixAll.oxc and remove ESLint/Prettier extension recommendations.",
        );
    }
    migrateHealthSwitches(context, output);
    return output;
  },
};
