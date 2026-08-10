import { env, type HttpConfigurations } from "@warlock.js/core";

const httpConfigurations: HttpConfigurations = {
  // Read through `env()` on purpose: the acceptance run overrides the port, and
  // a config that hardcoded it would not exercise env resolution at all.
  port: env("HTTP_PORT", 3711),
  host: env("HTTP_HOST", "localhost"),
  log: false,
};

export default httpConfigurations;
