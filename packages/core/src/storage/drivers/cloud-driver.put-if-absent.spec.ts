import { describe, expect, it, vi } from "vitest";
import { S3Driver } from "./s3-driver";
import { DOSpacesDriver } from "./do-spaces-driver";

const options = {
  bucket: "b",
  region: "us-east-1",
  accessKeyId: "k",
  secretAccessKey: "s",
  retry: { maxRetries: 1, initialDelayMs: 0 },
};

/**
 * Build a driver and replace its S3 client with a stub whose `send`
 * records the command and behaves as scripted.
 */
function makeDriver(send: (command: any) => Promise<unknown>) {
  const driver = new S3Driver(options);
  (driver as unknown as { client: unknown }).client = { send };

  return driver;
}

function httpError(status: number, name: string) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

describe("CloudDriver.putIfAbsent()", () => {
  it("sends the PutObjectCommand with IfNoneMatch: *", async () => {
    const send = vi.fn().mockResolvedValue({ ETag: "e" });
    const driver = makeDriver(send);

    const result = await driver.putIfAbsent("hello", "a/b.txt");

    expect(result?.etag).toBe("e");
    expect(send.mock.calls[0][0].input).toMatchObject({
      Key: "a/b.txt",
      IfNoneMatch: "*",
    });
  });

  it("maps 412 to null", async () => {
    const driver = makeDriver(() => Promise.reject(httpError(412, "PreconditionFailed")));

    expect(await driver.putIfAbsent(Buffer.from("x"), "a.txt")).toBeNull();
  });

  it("maps 409 to null", async () => {
    const driver = makeDriver(() =>
      Promise.reject(httpError(409, "ConditionalRequestConflict")),
    );

    expect(await driver.putIfAbsent(Buffer.from("x"), "a.txt")).toBeNull();
  });

  it("throws on 500", async () => {
    const driver = makeDriver(() => Promise.reject(httpError(500, "InternalError")));

    await expect(driver.putIfAbsent(Buffer.from("x"), "a.txt")).rejects.toThrow();
  });
});

describe("DOSpacesDriver.putIfAbsent()", () => {
  it("is not exposed", () => {
    const driver = new DOSpacesDriver(options);

    expect(typeof driver.putIfAbsent).not.toBe("function");
  });
});
