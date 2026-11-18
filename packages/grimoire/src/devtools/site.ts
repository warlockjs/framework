/**
 * The static export: one folder with an `index.html` that holds the view, the
 * loader, the styles and the data as JSON. It opens from disk (`file://`) or
 * any static host and needs no running app.
 */
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BookAdapter } from "../contracts/adapter";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { GRIMOIRE_PATHS, projectPath, toPosixPath } from "../paths";
import * as data from "./data";
import { featureGraph, fileGraph, pageGraph } from "./graphs";
import { productFeature, productFlow, productMap } from "./product-map";
import { createSnapshotSource } from "./snapshot-source";

/** Options of `exportGrimoireSite()`. */
export type ExportGrimoireSiteOptions = {
  /** Output folder, project-relative or absolute. Default `grimoire/book/site` (the book writer leaves it alone and git ignores it). */
  outDir?: string;
  /** The adapter to open the book with. Default: the Warlock adapter. */
  adapter?: BookAdapter | (() => Promise<BookAdapter>);
  /** An already opened snapshot; skips opening one. */
  snapshot?: GrimoireSnapshot;
};

/** The most files the export keeps per-file answers for (the most imported first). */
export const SITE_FILE_LIMIT = 3000;

type SearchItem = { type: string; id: string; detail: string | null };

const uiFolder = fileURLToPath(new URL("../../ui/", import.meta.url));

/** Every answer the static page can give, keyed by the data route it replaces. */
export function buildSiteData(snapshot: GrimoireSnapshot) {
  const routes: Record<string, unknown> = {
    summary: data.summary(snapshot),
    features: data.features(snapshot),
    apps: data.apps(snapshot),
    tasks: data.tasks(snapshot),
    releases: data.releases(snapshot),
    // The page is meant to be shared: it does not name where the project sits on this machine.
    check: { ...data.check(snapshot), root: "." },
    "graph/modules": data.graphOfModules(snapshot),
  };
  // The static page is the signed-in view: developer detail stays, and no monitor reports errors.
  const productOptions = { shared: false, errors: null } as const;
  const productAnswer = attempt(() => productMap(snapshot, productOptions));
  const groups = attempt(() => data.checkGroups(snapshot));

  if (productAnswer !== undefined) routes.product = productAnswer;

  if (groups !== undefined) routes["check/groups"] = groups;

  const search: SearchItem[] = [];

  for (const release of snapshot.written.releases) {
    routes[`releases/${release.release.value}`] = release;
  }

  for (const feature of snapshot.written.features) {
    const readme = feature.readme;

    search.push({ type: "feature", id: feature.id, detail: readme?.title.value ?? null });
    const answered = attempt(() => data.feature(snapshot, feature.id));

    if (answered !== undefined) routes[`features/${feature.id}`] = answered;

    const graph = featureGraph(snapshot, feature.id);

    if (graph !== null) routes[`graph/feature/${feature.id}`] = graph;

    const product = attempt(() => productFeature(snapshot, feature.id, productOptions));

    if (product !== undefined) routes[`product/features/${feature.id}`] = product;

    for (const flow of feature.flows) {
      search.push({ type: "flow", id: flow.ref, detail: flow.heading?.value ?? null });
      const flowAnswer = attempt(() => data.flowAnswer(snapshot, feature.id, flow.id.value));
      const productFlowAnswer = attempt(() =>
        productFlow(snapshot, feature.id, flow.id.value, productOptions),
      );

      if (flowAnswer !== undefined) routes[`flows/${flow.ref}`] = flowAnswer;

      if (productFlowAnswer !== undefined) routes[`product/flows/${flow.ref}`] = productFlowAnswer;
    }
  }

  for (const app of snapshot.written.apps) {
    const appId = app.id.value;

    for (const page of [...app.pages, ...app.screens]) {
      const route = page.route?.value ?? page.screen?.value ?? null;
      const answer = attempt(() => data.page(snapshot, appId, page.id));
      const graph = pageGraph(snapshot, appId, page.id);

      for (const key of new Set([page.id, ...(route === null ? [] : [route])])) {
        if (answer !== undefined) routes[`apps/${appId}/pages/${key}`] = answer;

        if (graph !== null) routes[`graph/page/${appId}/${key}`] = graph;
      }

      if (route !== null)
        search.push({
          type: page.type,
          id: `${appId} ${route}`,
          detail: page.heading?.value ?? null,
        });

      for (const block of page.blockFiles) {
        search.push({
          type: "block",
          id: `${appId}/${page.id}/${block.id}`,
          detail: block.flow?.value ?? null,
        });
      }
    }
  }

  for (const found of snapshot.book.facts.routes ?? []) {
    search.push({
      type: "route",
      id: `${found.method} ${found.path}`,
      detail: found.description ?? found.handler,
    });
  }

  for (const task of snapshot.collected.tasksIndex.open.concat(
    snapshot.collected.tasksIndex.done,
  )) {
    search.push({ type: "task", id: task.id, detail: task.title });
  }

  const files: Record<string, { result: unknown; graph: unknown }> = {};
  const ranked = [...snapshot.book.facts.files].sort(
    (left, right) =>
      right.importedBy.length - left.importedBy.length || left.file.localeCompare(right.file),
  );

  for (const [index, file] of ranked.entries()) {
    search.push({ type: "file", id: file.file, detail: file.about });

    if (index >= SITE_FILE_LIMIT) continue;

    const result = attempt(() => data.file(snapshot, file.file));

    if (result !== undefined) files[file.file] = { result, graph: fileGraph(snapshot, file.file) };
  }

  return { routes, files, search };
}

