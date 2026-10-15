import { describe, expect, it, vi } from "vitest";
import { S3Driver } from "./s3-driver";

const options = {
  bucket: "b",
  region: "us-east-1",
  accessKeyId: "k",
  secretAccessKey: "s",
  retry: { maxRetries: 1, initialDelayMs: 0 },
};

function makeDriver(send: (command: any) => Promise<unknown>) {
  const driver = new S3Driver(options);
  (driver as unknown as { client: unknown }).client = { send };

  return driver;
}

describe("CloudDriver.list() prefix", () => {
  it("sends a trailing slash so images-old/ is not matched", async () => {
    const keys = ["images/a.png", "images-old/x"];
    const send = vi.fn().mockImplementation(async (command: any) => ({
      Contents: keys
        .filter((key) => key.startsWith(command.input.Prefix))
        .map((Key) => ({ Key, Size: 1 })),
    }));
    const driver = makeDriver(send);

    const files = await driver.list("images", { recursive: true });

    expect(send.mock.calls.at(0)?.at(0)).toMatchObject({ input: { Prefix: "images/" } });
    expect(files.map((file) => file.path)).toEqual(["images/a.png"]);
  });

  it("keeps the root prefix empty", async () => {
    const send = vi.fn().mockResolvedValue({});
    const driver = makeDriver(send);

    await driver.list("", { recursive: true });

    expect(send.mock.calls.at(0)?.at(0).input.Prefix).toBe("");
  });
});
