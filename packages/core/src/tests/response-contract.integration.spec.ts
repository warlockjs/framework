import { afterEach, describe, expect, it } from "vitest";
import { createTestHttpServer, type TestHttpServer } from "./test-http-server";
import { assertResponseContracts } from "./response-contract";
import { router } from "../router/router";
import type { RequestHandler } from "../router/types";

let app: TestHttpServer | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("response contracts over HTTP", () => {
  it("checks serialized controller output and detects a lying declaration", async () => {
    const valid: RequestHandler = ({ response }) => response.success({ count: 3 });
    valid.responseSchema = { 200: { body: { count: "int" } } };
    const invalid: RequestHandler = ({ response }) => response.success({ count: "three" });
    invalid.responseSchema = valid.responseSchema;
    app = await createTestHttpServer({
      routes: (routes) => {
        routes.get("/contract-valid", valid);
        routes.get("/contract-invalid", invalid);
      },
    });
    await assertResponseContracts({
      routes: router.list().filter((route) => route.path === "/contract-valid"),
      client: app,
      requireAllStatuses: true,
    });
    await expect(assertResponseContracts({ client: app })).rejects.toThrow("does not match");
    await expect(
      assertResponseContracts({
        routes: router.list().filter((route) => route.path === "/contract-invalid"),
        client: app,
      }),
    ).rejects.toThrow("does not match");
  });
});
