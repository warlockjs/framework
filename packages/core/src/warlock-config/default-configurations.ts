import { type WarlockConfig } from "./types";

export const defaultWarlockConfigurations: WarlockConfig = {
  build: {
    outdir: process.cwd() + "/dist",
    outFile: "app.js",
    routeRegistrationTimeoutMs: 30_000,
    sourcemap: true,
    minify: true,
  },
};