/** JSON for an inline `<script>`: every `<` is escaped, so no `</script` or `<!--` can appear. */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/** Code for an inline `<script>`: `</script` (in any case) and `<!--` (only possible in strings and comments) are broken up. */
function inlineCode(code: string): string {
  return code.replace(/<\/(script)/gi, "<\\/$1").replaceAll("<!--", "<\\!--");
}

/** The image types the export copies (the same list the devtools panel serves). */
const SCREENSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** Every `WrittenScreenshot.path` in the written files, once each. */
export function collectScreenshotPaths(written: unknown): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;

      if (
        typeof record.path === "string" &&
        typeof record.written === "string" &&
        typeof record.alt === "string"
      )
        found.add(record.path);

      for (const item of Object.values(record)) walk(item);
    }
  };

  walk(written);

  return [...found].sort();
}

/**
 * Copy the screenshots the written files use into `<out>/screenshots/`. A path that leaves
 * `grimoire/screenshots/`, has another extension or does not exist is skipped.
 *
 * @returns The paths that were copied.
 */
export async function copyScreenshots(
  root: string,
  outFolder: string,
  paths: readonly string[],
): Promise<string[]> {
  const folder = await realpath(path.join(root, GRIMOIRE_PATHS.screenshots)).catch(() => null);
  const copied: string[] = [];

  if (folder === null) return copied;

  for (const written of paths) {
    const segments = written.split("/");

    if (
      written === "" ||
      written.includes("\\") ||
      written.includes("\0") ||
      path.isAbsolute(written) ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
      !SCREENSHOT_EXTENSIONS.has(path.extname(written).toLowerCase())
    )
      continue;

    const source = await realpath(path.join(folder, ...segments)).catch(() => null);

    if (source === null || !source.startsWith(folder + path.sep)) continue;

    if (!(await stat(source)).isFile()) continue;

    const target = path.join(outFolder, "screenshots", ...segments);

    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    copied.push(written);
  }

  return copied;
}

/** The answer, or `undefined` when the item cannot be answered (the export skips it). */
function attempt<Value>(answer: () => Value): Value | undefined {
  try {
    return answer();
  } catch {
    return undefined;
  }
}

/** Everything before the page's `export default`, so the view can sit in an inline module. */
export function inlineView(source: string): string {
  const marker = "export default renderGrimoire;";

  if (!source.includes(marker))
    throw new Error("grimoire-view.js must end with `export default renderGrimoire;`.");

  return source.replace(marker, "");
}

/**
 * The product map module as inline code: its `export` keywords are removed and the Grimoire view
 * finds it as `globalThis.grimoireProductMap`.
 */
export function inlineProductMap(source: string): string {
  const marker = "export default renderProductMap;";

  if (!source.includes(marker))
    throw new Error("product-map.js must end with `export default renderProductMap;`.");

  return `${source.replace(marker, "").replace(/^export (async )?function /gm, "$1function ")}\nglobalThis.grimoireProductMap = { productMapView };\n`;
}

/**
 * The page's own styles: it defines every devtools panel token (light, then dark under
 * `prefers-color-scheme`), so `grimoire.css` renders the same here as in the dashboard.
 * The values keep text AA on `--background` and `--card`.
 */
