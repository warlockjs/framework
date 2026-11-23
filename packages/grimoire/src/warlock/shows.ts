/**
 * `shows()`: run one browser scene per language of the app and keep a
 * screenshot of each, as visual proof of one acceptance criterion.
 *
 * ```ts
 * import { shows } from "@warlock.js/grimoire/warlock";
 *
 * // @shows contact/send-message AC-2
 * await shows(context, "contact/send-message AC-2", async ({ page, path }) => {
 *   await page.goto(path("/"));
 * });
 * ```
 *
 * This module is reached from `warlock.config.ts`: it imports node builtins
 * and types only; the Grimoire modules that read the project are loaded with
 * `import()` when a scene runs.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserPage, E2EContext, Viewport } from "@warlock.js/core/e2e";
import type { ScreenshotMode } from "../contracts/settings";
import type { ShotCapture } from "../contracts/shots";
import { localizedPath, readAppLanguages, readLocaleRouting } from "./languages";

/** What a scene receives. */
export type ShowsScene = {
  page: BrowserPage;
  /** The language this run shows; `""` when the app names none. */
  language: string;
  /** The URL path of a page in this language (`path("/")` is `/ar` under a prefix strategy). */
  path(pagePath: string): string;
  /** The context's `step` for naming parts of the scene. */
  step: E2EContext["step"];
};

/** Options of `shows()`. */
export type ShowsOptions = {
  /** Selectors hidden (`visibility: hidden`) just before the capture, for text that changes on every run. */
  mask?: string[];
  /** Set this viewport before the scene runs. */
  viewport?: Viewport;
};

const REF = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*) (AC-\d+)$/;
const MODES: readonly ScreenshotMode[] = ["changed", "all", "off"];

/** What a `shows()` run reads from the project once per process. */
type Setup = {
  mode: ScreenshotMode;
  languages: string[];
  /** `null` when every feature counts as touched. */
  touched: Set<string> | null;
};

/** The touched features per project, read once per process (git is asked once, not once per scene). */
const touchedCache = new Map<string, Promise<Set<string> | null>>();

/** Forget what was read from git and the book (specs). */
export function resetShowsCache(): void {
  touchedCache.clear();
}

async function loadSetup(root: string): Promise<Setup> {
  const [{ parseSettings, resolveSettings }, { FindingSink }] = await Promise.all([
    import("../written/settings"),
    import("../written/sink"),
  ]);
  let text: string | null = null;

  try {
    text = await readFile(path.join(root, "grimoire", "settings.md"), "utf8");
  } catch {
    // No settings file: the defaults apply.
  }

  const settings = resolveSettings(
    text === null ? null : parseSettings("grimoire/settings.md", text, new FindingSink()),
    await readAppLanguages(root),
  );
  const fromEnv = process.env.GRIMOIRE_SHOTS;
  const mode = MODES.find((value) => value === fromEnv) ?? settings.screenshots;

  let touched = touchedCache.get(root);

  if (mode === "changed" && touched === undefined) {
    touched = touchedBy(root);
    touchedCache.set(root, touched);
  }

  return {
    mode,
    languages: settings.languages,
    touched: mode === "changed" ? ((await touched) ?? null) : null,
  };
}

/** The features the change touches; `null` (everything) when git or the book cannot say. */
async function touchedBy(root: string): Promise<Set<string> | null> {
  try {
    const [{ readDerived }, { grimoireVersion }, { ownersFrom, touchedFeatures }] =
      await Promise.all([
        import("../workspace/derived"),
        import("../book/build"),
        import("../shots/touched"),
      ]);
    const derived = await readDerived(root, grimoireVersion());

    if (derived === null) return null;

    return await touchedFeatures(root, ownersFrom(derived.snapshot.ownership));
  } catch {
    return null;
  }
}

