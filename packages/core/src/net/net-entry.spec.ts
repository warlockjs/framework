import { readFileSync } from "node:fs";
import path from "node:path";
import { transformSync } from "esbuild";
import { init, parse } from "es-module-lexer";
import { describe, expect, it } from "vitest";
import * as storageSafeFetch from "../storage/utils/safe-fetch";
import * as netEntry from "./index";

/**
 * Every module reachable from `src/net/index.ts` through static imports,
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
      .map((record) => record.n)
      .filter((specifier): specifier is string => typeof specifier === "string");

    visited.set(file, specifiers);

    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;

      queue.push(path.resolve(path.dirname(file), `${specifier}.ts`));
    }
  }

  return visited;
}

describe("@warlock.js/core/net entry", () => {
  it("imports only Node built-ins and the IP classifier", async () => {
    const graph = await collectGraph(path.resolve(__dirname, "index.ts"));
    const bare = [...graph].flatMap(([file, specifiers]) =>
      specifiers
        .filter((specifier) => !specifier.startsWith("."))
        .map((specifier) => `${path.relative(__dirname, file)} -> ${specifier}`),
    );

    expect(bare).toEqual([
      `${path.join("..", "storage", "utils", "classify-ip-address.ts")} -> node:net`,
    ]);
    expect(
      [...graph.keys()].map((file) => path.relative(path.resolve(__dirname, ".."), file)).sort(),
    ).toEqual([
      path.join("net", "index.ts"),
      path.join("storage", "utils", "classify-ip-address.ts"),
    ]);
  });

  it("exports the same classifier the root barrel and storage guard use", () => {
    expect(netEntry.isPrivateOrReservedIp).toBe(storageSafeFetch.isPrivateOrReservedIp);
    expect(netEntry.isPrivateOrReservedIp("10.0.0.1")).toBe(true);
    expect(netEntry.isPrivateOrReservedIp("8.8.8.8")).toBe(false);
  });
});
