import { readFileSync } from "node:fs";
import path from "node:path";
import { transformSync } from "esbuild";
import { init, parse } from "es-module-lexer";
import { describe, expect, it } from "vitest";
import * as rootHttpErrors from "../http/errors";
import * as errorsEntry from "./index";

/**
 * Every module reachable from `src/errors/index.ts` through static imports,
 * with the specifiers each one imports.
 */
async function collectGraph(entry: string) {
  await init;

  const visited = new Map<string, string[]>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;

    if (visited.has(file)) continue;

    // Type-only imports vanish here exactly as they do in the published build.
    const { code } = transformSync(readFileSync(file, "utf8"), { loader: "ts", format: "esm" });
    const [imports] = parse(code);
    const specifiers = imports
      .map((entry) => entry.n)
      .filter((specifier): specifier is string => typeof specifier === "string");

    visited.set(file, specifiers);

    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;

      queue.push(path.resolve(path.dirname(file), `${specifier}.ts`));
    }
  }

  return visited;
}

describe("@warlock.js/core/errors entry", () => {
  it("imports no package and nothing outside the error modules", async () => {
    const graph = await collectGraph(path.resolve(__dirname, "index.ts"));
    const bare = [...graph].flatMap(([file, specifiers]) =>
      specifiers
        .filter((specifier) => !specifier.startsWith("."))
        .map((specifier) => `${path.relative(__dirname, file)} -> ${specifier}`),
    );

    expect(bare).toEqual([]);
    expect(
      [...graph.keys()].map((file) => path.relative(path.resolve(__dirname, ".."), file)).sort(),
    ).toEqual([path.join("errors", "index.ts"), path.join("http", "errors", "errors.ts")]);
  });

  it("exports the same classes as the root barrel", () => {
    expect(errorsEntry.HttpError).toBe(rootHttpErrors.HttpError);
    expect(errorsEntry.BadRequestError).toBe(rootHttpErrors.BadRequestError);
    expect(new errorsEntry.ResourceNotFoundError("x")).toBeInstanceOf(rootHttpErrors.HttpError);
  });
});
