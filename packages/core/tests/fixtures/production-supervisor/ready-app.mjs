// Stands in for a bundle that boots successfully: it reports readiness exactly
// the way `sendBootSignal` does — handshake flag, one message, then disconnect.
//
// Nothing else is scheduled, so this process can only exit if the IPC channel
// was actually closed. A missing `disconnect()` would hold a ref on the event
// loop and hang here, which is the point: the test proves the channel is
// released, not just that the message was sent.
if (process.env.WARLOCK_BOOT_SIGNAL === "1") {
  process.send(
    {
      type: "warlock:ready",
      version: 1,
      pid: process.pid,
      at: new Date().toISOString(),
      environment: "production",
      runtimeStrategy: "production",
      bootDurationMs: 7,
      port: 3000,
    },
    undefined,
    undefined,
    () => {
      process.disconnect();
    },
  );
}
