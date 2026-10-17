import { cache } from "@warlock.js/cache";
import { environment, router } from "@warlock.js/core";
import { log } from "@warlock.js/logger";

/** Which runtime is serving: the harness checks it matches the one it started. */
function runtimeName(): string {
  return process.versions.bun ? "bun" : process.versions.deno ? "deno" : "node";
}

router.get("/api/runtime", () => {
  return { status: "ok", environment: environment(), runtime: runtimeName() };
});

router.get("/api/cache", async () => {
  const stamp = `${runtimeName()}-${Date.now()}`;

  await cache.set("runtime-acceptance.stamp", stamp, 60);
  log.info("runtime-acceptance", "cache", `stored ${stamp}`);

  return { stored: stamp, read: await cache.get("runtime-acceptance.stamp") };
});

router.post("/api/echo", ({ request }) => {
  return { name: request.input("name"), runtime: runtimeName() };
});
