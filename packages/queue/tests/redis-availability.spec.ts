import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pingRedis, redisTestsAvailable } from "./redis-availability";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});
async function serve(answer?: string) {
  const server = createServer(socket => {
    socket.on("data", () => {
      if (answer !== undefined) socket.end(answer);
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("Redis test availability", () => {
  it("requires a Redis PONG rather than an open TCP port", async () => {
    expect(await pingRedis("127.0.0.1", await serve("+PONG\r\n"))).toBe(true);
    expect(await pingRedis("127.0.0.1", await serve("HTTP/1.1 200 OK\r\n"))).toBe(false);
    expect(await pingRedis("127.0.0.1", await serve(), 20)).toBe(false);
  });
  it("explains local skips and makes CI and explicitly requested runs fail", async () => {
    const port = await serve("-NOAUTH\r\n");
    const env = { QUEUE_REDIS_HOST: "127.0.0.1", QUEUE_REDIS_PORT: String(port) };
    const report = vi.fn();
    expect(await redisTestsAvailable(env, report)).toBe(false);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("Skipping Redis integration"));
    await expect(redisTestsAvailable({ ...env, CI: "1" }, report)).rejects.toThrow("required");
    await expect(redisTestsAvailable({ ...env, WARLOCK_REDIS_INTEGRATION: "1" }, report)).rejects.toThrow("required");
    expect(report).toHaveBeenCalledTimes(1);
  });
});
