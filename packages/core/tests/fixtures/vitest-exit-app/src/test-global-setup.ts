import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core/tests";

export async function setup() {
  await startHttpTestServer({ port: 0, web: false });
}

export async function teardown() {
  await stopHttpTestServer();
}
