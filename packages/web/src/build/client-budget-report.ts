import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { Manifest, Plugin } from "vite";
import { discoverPages } from "./discover-pages";
import type { SitesConfig } from "../sites/site-config.types";
import { hydrationSiteEntryName, HYDRATION_CLIENT_ENTRY_NAME } from "../vite/hydration-entries";

type ChunkModules = Record<string, { id: string; bytes: number }[]>;
const MODULE_REPORT = ".vite/budget-modules.json";
const posix = (value: string) => value.split(path.sep).join("/");

/** Rollup's renderedLength is an attribution estimate, not compressed transfer size. */
export function clientBudgetModules(appRoot: string): Plugin {
  return {
    name: "warlock-client-budget-modules",
    generateBundle(_options, bundle) {
      const chunks: ChunkModules = {};
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        chunks[output.fileName] = Object.entries(output.modules).map(([id, module]) => ({
          id: path.isAbsolute(id) ? posix(path.relative(appRoot, id)) : id,
          bytes: module.renderedLength,
        }));
      }
      this.emitFile({ type: "asset", fileName: MODULE_REPORT, source: JSON.stringify(chunks) });
    },
  };
}

export type ClientBudgetPageInput = {
  page: string;
  source: string;
  modules: string[];
  /**
   * Modules that may legitimately be absent from the bundle. A setup file's
   * browser projection holds only its `register` hook; when there is none the
   * projection is empty and the bundler drops it, so it adds no bytes.
   */
  optionalModules?: string[];
  entry: string;
};

/** Traverse static imports once, including cycles/diamonds; deferred graphs stay separate. */
export async function measureClientBudgets(options: {
  manifest: Manifest;
  chunks: ChunkModules;
  pages: ClientBudgetPageInput[];
  readAsset: (file: string) => Promise<Uint8Array>;
}) {
  const { manifest, chunks } = options;
  const measured = new Map<string, Promise<number>>();
  function size(file: string) {
    let pending = measured.get(file);
    if (!pending) {
      pending = options.readAsset(file).then((bytes) => gzipSync(bytes).length);
      measured.set(file, pending);
    }
    return pending;
  }
  function closure(roots: string[]) {
    const visited = new Set<string>();
    function visit(key: string) {
      if (visited.has(key)) return;
      const chunk = manifest[key];
      if (!chunk) throw new Error(`Client budget manifest references missing chunk ${key}.`);
      visited.add(key);
      for (const dependency of chunk.imports ?? []) visit(dependency);
    }
    roots.forEach(visit);
    return visited;
  }
  function assets(keys: Set<string>) {
    const js = new Set<string>();
    const css = new Set<string>();
    for (const key of keys) {
      const chunk = manifest[key];
      if (!chunk) continue;
      if (/\.(?:m?js)$/.test(chunk.file)) js.add(chunk.file);
      else if (chunk.file.endsWith(".css")) css.add(chunk.file);
      for (const file of chunk.css ?? []) css.add(file);
    }
    return { js, css };
  }
  async function total(files: Set<string>) {
    return (await Promise.all([...files].map(size))).reduce((sum, bytes) => sum + bytes, 0);
  }
  // Index once: avoid rescanning every emitted module for each page/layout.
  const keysByFile = new Map<string, string[]>();
  for (const [key, chunk] of Object.entries(manifest)) {
    const keys = keysByFile.get(chunk.file) ?? [];
    keys.push(key);
    keysByFile.set(chunk.file, keys);
  }
  const keysByModule = new Map<string, Set<string>>();
  for (const [file, modules] of Object.entries(chunks)) {
    for (const module of modules) {
      const keys = keysByModule.get(module.id) ?? new Set<string>();
      for (const key of keysByFile.get(file) ?? []) keys.add(key);
      keysByModule.set(module.id, keys);
    }
  }
  const pages = [];
  for (const page of options.pages) {
    const roots = Object.entries(manifest)
      .filter(([, chunk]) => chunk.isEntry && chunk.name === page.entry)
      .map(([key]) => key);
    if (roots.length !== 1)
      throw new Error(
        `Client budget cannot find a unique ${page.entry} hydration entry for ${page.page}.`,
      );
    for (const id of page.modules) {
      const keys = [...(keysByModule.get(id) ?? [])];
      if (keys.length === 0)
        throw new Error(`Client budget cannot locate module ${id} for ${page.page}.`);
      roots.push(...keys);
    }
    for (const id of page.optionalModules ?? []) roots.push(...(keysByModule.get(id) ?? []));
    const first = closure(roots);
    const deferred = new Set<string>();
    const pending = [...first];
    const scanned = new Set<string>();
    while (pending.length) {
      const key = pending.pop();
      if (key === undefined || scanned.has(key)) continue;
      scanned.add(key);
      for (const dependency of manifest[key]?.dynamicImports ?? []) {
        for (const item of closure([dependency])) {
          if (!first.has(item)) deferred.add(item);
          pending.push(item);
        }
      }
    }
    const initial = assets(first);
    const dynamic = assets(deferred);
    for (const file of initial.js) dynamic.js.delete(file);
    for (const file of initial.css) dynamic.css.delete(file);
    const modules = new Map<string, number>();
    for (const file of initial.js) {
      for (const module of chunks[file] ?? [])
        modules.set(module.id, (modules.get(module.id) ?? 0) + module.bytes);
    }
    pages.push({
      page: page.page,
      source: page.source,
      js: await total(initial.js),
      css: await total(initial.css),
      dynamic: { js: await total(dynamic.js), css: await total(dynamic.css) },
      files: [...initial.js, ...initial.css].sort(),
      modules: [...modules]
        .map(([id, bytes]) => ({ id, bytes }))
        .sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id))
        .slice(0, 10),
    });
  }
  return { version: 1 as const, compression: "gzip" as const, pages, violations: [] };
}

