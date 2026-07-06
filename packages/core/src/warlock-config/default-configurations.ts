import { WarlockConfig } from "./types";

export const defaultWarlockConfigurations: WarlockConfig = {
  build: {
    outdir: process.cwd() + "/dist",
    outFile: "app.js",
    sourcemap: true,
    minify: true,
  },
};
