import type { Codemod, CodemodOutput } from "../types";
import { parseVersion } from "../version";
import { manualAt, replaceNode } from "./helpers";

/**
 * The newest releases that are at least two weeks old on the day 5.36 shipped;
 * `warlock add test` and `warlock add web` install the same ones.
 */
const TARGETS: Record<string, { major: number; version: string }> = {
  vite: { major: 8, version: "8.3.3" },
  vitest: { major: 5, version: "5.0.3" },
  "@vitest/coverage-v8": { major: 5, version: "5.0.3" },
  "@vitest/coverage-istanbul": { major: 5, version: "5.0.3" },
  "@vitest/ui": { major: 5, version: "5.0.3" },
  "@vitejs/plugin-react": { major: 6, version: "6.1.2" },
};

const MIGRATION_GUIDES = "https://vite.dev/guide/migration and https://vitest.dev/guide/migration";

/** Version specs that are not a plain registry range and must not be rewritten. */
const NON_REGISTRY_SPEC =
  /^(workspace:|file:|link:|portal:|git|github:|https?:|npm:)|^\*$|^latest$/;

/** Entry points Vitest 5 removed. `vitest/runners` is handled separately. */
const REMOVED_ENTRY_POINTS = new Set([
  "vitest/coverage",
  "vitest/reporters",
  "vitest/environments",
  "vitest/snapshot",
  "vitest/suite",
  "vitest/mocker",
  "vitest/internal/module-runner",
]);

const VITE_CONFIG_FILE = /^vite(st)?\.config\.(ts|mts|cts|js|mjs|cjs)$/;

type PackageJson = Record<string, unknown> & {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  resolutions?: Record<string, unknown>;
};

