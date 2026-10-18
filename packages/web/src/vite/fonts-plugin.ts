import type { Plugin } from "vite";
import { DEV_FONT_CSS, FONT_MANIFEST, prepareDevFonts, prepareFonts } from "../fonts/prepare-fonts";
import type { WebFont } from "../fonts/types";

/** Emits declared files through Vite, independently of JS imports and asset inlining. */
export function webFontsPlugin(options: { appRoot: string; fonts: readonly WebFont[] }): Plugin {
  return {
    name: "warlock:fonts",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") return next();
        const url = request.url?.split("?")[0];
        if (url !== DEV_FONT_CSS && !url?.startsWith("/assets/font-")) return next();
        try {
          const prepared = prepareDevFonts(options.appRoot, options.fonts);
          const source = url === DEV_FONT_CSS ? prepared.css : prepared.assets.get(url.slice(1));
          if (source === undefined) return next();
          response.setHeader(
            "Content-Type",
            url === DEV_FONT_CSS || url.endsWith(".css")
              ? "text/css; charset=utf-8"
              : `font/${url.split(".").pop()}`,
          );
          response.setHeader("Cache-Control", "no-cache");
          response.end(request.method === "HEAD" ? undefined : source);
        } catch (error) {
          next(error);
        }
      });
    },
    generateBundle() {
      const prepared = prepareFonts(options.appRoot, options.fonts);
      for (const [fileName, source] of prepared.assets)
        this.emitFile({ type: "asset", fileName, source });
      this.emitFile({
        type: "asset",
        fileName: FONT_MANIFEST,
        source: JSON.stringify(prepared.document),
      });
    },
  };
}
