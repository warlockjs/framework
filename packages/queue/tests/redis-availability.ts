import { createConnection } from "node:net";

/** Probe the configured test service without a Redis client or reconnect loop. */
export function pingRedis(host: string, port: number, timeout = 1000): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    let received = "";
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(available);
    };
    const timer = setTimeout(() => finish(false), timeout);
    socket.once("error", () => finish(false));
    socket.once("end", () => finish(false));
    socket.once("connect", () => socket.write("*1\r\n$4\r\nPING\r\n"));
    socket.on("data", chunk => {
      received += chunk.toString();
      if (received.includes("\r\n")) finish(received === "+PONG\r\n");
    });
  });
}

export async function redisTestsAvailable(
  env: NodeJS.ProcessEnv = process.env,
  report: (message: string) => void = console.warn,
): Promise<boolean> {
  const host = env.QUEUE_REDIS_HOST ?? "127.0.0.1";
  const port = Number(env.QUEUE_REDIS_PORT ?? 6390);
  if (await pingRedis(host, port)) return true;
  const message = `Redis test service unavailable at ${host}:${port}. Start Redis or set QUEUE_REDIS_HOST/QUEUE_REDIS_PORT.`;
  if ((env.CI && env.CI !== "0" && env.CI !== "false") || env.WARLOCK_REDIS_INTEGRATION === "1") {
    throw new Error(message + " Redis is required for this run.");
  }
  report(message + " Skipping Redis integration cases; unit tests still run.");
  return false;
}
