import type { LogChannel } from "@warlock.js/logger";
import { log } from "@warlock.js/logger";
import { environment } from "../utils";
import type { LogConfigurations } from "./types";

export function setLogConfigurations(options: LogConfigurations) {
  // log configurations
  const channels: LogChannel[] = [];

  const env = environment();

  const envOptions = options[env as "development" | "test" | "production"];

  // the environment flag wins over the top-level flag
  const enabled = envOptions?.enabled ?? options.enabled ?? true;

  if (!enabled) {
    log.configure({ channels: [] });
    return;
  }

  const envChannels = envOptions?.channels;
  const defaultChannels = options.channels;

  if (defaultChannels) {
    channels.push(...defaultChannels);
  }

  if (envChannels) {
    channels.push(...envChannels);
  }

  log.configure({
    channels,
  });
}
