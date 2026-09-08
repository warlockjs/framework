import path from "node:path";
import type { Plugin } from "esbuild";

export type WildcardPathAlias = Readonly<{
  /** The literal text before the `*` — `app/` for `"app/*"`. */
  prefix: string;
  /** The literal text after the `*`. Almost always empty. */
  suffix: string;
  /** The `paths` targets, each still carrying its own `*`, resolved against `baseUrl`. */
  targets: readonly string[];
}>;

/**
 * Turn a tsconfig `paths` map into the WILDCARD entries only, resolved
 * against `baseUrl`. Exact entries are excluded: esbuild's own `alias`
 * option handles those, and it is the better mechanism where it applies.
 */
export function collectWildcardPathAliases(
  paths: Record<string, string[] | undefined>,
  baseUrl: string,
): WildcardPathAlias[] {
  const aliases: WildcardPathAlias[] = [];

  for (const [from, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;

    const star = from.indexOf("*");
    if (star === -1) continue;

    aliases.push({
      prefix: from.slice(0, star),
      suffix: from.slice(star + 1),
      targets: targets.map((target) => path.resolve(baseUrl, target)),
    });
  }

  // Longest prefix first, which is what TypeScript itself does: with both
  // `app/*` and `app/users/*` declared, the more specific one has to be tried
  // first or it can never match.
  return aliases.sort((a, b) => b.prefix.length - a.prefix.length);
}

/**
 * The substitution TypeScript performs for one `paths` entry: whatever the
 * `*` matched, spliced into each target's own `*`.
 */
export function substituteWildcard(
  alias: WildcardPathAlias,
  specifier: string,
): string[] | undefined {
  if (!specifier.startsWith(alias.prefix)) return undefined;
  if (alias.suffix && !specifier.endsWith(alias.suffix)) return undefined;

  const matched = specifier.slice(
    alias.prefix.length,
    alias.suffix ? specifier.length - alias.suffix.length : undefined,
  );

  if (!matched) return undefined;

  return alias.targets.map((target) => target.replace("*", matched));
}

/**
 * Resolve the tsconfig `paths` entries that esbuild's `alias` option cannot
 * express — the WILDCARD ones.
 *
 * **The defect.** `buildAliasMapFromTsconfig` skips any key ending in `/*`,
 * because esbuild's `alias` takes exact package names and nothing else. That
 * is a correct statement about `alias` and it left the wildcards handled by
 * nobody: `app/*` and `web/*` are how this app's own source refers to itself
 * (`import { User } from "app/users/models/user.model"`), and under
 * `packages: "external"` every one of those survived into the bundle as a
 * bare specifier. Node then looked for a PACKAGE called `app`:
 *
 * ```
 * Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'app' imported from …/dist/app.js
 * ```
 *
 * The build reported success; the failure waited until `warlock start`.
 *
 * **The resolution is delegated, not reimplemented.** This plugin performs
 * only the substitution TypeScript defines — splice what `*` matched into the
 * target — and hands the resulting ABSOLUTE path straight back to esbuild
 * through `build.resolve`. Extension probing, `index` files, `exports` maps
 * and directory handling stay esbuild's, so a path alias resolves exactly as
 * the same file would have resolved through a relative import. A candidate
 * that does not resolve is reported as esbuild's own error rather than
 * quietly falling through to the next candidate and then to "external",
 * which is how this became a runtime failure in the first place.
 */
export function tsconfigPathAliases(options: {
  baseUrl: string;
  paths: Record<string, string[] | undefined>;
}): Plugin {
  const aliases = collectWildcardPathAliases(options.paths, options.baseUrl);

  return {
    name: "warlock:tsconfig-path-aliases",
    setup(build) {
      if (aliases.length === 0) return;

      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.warlockTsconfigPathAlias) return undefined;
        if (args.namespace !== "file" && args.namespace !== "") return undefined;
        if (args.path.startsWith(".") || path.isAbsolute(args.path)) return undefined;

        for (const alias of aliases) {
          const candidates = substituteWildcard(alias, args.path);
          if (!candidates) continue;

          let lastResult: Awaited<ReturnType<typeof build.resolve>> | undefined;

          for (const candidate of candidates) {
            const result = await build.resolve(candidate, {
              kind: args.kind,
              importer: args.importer,
              resolveDir: args.resolveDir || path.dirname(args.importer),
              pluginData: { warlockTsconfigPathAlias: true },
            });

            lastResult = result;

            if (result.errors.length === 0) {
              return { path: result.path, external: result.external, namespace: result.namespace };
            }
          }

          // The prefix matched a declared alias and NO target resolved. That
          // is a broken import, and saying so here is the whole point — the
          // alternative is the silent external that produced the
          // `Cannot find package 'app'` above.
          return lastResult ? { errors: lastResult.errors } : undefined;
        }

        return undefined;
      });
    },
  };
}
