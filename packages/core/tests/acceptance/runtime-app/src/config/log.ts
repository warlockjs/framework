import { logsPath, type LogConfigurations } from "@warlock.js/core";
import { ConsoleLog, FileLog } from "@warlock.js/logger";

const channels = [
  new ConsoleLog(),
  new FileLog({ storagePath: logsPath(), name: "runtime-acceptance" }),
];

const logConfigurations: LogConfigurations = {
  enabled: true,
  development: { channels },
  test: { channels },
  production: { channels },
};

export default logConfigurations;
