import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RabbitMQDriver } from "../src/drivers/rabbitmq/rabbitmq-driver";

/**
 * Direct reply-to request/respond and reconnect against a real RabbitMQ server.
 * Runs only when `RABBITMQ_URI` names one (for example `amqp://guest:guest@127.0.0.1:5672`).
 * The reconnect test also needs `RABBITMQ_CONTAINER`, the name of the Docker container
 * running the broker, so it can close every connection from the server side.
 */
const uri = process.env.RABBITMQ_URI;
const container = process.env.RABBITMQ_CONTAINER;
const suffix = `${process.pid}-${Date.now()}`;

describe.skipIf(!uri)("real RabbitMQ", () => {
  let driver: RabbitMQDriver;

  beforeAll(async () => {
    driver = new RabbitMQDriver({ driver: "rabbitmq", uri, reconnectDelay: 300 });
    await driver.connect();
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  it("answers a request over direct reply-to", async () => {
    const channel = driver.channel<{ amount: number }>(`live.tax.${suffix}`, { autoDelete: true });

    const subscription = await channel.respond<{ tax: number }>((message) => ({
      tax: message.payload.amount / 10,
    }));

    await expect(
      channel.request<{ tax: number }>({ amount: 1000 }, { timeout: 5_000 }),
    ).resolves.toEqual({
      tax: 100,
    });
    await expect(
      channel.request<{ tax: number }>({ amount: 50 }, { timeout: 5_000 }),
    ).resolves.toEqual({
      tax: 5,
    });

    await subscription.unsubscribe();
  });

  it.skipIf(!container)(
    "reconnects after the server closes the connection and requests keep working",
    async () => {
      const channel = driver.channel<{ n: number }>(`live.echo.${suffix}`, { autoDelete: false });
      await channel.respond<{ n: number }>((message) => ({ n: message.payload.n }));
      await channel.request({ n: 1 }, { timeout: 5_000 });

      const reconnected = vi.fn();
      driver.on("connected", reconnected);

      execFileSync("docker", [
        "exec",
        container!,
        "rabbitmqctl",
        "close_all_connections",
        "live test",
      ]);

      await vi.waitFor(() => expect(reconnected).toHaveBeenCalled(), { timeout: 15_000 });
      await expect(channel.request({ n: 2 }, { timeout: 5_000 })).resolves.toEqual({ n: 2 });
    },
  );
});
