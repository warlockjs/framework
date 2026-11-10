import { scanTranslationSource } from "../../localization/translation-usage";
import { createProblem, type ToolingProblem } from "../problem";

/** Application code that renders on the client: everything under `src/web` except setup and test files. */
const WEB_CLIENT_FILE = /^src\/web\/.+\.[cm]?[jt]sx?$/;
const SETUP_OR_TEST_FILE = /\.(?:setup|test|spec)\.[cm]?[jt]sx?$/i;

/**
 * `WL9104`: a translation lookup whose key is only known at runtime.
 *
 * A page ships the translation keys its client code can reach, found by
 * reading the code. A key computed at runtime (`trans(key)`, a translator
 * passed on as a value) defeats that reading, so the page falls back to every
 * group. A `config.translations` declaration only adds keys; one computed
 * lookup anywhere in the page's graph (page, layouts, root, error pages) still
 * ships every group. The fix is a literal key or a static-prefix template.
 */
export function translationProblems(relativePath: string, source: string): ToolingProblem[] {
  if (!WEB_CLIENT_FILE.test(relativePath) || SETUP_OR_TEST_FILE.test(relativePath)) return [];

  return scanTranslationSource(relativePath, source).usage.dynamicSites.map((site) =>
    createProblem({
      code: "WL9104",
      source: "convention",
      severity: "warning",
      message:
        `Translation key \`${site.text}\` (${relativePath}:${site.line}) is computed at runtime, so a page that renders it ships every ` +
        "translation group. Use a literal key or a static-prefix template such as `statuses.${status}`; " +
        "`config.translations` only adds keys and does not remove the fallback. " +
        "A hook should call `useTrans()` itself instead of receiving `t`.",
      file: relativePath,
      line: site.line,
      column: site.column,
    }),
  );
}
