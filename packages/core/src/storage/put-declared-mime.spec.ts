import { afterEach, describe, expect, it, vi } from "vitest";
import { ScopedStorage } from "./scoped-storage";
import { Storage } from "./storage";
import type { PutOptions, StorageDriverContract, StorageFileData } from "./types";

/**
 * `putFromBase64` / `putFromUrl` must not store the MIME type the client (data
 * URL) or the remote server (Content-Type header) declares: a cloud bucket
 * serves the object with it. The driver derives the type from `location`
 * unless the caller passes `mimeType` explicitly.
 */

function fakeDriver() {
  const put = vi.fn(
    async (_file: unknown, location: string, options?: PutOptions): Promise<StorageFileData> => ({
      path: location,
      url: `/${location}`,
      size: 1,
      hash: "h",
      mimeType: options?.mimeType ?? "image/png",
      driver: "local",
    }),
  );

  return { put, driver: { name: "fake", put } as unknown as StorageDriverContract };
}

function storages() {
  const scopedDriver = fakeDriver();
  const managerDriver = fakeDriver();
  const manager = new Storage();
  (manager as unknown as { _driver: unknown })._driver = managerDriver.driver;

  return [
    {
      name: "ScopedStorage",
      storage: new ScopedStorage(scopedDriver.driver),
      put: scopedDriver.put,
    },
    { name: "Storage", storage: manager, put: managerDriver.put },
  ];
}

const html = `data:text/html;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("put helpers ignore the declared MIME type", () => {
  for (const { name, storage, put } of storages()) {
    it(`${name}.putFromBase64 does not pass the data URL's MIME type to the driver`, async () => {
      await storage.putFromBase64(html, "avatars/u1.png");

      expect(put.mock.calls[0]?.[2]?.mimeType).toBeUndefined();
    });

    it(`${name}.putFromBase64 keeps an explicit mimeType`, async () => {
      await storage.putFromBase64(html, "avatars/u1", { mimeType: "image/png" });

      expect(put.mock.calls.at(-1)?.[2]?.mimeType).toBe("image/png");
    });

    it(`${name}.putFromUrl does not pass the remote Content-Type to the driver`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("<html/>", { headers: { "content-type": "text/html" } })),
      );

      await storage.putFromUrl("http://93.184.216.34/avatar", "avatars/u2.png");

      expect(put.mock.calls.at(-1)?.[2]?.mimeType).toBeUndefined();
    });
  }
});
