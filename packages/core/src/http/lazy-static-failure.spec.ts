import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerLazyStatic } from "./lazy-static";

const state = vi.hoisted(() => ({ imports: 0 }));
vi.mock("@fastify/static", () => {
  state.imports++;
  return {
    default: async () => {
      throw new Error("static sender unavailable");
    },
  };
});

describe("lazy static initialization failures", () => {
  it("shares a failed initialization and surfaces it through the application error handler", async () => {
    const server = Fastify();
    try {
      server.setErrorHandler((error, _request, reply) =>
        reply.code(500).send({ error: error instanceof Error ? error.message : String(error) }),
      );
      registerLazyStatic(server, { root: process.cwd(), prefix: "/assets/" });
      await server.ready();
      expect(state.imports).toBe(0);
      const responses = await Promise.all([
        server.inject("/assets/one"),
        server.inject("/assets/two"),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([500, 500]);
      expect(responses[0]?.json().error).toBe("static sender unavailable");
      expect(state.imports).toBe(1);
      expect((await server.inject("/assets/three")).statusCode).toBe(500);
      expect(state.imports).toBe(1);
    } finally {
      await server.close();
    }
  });
});
