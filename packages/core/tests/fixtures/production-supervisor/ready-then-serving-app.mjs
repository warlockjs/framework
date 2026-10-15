// A booted app that keeps serving after reporting readiness: the channel is
// closed but the process stays alive on its own work, exactly like a bound http
// server would. Proves disconnecting does not end the application.
//
// The env guard mirrors `sendBootSignal` — signalling only a parent that
// identified itself. Reaching the send at all proves the supervisor set it.
if (process.env.WARLOCK_BOOT_SIGNAL === "1") {
  process.send(
    {
      type: "warlock:ready",
      version: 1,
      pid: process.pid,
      at: new Date().toISOString(),
      environment: "production",
      runtimeStrategy: "production",
    },
    undefined,
    undefined,
    () => {
      process.disconnect();
    },
  );
}

setTimeout(() => {
  process.exit(0);
}, 150);
