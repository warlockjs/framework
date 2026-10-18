import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fallbackMetrics, fallbackOverrides } from "./fallback";
import { readFontMetrics } from "./read-metrics";
import type { FontDocument, WebFont } from "./types";

export const FONT_MANIFEST = ".vite/warlock-fonts.json";
export const DEV_FONT_CSS = "/@warlock/fonts.css";

export type FontDiagnostic = { type: "format" | "preload" | "fallback"; message: string };
export type PreparedFonts = {
  document: FontDocument;
  css: string;
  assets: ReadonlyMap<string, Buffer | string>;
  diagnostics: readonly FontDiagnostic[];
};

function quote(value: string): string {
  return `"${Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return character === '"' || character === "\\" || code < 32 || code === 127
      ? `\\${code.toString(16)} `
      : character;
  }).join("")}"`;
}

function assetName(source: Buffer | string, extension: string) {
  return `assets/font-${createHash("sha256").update(source).digest("hex").slice(0, 16)}.${extension}`;
}

/** Both lexical and symlink containment matter: only application-owned files may be published. */
export function fontPath(root: string, file: string): string {
  if (path.isAbsolute(file) || file.includes("\\") || file.split("/").includes("..")) {
    throw new Error(`Font paths must be app-root-relative: ${file}`);
  }
  const absolute = realpathSync(path.resolve(root, file));
  const relative = path.relative(realpathSync(root), absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`Font path leaves the app root: ${file}`);
  return absolute;
}