export async function writeClientBudgetReport(options: {
  appRoot: string;
  outdir: string;
  srcDir?: string;
  sites?: SitesConfig;
}): Promise<void> {
  const clientDir = path.join(options.outdir, "client");
  const manifest: Manifest = JSON.parse(
    await readFile(path.join(clientDir, ".vite/manifest.json"), "utf8"),
  );
  const chunks: ChunkModules = JSON.parse(
    await readFile(path.join(clientDir, MODULE_REPORT), "utf8"),
  );
  const discovered = discoverPages(options);
  const relative = (file: string) => posix(path.relative(options.appRoot, file));
  const pages: ClientBudgetPageInput[] = discovered
    .filter((page) => page.type === "page")
    .map((page) => {
      const errorPage = discovered.find(
        (entry) => entry.type === "error" && entry.site === page.site,
      );
      return {
        page: page.routePath,
        source: relative(page.pageFile),
        entry:
          page.site === undefined ? HYDRATION_CLIENT_ENTRY_NAME : hydrationSiteEntryName(page.site),
        modules: [
          page.pageFile,
          ...page.layouts,
          ...(page.appFile ? [page.appFile] : []),
          ...(errorPage ? [errorPage.pageFile] : []),
        ].map(relative),
        optionalModules: [
          page.setupFile,
          ...(page.layoutSetupFiles ?? []),
          page.appSetupFile,
          errorPage?.setupFile,
        ]
          .filter((file): file is string => file !== undefined)
          .map((file) => `${relative(file)}?warlock-setup-register`),
      };
    });
  const report = await measureClientBudgets({
    manifest,
    chunks,
    pages,
    readAsset: (file) => {
      const absolute = path.resolve(clientDir, file);
      if (!absolute.startsWith(`${clientDir}${path.sep}`))
        throw new Error(`Invalid client asset path ${file}.`);
      return readFile(absolute);
    },
  });
  await writeFile(
    path.join(options.outdir, "build-budgets.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
