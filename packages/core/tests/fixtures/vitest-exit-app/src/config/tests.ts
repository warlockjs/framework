// "file" (the default) or "worker", chosen by the spawning test.
export default {
  lifetime: process.env.EXIT_APP_LIFETIME === "worker" ? "worker" : "file",
  // Test workers serve no pages. With the web connector configured, the global
  // setup server owns the only Vite dev server; workers start just the
  // connectors a spec can use.
  ...(process.env.EXIT_APP_WEB === "1" ? { connectors: ["logger", "cache"] } : {}),
};