/** No source paths or font metrics are needed by a production server. */
export function prepareFonts(root: string, fonts: readonly WebFont[]): PreparedFonts {
  const assets = new Map<string, Buffer | string>();
  const preloads = new Map<string, { href: string; type: string }>();
  const diagnostics: FontDiagnostic[] = [];
  const css: string[] = [];
  const variables = new Set<string>();
  const families = new Set<string>();
  for (const font of fonts) {
    if (!font.family.trim() || families.has(font.family) || !font.files.length)
      throw new Error("Fonts require unique nonempty families and at least one file");
    families.add(font.family);
    if (!/^--[a-zA-Z_][\w-]*$/.test(font.variable) || variables.has(font.variable))
      throw new Error(`Invalid or duplicate font variable: ${font.variable}`);
    variables.add(font.variable);
    const display = font.display ?? "swap";
    if (!["auto", "block", "swap", "fallback", "optional"].includes(display))
      throw new Error(`Invalid font display: ${display}`);
    const fallbacks = [
      ...new Set(typeof font.fallback === "string" ? [font.fallback] : (font.fallback ?? [])),
    ];
    const fallbackName = (index: number) =>
      `${font.family} Fallback${index === 0 ? "" : ` ${index + 1}`}`;
    const fallbackNames = fallbacks.map((_, index) => fallbackName(index));
    for (const face of font.files) {
      const extension = path.extname(face.path).slice(1).toLowerCase();
      const formats: Readonly<Record<string, string>> = {
        woff2: "woff2",
        woff: "woff",
        ttf: "truetype",
        otf: "opentype",
      };
      const format = formats[extension];
      if (!format) throw new Error(`Unsupported font extension: ${face.path}`);
      const weight = String(face.weight ?? 400);
      if (
        !/^\d{1,4}( \d{1,4})?$/.test(weight) ||
        weight.split(" ").some((value) => Number(value) < 1 || Number(value) > 1000)
      )
        throw new Error(`Invalid font weight: ${weight}`);
      const style = face.style ?? "normal";
      if (!["normal", "italic", "oblique"].includes(style))
        throw new Error(`Invalid font style: ${style}`);
      if (
        face.unicodeRange !== undefined &&
        !/^U\+[0-9a-f?]+(?:-[0-9a-f]+)?(?:\s*,\s*U\+[0-9a-f?]+(?:-[0-9a-f]+)?)*$/i.test(
          face.unicodeRange,
        )
      )
        throw new Error("Invalid font unicodeRange");
      const source = readFileSync(fontPath(root, face.path));
      const name = assetName(source, extension);
      assets.set(name, source);
      const href = `/${name}`;
      const descriptors = `font-weight:${weight};font-style:${style};${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ""}`;
      css.push(
        `@font-face{font-family:${quote(font.family)};src:url(${quote(href)}) format(${quote(format)});font-display:${display};${descriptors}}`,
      );
      const metrics = (() => {
        try {
          return readFontMetrics(source);
        } catch (error) {
          if (!face.metricsPath)
            throw new Error(
              `Cannot read metrics for ${face.path}. Supply an equivalent TTF/OTF metricsPath.`,
              { cause: error },
            );
          return readFontMetrics(readFileSync(fontPath(root, face.metricsPath)));
        }
      })();
      fallbacks.forEach((family, index) => {
        const fallback = fallbackMetrics(family, face);
        const values = fallbackOverrides(metrics, fallback);
        css.push(
          `@font-face{font-family:${quote(fallbackName(index))};src:local(${quote(fallback.fullName)}),local(${quote(fallback.postscriptName)});${descriptors}size-adjust:${values.sizeAdjust};ascent-override:${values.ascentOverride};descent-override:${values.descentOverride};line-gap-override:${values.lineGapOverride};}`,
        );
      });
      if (face.preload) preloads.set(href, { href, type: `font/${extension}` });
      if (extension === "ttf" || extension === "otf")
        diagnostics.push({
          type: "format",
          message: `${font.family}: ${face.path} uses ${extension.toUpperCase()}; serve WOFF2 for smaller downloads.`,
        });
      if (face.aboveFold && !face.preload)
        diagnostics.push({
          type: "preload",
          message: `${font.family}: an aboveFold face has no preload; set preload: true.`,
        });
      if ((face.aboveFold || face.preload) && !fallbacks.length)
        diagnostics.push({
          type: "fallback",
          message: `${font.family}: a critical face has no metric-matched fallback; set fallback.`,
        });
    }
    const stack = [font.family, ...fallbackNames, ...fallbacks].map(quote).join(",");
    css.push(`:root{${font.variable}:${stack};}`);
  }
  const stylesheet = css.join("\n");
  const stylesheetName = assetName(stylesheet, "css");
  assets.set(stylesheetName, stylesheet);
  return {
    css: stylesheet,
    assets,
    diagnostics,
    document: { stylesheetUrl: `/${stylesheetName}`, preloads: [...preloads.values()] },
  };
}

type FontCache = Map<string, { key: string; prepared: PreparedFonts }>;
const FONT_CACHE_SLOT = Symbol.for("warlock.web.devFontCache");

function devFontCache(): FontCache {
  // Vite evaluates the SSR renderer separately from the Node-side middleware.
  // Share parsing and warnings across those graphs, just like sharedContext.
  const holder = globalThis as unknown as Record<symbol, FontCache | undefined>;
  return (holder[FONT_CACHE_SLOT] ??= new Map());
}

/** Cache the first request's parsing, invalidating on config or font-file changes. */
export function prepareDevFonts(root: string, fonts: readonly WebFont[]): PreparedFonts {
  const cache = devFontCache();
  const files = fonts.flatMap((font) =>
    font.files.flatMap((face) => [face.path, ...(face.metricsPath ? [face.metricsPath] : [])]),
  );
  const key = JSON.stringify([
    fonts,
    files.map((file) => {
      const resolved = fontPath(root, file);
      const stat = statSync(resolved);
      return [resolved, stat.mtimeMs, stat.ctimeMs, stat.size];
    }),
  ]);
  const previous = cache.get(root);
  if (previous?.key === key) return previous.prepared;
  const prepared = prepareFonts(root, fonts);
  cache.set(root, { key, prepared });
  for (const diagnostic of prepared.diagnostics)
    console.warn(`[warlock:web:fonts:${diagnostic.type}] ${diagnostic.message}`);
  return prepared;
}
