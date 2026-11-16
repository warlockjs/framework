import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { bootHarness, type HttpHarness } from "../../tests/integration/http/harness";
import type { RequestHandler } from "./types";

let harness: HttpHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  config.set("http.compileResponseSchemas", undefined);
});

function declared(body: Record<string, unknown>) {
  const handler: RequestHandler = ({ response }) => response.success(body);

  handler.responseSchema = {
    200: { body: { id: "number", name: "string", tags: "string[]", address: { city: "string" } } },
  } as never;

  return handler;
}

const row = {
  id: 7,
  name: "Ada",
  tags: ["a"],
  address: { city: "Cairo", street: "hidden" },
  password: "hash",
};

describe("http.compileResponseSchemas", () => {
  it("drops fields the declared schema does not name", async () => {
    config.set("http.compileResponseSchemas", true);
    harness = await bootHarness((router) => {
      router.get("/user", declared(row));
    });

    const response = await harness.inject({ method: "GET", url: "/user" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 7,
      name: "Ada",
      tags: ["a"],
      address: { city: "Cairo" },
    });
  });

  it("keeps the whole body when the option is off", async () => {
    harness = await bootHarness((router) => {
      router.get("/user", declared(row));
    });

    const response = await harness.inject({ method: "GET", url: "/user" });

    expect(response.json()).toEqual(row);
  });

  it("is switched on or off for one route by compileResponseSchema", async () => {
    harness = await bootHarness((router) => {
      router.get("/on", declared(row), { compileResponseSchema: true });
    });

    expect((await harness.inject({ method: "GET", url: "/on" })).json()).not.toHaveProperty(
      "password",
    );

    await harness.close();

    config.set("http.compileResponseSchemas", true);
    harness = await bootHarness((router) => {
      router.get("/off", declared(row), { compileResponseSchema: false });
    });

    expect((await harness.inject({ method: "GET", url: "/off" })).json()).toHaveProperty(
      "password",
    );
  });

  it("does not throw when a declared field is missing from the response", async () => {
    config.set("http.compileResponseSchemas", true);
    harness = await bootHarness((router) => {
      router.get("/partial", declared({ id: 1 }));
    });

    const response = await harness.inject({ method: "GET", url: "/partial" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 1 });
  });
});
