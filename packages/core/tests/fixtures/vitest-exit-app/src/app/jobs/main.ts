import { Scheduler } from "@warlock.js/scheduler";

// Mirrors the scaffolded app: a module registers its jobs and starts the
// scheduler from its boot file, and nothing in the app ever stops it. The test
// server must stop it on shutdown, or its timer keeps the Vitest process alive.
const scheduler = new Scheduler();

scheduler.newJob("exit-app-cleanup", async () => undefined).everyHour();

scheduler.start();
