import { type LogConfigurations } from "@warlock.js/core";
import { ConsoleLog } from "@warlock.js/logger";

const consoleLog = new ConsoleLog();

// Production prints one summary line per request: the per-phase request lines
// are `debug`, and printing them costs a console write each on every request.
// Lower `minLevel` to "debug" while investigating an issue.
const productionConsoleLog = new ConsoleLog({ minLevel: "info" });

const logConfigurations: LogConfigurations = {
  enabled: true,
  development: {
    channels: [consoleLog],
    // channels: [consoleLog],
    // channels: [],
  },
  test: {
    // channels: [consoleLog],
    channels: [consoleLog],
  },
  production: {
    channels: [productionConsoleLog],
  },
};

export default logConfigurations;
