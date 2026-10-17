import { defineConfig } from "@warlock.js/core";
import { webConnector } from "@warlock.js/web/connector";

export default defineConfig({
  build: {
    outdir: "dist",
  },
  connectors: [webConnector()],
});
