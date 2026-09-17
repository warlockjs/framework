/**
 * Thrown at boot when `queue.dashboard.enabled` is `true` in production with
 * no guard middleware. The dashboard can retry and delete jobs; mounting it
 * on the open internet without a guard is a production incident waiting to
 * happen, so this fails the boot instead of shipping the hole.
 */
export class QueueDashboardUnguardedError extends Error {
  public constructor() {
    super(
      "queue.dashboard.enabled is true in production with no middleware. The dashboard can " +
        "retry and delete jobs, so it must be guarded before it is exposed.\n\n" +
        "Add a guard middleware:\n\n" +
        "  import { middleware } from \"@warlock.js/core\";\n" +
        "  import { authMiddleware } from \"@warlock.js/auth\";\n\n" +
        "  const queueConfig: QueueConfig = {\n" +
        "    // ...\n" +
        "    dashboard: {\n" +
        "      enabled: true,\n" +
        "      middleware: [authMiddleware(\"admin\")],\n" +
        "    },\n" +
        "  };\n",
    );
    this.name = "QueueDashboardUnguardedError";
  }
}
