import { config } from "@warlock.js/core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEV_FONT_CSS, FONT_MANIFEST, prepareDevFonts } from "../fonts/prepare-fonts";
import type { FontDocument } from "../fonts/types";
import { consumePageManifest } from "./page-manifest";

const documents = new Map<string, FontDocument>();

/** Called only after the pipeline decides to render a document. */
export function documentFonts(appRoot = process.cwd()): FontDocument | undefined {
  const fonts = config.get("web", {}).fonts;
  if (!fonts?.length) return undefined;
  const clientDir = consumePageManifest()?.clientDir;
  if (clientDir !== undefined) {
    const file = path.resolve(appRoot, clientDir, FONT_MANIFEST);
    const previous = documents.get(file);
    if (previous) return previous;
    const document = JSON.parse(readFileSync(file, "utf8")) as FontDocument;
    if (
      !/^\/assets\/font-[a-f0-9]+\.css$/.test(document.stylesheetUrl) ||
      !Array.isArray(document.preloads) ||
      document.preloads.some(
        (preload) =>
          !/^\/assets\/font-[a-f0-9]+\.(woff2?|ttf|otf)$/.test(preload.href) ||
          !/^font\/(woff2?|ttf|otf)$/.test(preload.type),
      )
    )
      throw new Error("Malformed web font manifest; rebuild the application");
    documents.set(file, document);
    return document;
  }
  const prepared = prepareDevFonts(appRoot, fonts);
  return { ...prepared.document, stylesheetUrl: DEV_FONT_CSS };
}
