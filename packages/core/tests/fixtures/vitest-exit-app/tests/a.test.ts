import { createTestHttpServer } from "@warlock.js/core/tests";
import { expect, it } from "vitest";

it("serves a route from an in-process test server", async () => {
  const app = await createTestHttpServer({
    routes: (router) => router.get("/ping", ({ response }) => response.success({ ok: true })),
  });

  try {
    const response = await app.get("/ping");
    expect(response.status).toBe(200);
  } finally {
    await app.close();
  }
});
