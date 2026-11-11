import { config } from "../../../../config/config-getter";
import type { DoctorCheck } from "../check.types";
import { isSet, warnOnError } from "./config-values";

/** The parts of a log channel this check reads. */
type ChannelLike = {
  name?: unknown;
  terminal?: unknown;
  acceptsLevel?: unknown;
};

/** Whether a channel writes to the terminal (`ConsoleLog`). */
function isConsoleChannel(channel: unknown): channel is ChannelLike {
  if (typeof channel !== "object" || channel === null) return false;

  const { name, terminal } = channel as ChannelLike;

  return name === "console" || terminal === true;
}

/** Whether the channel prints `debug` entries, by its own level settings. */
function printsDebug(channel: ChannelLike): boolean | undefined {
  const acceptsLevel = channel.acceptsLevel;

  if (typeof acceptsLevel !== "function") return undefined;

  return (acceptsLevel as (level: string) => boolean).call(channel, "debug") === true;
}

/** A config list of channels, or an empty list. */
function channelList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Warns when a console channel used in production prints `debug` entries (no
 * `minLevel` above `debug`, and no `levels` list leaving it out), including the per-phase lines each request
 * writes while `http.log` is on: a console write per line on every request.
 *
 * Reads the production channels the way the logger connector builds them:
 * `log.channels` (every environment) plus `log.production.channels`. The
 * channel's own `acceptsLevel("debug")` answers, so both `minLevel` and
 * `levels` count.
 *
 * NEEDS NO BOOTED APP — it reads config only. Silent when the app has no `log`
 * config, production logging is disabled, or no console channel is used in
 * production.
 */
export const productionLoggingCheck: DoctorCheck = warnOnError({
  name: "production-logging",
  run: () => {
    if (!isSet(config.get("log"))) return undefined;

    // As the logger reads it: the production flag, else the top-level flag,
    // else on; any falsy value turns production logging off.
    const productionEnabled: unknown = config.get("log.production.enabled");
    const enabled: unknown = isSet(productionEnabled)
      ? productionEnabled
      : (config.get("log.enabled") ?? true);

    if (!enabled) return undefined;

    const shared = channelList(config.get("log.channels")).filter(isConsoleChannel);
    const production = channelList(config.get("log.production.channels")).filter(isConsoleChannel);

    if (shared.length === 0 && production.length === 0) return undefined;

    const answers = [
      ...shared.map((channel) => ({ where: "log.channels", debug: printsDebug(channel) })),
      ...production.map((channel) => ({
        where: "log.production.channels",
        debug: printsDebug(channel),
      })),
    ];

    // A channel that cannot say which levels it prints is left out, not guessed.
    const known = answers.filter((answer) => answer.debug !== undefined);

    if (known.length === 0) return undefined;

    const verbose = known.filter((answer) => answer.debug === true).map((answer) => answer.where);

    if (verbose.length === 0) {
      return {
        name: "production-logging",
        status: "ok",
        detail: "the production console channel skips debug lines",
      };
    }

    const where = [...new Set(verbose)].join(" and ");

    return {
      name: "production-logging",
      status: "warn",
      detail:
        `a console channel in production (${where}) prints debug lines, including the ` +
        "per-phase lines of each request: a console write per line on every request. Create it " +
        'with new ConsoleLog({ minLevel: "info" }) in src/config/log.ts.',
    };
  },
});
