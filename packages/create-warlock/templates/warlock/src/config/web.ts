import type { WebConfigurations } from "@warlock.js/web";

const webConfigurations: WebConfigurations = {
  // Browser code may import only browser-safe module files; anything else fails the client build.
  moduleBoundary: "error",
};

export default webConfigurations;
