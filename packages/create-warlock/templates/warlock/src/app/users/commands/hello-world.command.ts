/** A sample command that logs a greeting; copy it to add your own. */
import { command } from "@warlock.js/core";
import { log } from "@warlock.js/logger";

export default command({
  name: "hello.world",
  action: () => {
    log.info("users", "hello.world", "Hello World!");
  },
});
