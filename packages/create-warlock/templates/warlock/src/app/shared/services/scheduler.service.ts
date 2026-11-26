/** The app's single scheduler; modules register their jobs on it. */
import { Scheduler } from "@warlock.js/scheduler";

export const scheduler = new Scheduler();
