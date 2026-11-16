/**
 * The static export: one folder with an `index.html` that holds the view, the
 * loader, the styles and the data as JSON. It opens from disk (`file://`) or
 * any static host and needs no running app.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BookAdapter } from "../contracts/adapter";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { GRIMOIRE_PATHS } from "../paths";
import * as data from "./data";
import { featureGraph, fileGraph, pageGraph } from "./graphs";
import { createSnapshotSource } from "./snapshot-source";

/** Options of `exportGrimoireSite()`. */
export type ExportGrimoireSiteOptions = {
  /** Output folder, project-relative. Default `grimoire/book/site` (the book writer leaves it alone and git ignores it). */
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
    apps: data.apps(snapshot),
    tasks: data.tasks(snapshot),
    releases: data.releases(snapshot),
    check: data.check(snapshot),
    "graph/modules": data.graphOfModules(snapshot),
  };
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

    for (const flow of feature.flows) {
      search.push({ type: "flow", id: flow.ref, detail: flow.heading?.value ?? null });
      const flowAnswer = attempt(() => data.flow(snapshot, feature.id, flow.id.value));

      if (flowAnswer !== undefined) routes[`flows/${flow.ref}`] = flowAnswer;
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

      if (route !== null) search.push({ type: page.type, id: `${appId} ${route}`, detail: page.heading?.value ?? null });

      for (const block of page.blockFiles) {
        search.push({ type: "block", id: `${appId}/${page.id}/${block.id}`, detail: block.flow?.value ?? null });
      }
    }
  }

  for (const found of snapshot.book.facts.routes ?? []) {
    search.push({ type: "route", id: `${found.method} ${found.path}`, detail: found.description ?? found.handler });
  }

  for (const task of snapshot.collected.tasksIndex.open.concat(snapshot.collected.tasksIndex.done)) {
    search.push({ type: "task", id: task.id, detail: task.title });
  }

  const files: Record<string, { result: unknown; graph: unknown }> = {};
  const ranked = [...snapshot.book.facts.files].sort(
    (left, right) => right.importedBy.length - left.importedBy.length || left.file.localeCompare(right.file),
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

/** Code for an inline `<script>`: `</script` and `<!--` (only possible in strings and comments) are broken up. */
function inlineCode(code: string): string {
  return code.replaceAll("</script", "<\\/script").replaceAll("<!--", "<\\!--");
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

  if (!source.includes(marker)) throw new Error("grimoire-view.js must end with `export default renderGrimoire;`.");

  return source.replace(marker, "");
}

const PAGE_STYLE = `
:root{color-scheme:light dark;--bg:#f5f6f8;--surface:#fff;--line:#d9dde5;--text:#18202a;--muted:#667085;--accent:#285fc1;--good:#167a43;--warn:#a96000;--bad:#b42318;--bar:#5b7cfa;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#16191f;--surface:#20242c;--line:#383e49;--text:#edf0f5;--muted:#aab3c2;--accent:#83adff;--good:#65d394;--warn:#f6b65a;--bad:#ff9c95;--bar:#8ca7ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:14px}
main{max-width:1100px;margin:0 auto;padding:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.badge{display:inline-block;padding:0 6px;border:1px solid var(--line);border-radius:10px;font-size:12px}
.empty,.error{padding:12px;color:var(--muted)}.error{color:var(--bad)}
`;

/** The `index.html` text. */
export function renderSiteHtml(siteData: unknown, sources: { view: string; loader: string; css: string }): string {
  const json = inlineJson(siteData);
  const script = inlineCode(
    `${inlineView(sources.view)}\n${sources.loader}\ngrimoireStaticMount(JSON.parse(document.getElementById("grimoire-data").textContent), document.getElementById("grimoire-root"), renderGrimoire);\n`,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grimoire</title>
<style>${PAGE_STYLE}${sources.css}</style>
</head>
<body>
<main id="grimoire-root"><p class="empty">Loading the Grimoire…</p></main>
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
export async function exportGrimoireSite(root: string, options: ExportGrimoireSiteOptions = {}): Promise<string> {
  const outDir = (options.outDir ?? GRIMOIRE_PATHS.staticSite).split("\\").join("/").replace(/\/+$/, "");
  const snapshot =
    options.snapshot ??
    (await createSnapshotSource(root, options.adapter === undefined ? {} : { adapter: options.adapter }).get());
  const [view, loader, css] = await Promise.all(
    ["grimoire-view.js", "grimoire-static.js", "grimoire.css"].map((name) => readFile(path.join(uiFolder, name), "utf8")),
  );
  const html = renderSiteHtml(buildSiteData(snapshot), { view: view ?? "", loader: loader ?? "", css: css ?? "" });
  const absolute = path.resolve(root, ...outDir.split("/"));

  await mkdir(absolute, { recursive: true });
  await writeFile(path.join(absolute, "index.html"), html);

  return outDir;
}
