import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core/tests";

export async function setup() {
  // The web connector (and its Vite dev server) boots only when the spawning
  // test asks for it with `EXIT_APP_WEB=1`.
  await startHttpTestServer({ port: 0, web: process.env.EXIT_APP_WEB === "1" });
}

export async function teardown() {
  await stopHttpTestServer();
}
