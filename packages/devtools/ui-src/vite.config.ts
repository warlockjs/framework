import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Builds the devtools dashboard into `../ui/dashboard/` (shipped in the npm
 * package; `ui-src/` is not). Fixed file names (`assets/app.js`,
 * `assets/app.css`), one chunk, relative URLs: the server serves the files
 * from a whitelist under whatever path the dashboard is mounted on.
 *
 * `vite --config ui-src/vite.config.ts` (`pnpm run dev:ui`) serves the same UI
 * with hot reload and proxies the API to a running app:
 * DEVTOOLS_DEV_TARGET (default http://localhost:3000) and DEVTOOLS_DEV_BASE
 * (default /__warlock).
 */
const root = import.meta.dirname;
const devBase = (process.env.DEVTOOLS_DEV_BASE ?? "/__warlock").replace(/\/+$/, "");
const devTarget = process.env.DEVTOOLS_DEV_TARGET ?? "http://localhost:3000";
const proxied = { target: devTarget, changeOrigin: true };

export default defineConfig(({ command }) => ({
  root,
  base: command === "build" ? "./" : `${devBase}/`,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@contracts": path.join(root, "../src/production/contracts.ts"),
      "@": path.join(root, "src"),
    },
  },
  build: {
    outDir: path.join(root, "../ui/dashboard"),
    emptyOutDir: true,
    assetsDir: "assets",
    cssCodeSplit: false,
    sourcemap: false,
    modulePreload: false,
    target: "es2022",
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "assets/app.js",
        assetFileNames: "assets/app[extname]",
      },
    },
  },
  server: {
    port: 5199,
    strictPort: true,
    proxy: {
      [`${devBase}/api`]: proxied,
      [`${devBase}/panels`]: proxied,
      [`${devBase}/docs`]: proxied,
      [`${devBase}/assets/scalar.js`]: proxied,
      [`${devBase}/assets/swagger-ui-bundle.js`]: proxied,
      [`${devBase}/assets/swagger-ui.css`]: proxied,
      [`${devBase}/assets/docs-swagger.js`]: proxied,
    },
  },
}));
