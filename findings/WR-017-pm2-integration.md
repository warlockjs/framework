# WR-017: pm2 integration for deployment (5.33 if capacity, else 5.34)

Date: 2026-10-19 · Package: @warlock.js/core (CLI) · From: the owner's request plus this server's operations

**Request (optional tooling; pm2 stays outside dependencies):**
- **`warlock pm2 init`:** generate `ecosystem.config.cjs` from app config.
  - `wait_ready` with `process.send("ready")` emitted only after HTTP and the connectors are up.
  - `kill_timeout` matched to core's graceful-shutdown timeout.
  - `listen_timeout`, and a health-check URL.
- **Cluster mode:** set up or warn about socket.io sticky sessions or the socket adapter.
- **Unique names:** `<project>-<app>-<env>`, with stopping by pm2 id documented. On 2026-10-18, stops by name and
  pattern hit other tenants' processes on a shared server.
- **Logs:** pm2 logs feed `@warlock.js/logger`'s format.
- **`warlock pm2 reload`** for zero-downtime restarts.

Not for in-app child processes; see WR-015.
