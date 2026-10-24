import { ConsoleLog, FileLog } from "@warlock.js/logger";

const channels = [new ConsoleLog(), new FileLog({ storagePath: "storage/logs", name: "exit-app" })];

export default {
  enabled: true,
  development: { channels },
  test: { channels },
  production: { channels },
};
