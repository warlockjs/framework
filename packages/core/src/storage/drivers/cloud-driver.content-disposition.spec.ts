import { describe, expect, it, vi } from "vitest";
import { S3Driver } from "./s3-driver";

function makeDriver() {
  const send = vi.fn().mockResolvedValue({ ETag: "e" });
  const driver = new S3Driver({
    bucket: "b",
    region: "us-east-1",
    accessKeyId: "k",
    secretAccessKey: "s",
    retry: { maxRetries: 1, initialDelayMs: 0 },
  });

  (driver as unknown as { client: unknown }).client = { send };

  return { driver, send };
}

function disposition(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.at(0)?.at(0)?.input?.ContentDisposition;
}

describe("CloudDriver content disposition", () => {
  it.each(["logo.svg", "page.html", "feed.xml", "x.svg"])(
    "stores %s as an attachment by default",
    async (key) => {
      const { driver, send } = makeDriver();

      await driver.put(Buffer.from("<svg/>"), `uploads/${key}`, {
        mimeType: "application/octet-stream",
      });

      expect(disposition(send)).toBe("attachment");
    },
  );

  it("stores a declared markup type as an attachment even under another extension", async () => {
    const { driver, send } = makeDriver();

    await driver.put(Buffer.from("x"), "uploads/file.bin", { mimeType: "text/html" });

    expect(disposition(send)).toBe("attachment");
  });

  it("leaves images and documents inline", async () => {
    const { driver, send } = makeDriver();

    await driver.put(Buffer.from("x"), "uploads/photo.png", { mimeType: "image/png" });

    expect(disposition(send)).toBeUndefined();
  });

  it("lets the caller override the default", async () => {
    const { driver, send } = makeDriver();

    await driver.put(Buffer.from("<svg/>"), "uploads/logo.svg", {
      contentDisposition: 'inline; filename="logo.svg"',
    });

    expect(disposition(send)).toBe('inline; filename="logo.svg"');
  });

  it("applies the default to putIfAbsent too", async () => {
    const { driver, send } = makeDriver();

    await driver.putIfAbsent("<svg/>", "uploads/logo.svg");

    expect(disposition(send)).toBe("attachment");
  });
});