/** Whether the flow's front matter says `screenshots: false`. */
async function optedOut(root: string, feature: string, flow: string): Promise<boolean> {
  try {
    const text = await readFile(
      path.join(root, "grimoire", "features", feature, "flows", `${flow}.md`),
      "utf8",
    );
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";

    return /^screenshots:\s*["']?false["']?\s*$/m.test(front);
  } catch {
    return false;
  }
}

/** The project-relative file that called `shows()`, read from the stack; `""` when it cannot tell. */
function callerFile(root: string): string {
  const here = fileURLToPath(import.meta.url);

  for (const line of (new Error().stack ?? "").split("\n").slice(1)) {
    const found = /(?:file:\/\/)?(\/[^\s()]+?\.[cm]?[jt]sx?)(?::\d+){0,2}\)?$/.exec(line.trim());
    const file = found?.[1];

    if (file === undefined || file === here || file.includes("node_modules")) continue;

    const relative = path.relative(root, file).split(path.sep).join("/");

    return relative.startsWith("..") ? "" : relative;
  }

  return "";
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function maskSelectors(page: BrowserPage, selectors: readonly string[]): Promise<void> {
  if (selectors.length === 0) return;

  await page.evaluate(
    `(() => { for (const selector of ${JSON.stringify(selectors)}) for (const element of document.querySelectorAll(selector)) element.style.visibility = "hidden"; return true; })()`,
  );
}

/**
 * Run `scene` once per language of the app and save a screenshot of each
 * under `grimoire/screenshots/captured/<feature>/<flow>/<AC-n>.<language>.png`.
 * The mode comes from `GRIMOIRE_SHOTS`, else `grimoire/settings.md`: `off`
 * runs nothing, `changed` runs the flows of the features the change touches,
 * `all` runs every scene. A flow with `screenshots: false` runs nothing.
 *
 * Every language runs, then the capture index is updated and an error is
 * thrown when any language failed, so `warlock e2e` fails.
 *
 * @param context The browser run's context (`run: async (context) => …`).
 * @param ref `<feature>/<flow> AC-<n>`, the same text as the `@shows` comment.
 */
export async function shows(
  context: E2EContext,
  ref: string,
  scene: (scene: ShowsScene) => Promise<void>,
  options: ShowsOptions = {},
): Promise<void> {
  const match = REF.exec(ref);

  if (!match) {
    throw new Error(`shows(): ${JSON.stringify(ref)} is not "<feature>/<flow> AC-<n>".`);
  }

  const [, feature = "", flow = "", criterion = ""] = match;
  const flowRef = `${feature}/${flow}`;
  const root = process.cwd();
  const setup = await loadSetup(root);

  if (setup.mode === "off") return;
  if (setup.touched !== null && !setup.touched.has(feature)) return;
  if (await optedOut(root, feature, flow)) return;

  const [{ criterionShotName }, { mergeCaptures, readCaptureIndex, writeCaptureIndex }] =
    await Promise.all([import("../paths"), import("../shots/store")]);
  const languages = setup.languages.length > 0 ? setup.languages : [""];
  const routing = await readLocaleRouting(root, setup.languages);
  const page = context.page;
  const captures: ShotCapture[] = [];
  const failures: string[] = [];
  const spec = callerFile(root);

  for (const language of languages) {
    const ranAt = new Date().toISOString();
    const base = {
      ref: flowRef,
      criterion,
      language,
      spec,
      ranAt,
    };
    let viewport = options.viewport
      ? {
          name: options.viewport.name,
          width: options.viewport.width,
          height: options.viewport.height,
        }
      : { name: "default", width: 0, height: 0 };

    try {
      await page.setExtraHeaders(language === "" ? {} : { locale: language });

      if (options.viewport) await page.setViewport(options.viewport);

      await scene({
        page,
        language,
        path: (pagePath) => localizedPath(pagePath, language, routing),
        step: context.step,
      });
      await maskSelectors(page, options.mask ?? []);

      if (!options.viewport) {
        const size = await page.evaluate<{ width: number; height: number }>(
          "({ width: innerWidth, height: innerHeight })",
        );

        viewport = { name: "default", width: size.width, height: size.height };
      }

      const name = `${feature}-${flow}-${criterion}${language === "" ? "" : `-${language}`}`;
      const taken = await page.screenshot(name);
      const relative = `captured/${criterionShotName(flowRef, criterion, language)}`;
      const target = path.join(root, "grimoire", "screenshots", ...relative.split("/"));

      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(taken, target);

      captures.push({
        ...base,
        file: relative,
        sha256: createHash("sha256")
          .update(await readFile(target))
          .digest("hex"),
        outcome: "pass",
        error: null,
        viewport,
      });
    } catch (error) {
      captures.push({
        ...base,
        file: null,
        sha256: null,
        outcome: "fail",
        error: message(error),
        viewport,
      });
      failures.push(`${language === "" ? "scene" : language}: ${message(error)}`);
    } finally {
      await page.clearMocks().catch(() => {});
    }
  }

  await page.setExtraHeaders({}).catch(() => {});

  const now = new Date().toISOString();

  await writeCaptureIndex(root, mergeCaptures(await readCaptureIndex(root), captures, now));

  if (failures.length > 0) {
    throw new Error(
      `shows ${ref} failed in ${failures.length} of ${languages.length} runs: ${failures.join("; ")}`,
    );
  }
}