export const PAGE_STYLE = `
:root{color-scheme:light dark;--background:#f7f8fa;--foreground:#161b22;--card:#fff;--card-foreground:#161b22;--popover:#fff;--popover-foreground:#161b22;--primary:#1f2937;--primary-foreground:#fff;--secondary:#eceff3;--secondary-foreground:#1f2937;--muted:#eceff3;--muted-foreground:#4b5565;--accent:#e4e9f2;--accent-foreground:#161b22;--destructive:#b42318;--border:#d5dae3;--input:#c3cad6;--ring:#2f5fd0;--radius:10px;--brand:#2757c4;--brand-foreground:#fff;--success:#13693b;--warning:#8a5300;--info:#0b66a3;--chart-1:#2757c4;--chart-2:#13693b;--chart-3:#8a5300;--chart-4:#6d3ac7;--chart-5:#b4306b;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){:root{--background:#14171c;--foreground:#eceff4;--card:#1c2027;--card-foreground:#eceff4;--popover:#1c2027;--popover-foreground:#eceff4;--primary:#eceff4;--primary-foreground:#14171c;--secondary:#272c35;--secondary-foreground:#eceff4;--muted:#272c35;--muted-foreground:#a9b2c1;--accent:#2d3440;--accent-foreground:#eceff4;--destructive:#ff8f86;--border:#343b47;--input:#3f4756;--ring:#8fb0ff;--radius:10px;--brand:#86adff;--brand-foreground:#0d1320;--success:#5fd391;--warning:#f3b25a;--info:#6cc0f5;--chart-1:#86adff;--chart-2:#5fd391;--chart-3:#f3b25a;--chart-4:#b79cff;--chart-5:#ff8fbd}}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font-size:14px;line-height:1.5}
main{max-width:1180px;margin:0 auto;padding:16px}
.empty{padding:12px;color:var(--muted-foreground)}.error{padding:12px;color:var(--destructive)}
`;

/** The `index.html` text. */
export function renderSiteHtml(
  siteData: unknown,
  sources: { view: string; loader: string; css: string; productMap?: string; productCss?: string },
): string {
  const json = inlineJson(siteData);
  const script = inlineCode(
    `${sources.productMap === undefined ? "" : inlineProductMap(sources.productMap)}${inlineView(sources.view)}\n${sources.loader}\ngrimoireStaticMount(JSON.parse(document.getElementById("grimoire-data").textContent), document.getElementById("grimoire-root"), renderGrimoire);\n`,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grimoire</title>
<style>${PAGE_STYLE}${sources.css}${sources.productCss ?? ""}</style>
</head>
<body>
<main id="grimoire-root"><p class="empty">Opening the book…</p></main>
<script type="application/json" id="grimoire-data">${json}</script>
<script type="module">${script}</script>
</body>
</html>
`;
}

/**
 * Write the tab as a static folder for people without the app running.
 *
 * The folder holds `index.html` only: the view, the loader, the styles and
 * the data (as JSON) are inside it, so it opens straight from disk. Open the
 * page and use `#grimoire/...` links; the answers that need the running app
 * (impact of a file) say so in place.
 *
 * @param root Absolute project root.
 * @returns The output folder, project-relative.
 */
export async function exportGrimoireSite(
  root: string,
  options: ExportGrimoireSiteOptions = {},
): Promise<string> {
  // Project-relative from here on; an absolute folder is kept where it is.
  const outDir = projectPath(
    root,
    toPosixPath(options.outDir ?? GRIMOIRE_PATHS.staticSite),
  ).replace(/\/+$/, "");
  const snapshot =
    options.snapshot ??
    (await createSnapshotSource(
      root,
      options.adapter === undefined ? {} : { adapter: options.adapter },
    ).get());
  const [view, loader, css, productMapSource, productCss] = await Promise.all(
    [
      "grimoire-view.js",
      "grimoire-static.js",
      "grimoire.css",
      "product-map.js",
      "product-map.css",
    ].map((name) => readFile(path.join(uiFolder, name), "utf8")),
  );
  const html = renderSiteHtml(buildSiteData(snapshot), {
    view: view ?? "",
    loader: loader ?? "",
    css: css ?? "",
    productMap: productMapSource ?? "",
    productCss: productCss ?? "",
  });
  const absolute = path.resolve(root, outDir);

  await mkdir(absolute, { recursive: true });
  await writeFile(path.join(absolute, "index.html"), html);
  await copyScreenshots(root, absolute, collectScreenshotPaths(snapshot.written));

  return outDir;
}
