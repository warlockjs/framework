import { env, type HttpConfigurations } from "@warlock.js/core";

const httpConfigurations: HttpConfigurations = {
  port: env("HTTP_PORT", 4719),
  host: env("HTTP_HOST", "127.0.0.1"),
  log: false,
};

export default httpConfigurations;
