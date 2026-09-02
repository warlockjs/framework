import config from "@mongez/config";
import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { startHttpServer } from "../../../src/http/server";

/**
 * Two Fastify defaults the framework used to override in the unsafe direction.
 *
 * `bodyLimit` is asserted through `initialConfig`, which reports what Fastify
 * actually resolved. Asserting a byte count instead would have to guess a
 * threshold, and every guess under the old 200GB default passed — which is why
 * nothing caught it.
 *
 * `trustProxy` is NOT on `initialConfig`, so it is asserted behaviourally: send
 * a forged `X-Forwarded-For` and check whether the framework believes it. That
 * is also the property that matters, since `@fastify/rate-limit` keys its
 * buckets on `request.ip`.
 */
const FASTIFY_DEFAULT_BODY_LIMIT = 1024 * 1024;

const FORGED_IP = "203.0.113.7";

/**
 * `config.set(key, undefined)` does NOT unset — it stores `null`, and a later
 * `config.get(key, fallback)` then returns that `null` instead of the fallback.
 * Resetting that way would leave the next test booting Fastify with
 * `bodyLimit: null`, which throws. Delete the key instead.
 */
function unsetConfig(path: string) {
  const segments = path.split(".");
  const lastSegment = segments.pop() as string;

  let node: Record<string, any> = config.list();

  for (const segment of segments) {
    if (!node[segment]) {
      return;
    }

    node = node[segment];
  }

  delete node[lastSegment];
}

async function resolveRequestIp(server: ReturnType<typeof startHttpServer>) {
  let seenIp = "";

  server.get("/whoami", async (request: FastifyRequest) => {
    seenIp = request.ip;

    return { ok: true };
  });

  await server.inject({
    method: "GET",
    url: "/whoami",
    headers: { "x-forwarded-for": FORGED_IP },
  });

  return seenIp;
}

describe("HTTP server options", () => {
  afterEach(() => {
    unsetConfig("http.bodyLimit");
    unsetConfig("http.trustProxy");
  });

  it("keeps Fastify's own 1MB body limit when the app configures nothing", () => {
    const server = startHttpServer();

    expect(server.initialConfig.bodyLimit).toBe(FASTIFY_DEFAULT_BODY_LIMIT);
  });

  it("honours an explicitly configured body limit", () => {
    config.set("http.bodyLimit", 5 * 1024 * 1024);

    const server = startHttpServer();

    expect(server.initialConfig.bodyLimit).toBe(5 * 1024 * 1024);
  });

  it("ignores a forged X-Forwarded-For unless the app opts in", async () => {
    const server = startHttpServer();

    expect(await resolveRequestIp(server)).not.toBe(FORGED_IP);
  });

  it("resolves X-Forwarded-For when the app opts in", async () => {
    config.set("http.trustProxy", true);

    const server = startHttpServer();

    expect(await resolveRequestIp(server)).toBe(FORGED_IP);
  });

  it("composes an app URL rewrite before trailing-slash normalization", async () => {
    const server = startHttpServer({
      rewriteUrl(request) {
        return request.url?.replace("/legacy", "/current") ?? "/";
      },
    });

    server.get("/current", async () => ({ ok: true }));

    const response = await server.inject({ method: "GET", url: "/legacy/" });

    expect(response.statusCode).toBe(200);
  });
});