function serialize(original: string, value: unknown): string {
  const indent = /^[ \t]+(?=")/m.exec(original)?.[0];
  const json = indent ? JSON.stringify(value, null, indent) : JSON.stringify(value);
  return json + (original.endsWith("\n") ? "\n" : "");
}

function lineOf(source: string, needle: string): number {
  const index = source.indexOf(needle);
  return index < 0 ? 1 : source.slice(0, index).split("\n").length;
}

/** The spec moved to `target`, keeping its `^`/`~`/exact style; undefined when it already allows it. */
function upgradedSpec(spec: string, target: { major: number; version: string }) {
  if (NON_REGISTRY_SPEC.test(spec)) return undefined;
  const parsed = parseVersion(spec);
  // `>=7.3.5 <8` and ranges like it are rewritten too: the lower bound is what is read.
  if (!parsed || parsed[0] >= target.major) return undefined;
  const prefix = /^[\^~]/.exec(spec)?.[0] ?? (/^\d/.test(spec) ? "" : "^");
  return `${prefix}${target.version}`;
}

/**
 * 5.36: Vite 8 (Rolldown), Vitest 5 and `@vitejs/plugin-react` 6 are one
 * family and must move together.
 *
 * - package.json: raises `vite`, `vitest`, `@vitest/*` and
 *   `@vitejs/plugin-react` (dependencies, devDependencies, `overrides` and
 *   `resolutions`) to the supported majors.
 * - `src/test-runner.ts`-style runners: Vitest 5 has no `vitest/runners`; the
 *   runner class is `TestRunner`, exported from `vitest`, and
 *   `onCleanupWorkerContext` is an optional property.
 * - Lists removed Vitest entry points, a top-level `esbuild` option, and object
 *   `manualChunks` in Vite configs for review.
 */
export const viteVitest: Codemod = {
  id: "vite-8-vitest-5",
  version: "5.36.0",
  package: "@warlock.js/core",
  title: "Move to Vite 8, Vitest 5 and @vitejs/plugin-react 6",
  skill: "upgrade-from-5-29",
  run(context) {
    const { Node, SyntaxKind } = context.tsMorph;
    const output: CodemodOutput = { edits: [], manual: [] };

    const source = context.text.read("package.json");
    if (source !== undefined) {
      const pkg = JSON.parse(source) as PackageJson;
      const changes: { name: string; from: string; to: string }[] = [];
      for (const field of [
        "dependencies",
        "devDependencies",
        "overrides",
        "resolutions",
      ] as const) {
        const entries = pkg[field];
        if (!entries) continue;
        for (const [name, target] of Object.entries(TARGETS)) {
          const spec = entries[name];
          if (typeof spec !== "string") continue;
          const next = upgradedSpec(spec, target);
          if (!next) continue;
          entries[name] = next;
          changes.push({
            name:
              field === "dependencies" || field === "devDependencies" ? name : `${field}.${name}`,
            from: spec,
            to: next,
          });
        }
      }
      const first = changes[0];
      if (first) {
        context.text.write("package.json", serialize(source, pkg), {
          line: lineOf(source, `"${first.name.replace(/^[a-z]+\./, "")}"`),
          description: changes
            .map((change) => `${change.name} ${change.from} → ${change.to}`)
            .join(", "),
        });
      }
    }

    for (const sourceFile of context.sourceFiles) {
      for (const declaration of sourceFile.getImportDeclarations()) {
        const moduleName = declaration.getModuleSpecifierValue();

        if (REMOVED_ENTRY_POINTS.has(moduleName)) {
          output.manual.push(
            manualAt(
              context,
              declaration,
              `Vitest 5 removed the "${moduleName}" entry point. Import from "vitest" or "vitest/node" instead; see ${MIGRATION_GUIDES}.`,
            ),
          );
          continue;
        }
        if (moduleName !== "vitest/runners") continue;

        const specifiers = declaration.getNamedImports();
        const runner = specifiers.find((specifier) => specifier.getName() === "VitestTestRunner");
        if (!runner || specifiers.length !== 1 || declaration.getDefaultImport()) {
          output.manual.push(
            manualAt(
              context,
              declaration,
              'Vitest 5 removed "vitest/runners". Import the runner class as `TestRunner` from "vitest"; benchmark runners no longer exist.',
            ),
          );
          continue;
        }

        const alias = runner.getAliasNode()?.getText();
        output.edits.push(
          replaceNode(
            context,
            declaration,
            alias
              ? `import { TestRunner as ${alias} } from "vitest";`
              : 'import { TestRunner } from "vitest";',
            'imported the runner as TestRunner from "vitest"',
          ),
        );

        if (!alias) {
          for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
            if (identifier.getText() !== "VitestTestRunner") continue;
            if (identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
            output.edits.push(
              replaceNode(
                context,
                identifier,
                "TestRunner",
                "renamed VitestTestRunner to TestRunner",
              ),
            );
          }
        }

        for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const callee = call.getExpression();
          if (
            !Node.isPropertyAccessExpression(callee) ||
            callee.getName() !== "onCleanupWorkerContext" ||
            call.getQuestionDotTokenNode()
          ) {
            continue;
          }
          output.edits.push(
            replaceNode(
              context,
              callee,
              `${callee.getText()}?.`,
              "onCleanupWorkerContext is optional in Vitest 5 (absent in vm pools)",
            ),
          );
        }
      }
    }

    for (const file of context.text.list()) {
      if (!VITE_CONFIG_FILE.test(file)) continue;
      const config = context.text.read(file);
      if (config === undefined) continue;
      const lines = config.split("\n");
      lines.forEach((text, index) => {
        const line = index + 1;
        if (/^\s*esbuild\s*:/.test(text)) {
          output.manual.push({
            file,
            line,
            hint: "Vite 8 transforms TypeScript and JSX with Oxc: move this `esbuild` option to `oxc` (jsx, define, include/exclude convert; `target` does not). Oxc does not lower native decorators; keep `lowerStage3Decorators()` in `plugins` for decorated modules.",
          });
        }
        if (/\bmanualChunks\s*:\s*\{/.test(text)) {
          output.manual.push({
            file,
            line,
            hint: "Vite 8 (Rolldown) removed the object form of `output.manualChunks`. Use `output.codeSplitting.groups` with `name` and `test`.",
          });
        }
      });
    }

    return output;
  },
};
