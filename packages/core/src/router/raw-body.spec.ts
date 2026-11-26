import { createHmac } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRawBody } from "../http/raw-body";
import { router } from "./router";

const secret = "whsec_test";

/** Echoes what the route sees: parsed body, raw text and whether the HMAC over the raw text matches. */
const handled = (_route: any) => async (request: any, reply: any) => {
  const raw = readRawBody(request);
  const signature = createHmac("sha256", secret)
    .update(raw ?? "")
    .digest("hex");

  reply.code(200);

  return {
    output: {
      parsed: request.body,
      raw: raw?.toString("utf8"),
      signature,
    },
    response: { baseResponse: undefined },
  };
};

describe("route option rawBody", () => {
  let server: FastifyInstance | undefined;

  beforeEach(() => {
    (router as any).routes = [];
    vi.spyOn(router as any, "handleRoute").mockImplementation(handled as any);
  });

  afterEach(async () => {
    await server?.close();
    vi.restoreAllMocks();
    (router as any).routes = [];
  });

  // Whitespace and key order a re-serialised body would lose.
  const sent = '{ "b": 2,  "a": 1 }';

  for (const mode of ["production", "dev"] as const) {
    it(`keeps the exact bytes in ${mode} so an HMAC over them verifies`, async () => {
      router.post("/hook", () => undefined, { rawBody: true });
      router.post("/plain", () => undefined);
      server = Fastify();

      if (mode === "dev") router.scanDevServer(server);
      else router.scan(server);

      await server.ready();

      const hook = await server.inject({
        method: "POST",
        url: "/hook",
        headers: { "content-type": "application/json" },
        payload: sent,
      });
      const plain = await server.inject({
        method: "POST",
        url: "/plain",
        headers: { "content-type": "application/json" },
        payload: sent,
      });

      expect(hook.statusCode).toBe(200);
      expect(hook.json().raw).toBe(sent);
      expect(hook.json().parsed).toEqual({ b: 2, a: 1 });
      expect(hook.json().signature).toBe(createHmac("sha256", secret).update(sent).digest("hex"));
      expect(plain.json().raw).toBeUndefined();
    });
  }

  it("still refuses a body above the route limit", async () => {
    router.post("/hook", () => undefined, { rawBody: true, serverOptions: { bodyLimit: 8 } });
    server = Fastify();
    router.scanDevServer(server);
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: "/hook",
      headers: { "content-type": "application/json" },
      payload: sent,
    });

    expect(response.statusCode).toBe(413);
  });
});
