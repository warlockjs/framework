import config from "@mongez/config";
import Fastify from "fastify";
import { Request } from "../request";
import { Response } from "../response";
import { createUploadedFileController, uploadedFileController } from "./uploaded-file.controller";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storage } from "../../storage";
import type { StorageDriverContract } from "../../storage/types";
import { generateImageVariants } from "./generate-image-variants";
import { purgeImageVariants } from "./purge-image-variants";
import { resolveImageVariant } from "./resolve-image-variant";
import * as cacheTrim from "./trim-image-variant-cache";

let root: string;
let buffer: Buffer;
let driver: StorageDriverContract;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "remote-variants-"));
  buffer = await sharp({ create: { width: 64, height: 32, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  driver = {
    name: "s3",
    options: { bucket: "photos", region: "eu-west-1", prefix: "tenant" },
    url: (key: string) => `https://cdn.example.com/${key}`,
    applyPrefix: (key: string) => `tenant/${key}`,
    metadata: vi.fn(async () => ({ size: buffer.length, isDirectory: false })),
    getStream: vi.fn(async () => Readable.from([buffer])),
  } as unknown as StorageDriverContract;
  vi.spyOn(storage, "root").mockReturnValue(".");
  vi.spyOn(storage, "getDriver").mockImplementation(() => driver);
  vi.spyOn(storage, "activeDriver", "get").mockImplementation(() => driver);
  config.set("uploads", {
    images: { variants: { thumb: { width: 16 } }, formats: ["webp"], cacheDirectory: root },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  config.set("uploads", {});
  await fs.rm(root, { recursive: true, force: true });
});

describe("remote disk image variants", () => {
  it("uses ETag metadata on hits and coalesces concurrent misses across variants", async () => {
    // The initial misses schedule background work independently of later hits.
    // Isolate that work so it cannot race the no-hit-sweep assertions.
    const schedule = vi
      .spyOn(cacheTrim, "scheduleImageVariantCacheTrim")
      .mockImplementation(() => {});
    let etag = "revision-a";
    vi.mocked(driver.metadata).mockImplementation(async () => ({
      path: "photo.png",
      name: "photo.png",
      size: buffer.length,
      isDirectory: false,
      etag,
      lastModified: new Date(10),
    }));
    config.set("uploads.images.variants.card", { width: 32 });
    const input = { disk: "cloud", path: "photo.png", variant: "thumb" };
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        resolveImageVariant({ ...input, variant: index % 2 ? "card" : "thumb" }),
      ),
    );
    expect(driver.getStream).toHaveBeenCalledTimes(1);
    const first = (await resolveImageVariant(input))!;
    vi.mocked(driver.getStream).mockClear();
    schedule.mockClear();
    const readdir = vi.spyOn(fs, "readdir");
    await Promise.all(Array.from({ length: 20 }, () => resolveImageVariant(input)));
    expect(driver.getStream).not.toHaveBeenCalled();
    expect(readdir).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    etag = "revision-b";
    const revised = (await resolveImageVariant(input))!;
    expect(revised.hash).not.toBe(first.hash);
    expect(driver.getStream).toHaveBeenCalledTimes(1);
  });

  it("downloads a remote ingest source once for every variant and format", async () => {
    vi.mocked(driver.metadata).mockImplementation(async () => ({
      path: "photo.png",
      name: "photo.png",
      size: buffer.length,
      isDirectory: false,
      etag: "revision",
    }));
    config.set("uploads.images.variants.card", { width: 32 });
    config.set("uploads.images.formats", ["webp", "avif"]);
    const descriptor = await generateImageVariants("photo.png", { disk: "cloud" });
    expect(Object.keys(descriptor.variants)).toEqual(["thumb", "card"]);
    expect(driver.getStream).toHaveBeenCalledTimes(1);
    expect(driver.metadata).toHaveBeenCalledTimes(1);
  });

  it("coalesces fallback downloads for sources without ETags", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        resolveImageVariant({ disk: "cloud", path: "photo.png", variant: "thumb" }),
      ),
    );
    expect(driver.getStream).toHaveBeenCalledTimes(1);
  });
  it("serves remote derivatives through a scoped controller and leaves originals to the driver", async () => {
    const app = Fastify();
    const controller = createUploadedFileController({ disk: "cloud" });
    const register = (route: string, handler: typeof controller) =>
      app.get(route, async (incoming, outgoing) => {
        const request = new Request();
        const response = new Response();
        response.setResponse(outgoing);
        request.response = response;
        response.request = request;
        request.setRequest(incoming).setRoute({ method: "GET", path: "/cloud-images/*" } as never);
        await handler({ request, response });
        return outgoing;
      });
    register("/cloud-images/*", controller);
    register("/uploads/*", uploadedFileController);
    register("/default-cloud/*", createUploadedFileController({ remote: true }));
    try {
      expect((await app.inject("/uploads/private.png?variant=thumb")).statusCode).toBe(404);
      expect(driver.metadata).not.toHaveBeenCalled();
      expect((await app.inject("/default-cloud/photo.png?variant=thumb")).statusCode).toBe(200);
      const rendered = await app.inject("/cloud-images/photo.png?variant=thumb&format=webp");
      expect(rendered.statusCode).toBe(200);
      expect(rendered.headers["content-type"]).toBe("image/webp");
      expect(rendered.headers["x-content-type-options"]).toBe("nosniff");
      expect((await app.inject("/cloud-images/photo.png")).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
  it("renders a non-default disk, reuses derivatives, and invalidates rewritten bytes without metadata", async () => {
    const input = { disk: "cloud", path: "photo.png", variant: "thumb", format: "webp" as const };
    const first = (await resolveImageVariant(input))!;
    // From a buffer: sharp keeps a file it opened locked on Windows, which blocks the purge below.
    expect(await sharp(await fs.readFile(first.absolutePath)).metadata()).toMatchObject({
      width: 16,
      height: 8,
      format: "webp",
    });
    const stat = await fs.stat(first.absolutePath);
    expect((await resolveImageVariant(input))?.absolutePath).toBe(first.absolutePath);
    expect((await fs.stat(first.absolutePath)).mtimeMs).toBe(stat.mtimeMs);
    buffer = await sharp({ create: { width: 64, height: 32, channels: 3, background: "blue" } })
      .png()
      .toBuffer();
    expect((await resolveImageVariant(input))?.hash).not.toBe(first.hash);
    expect(await purgeImageVariants("photo.png", { disk: "cloud" })).toBe(true);
    await expect(fs.access(first.absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("includes effective prefixes and buckets in source identity", async () => {
    const first = (await resolveImageVariant({
      disk: "cloud",
      path: "photo.png",
      variant: "thumb",
    }))!;
    driver.applyPrefix = (key) => `other-tenant/${key}`;
    const second = (await resolveImageVariant({
      disk: "cloud",
      path: "photo.png",
      variant: "thumb",
    }))!;
    expect(first.absolutePath).not.toBe(second.absolutePath);
    expect(first.hash).not.toBe(second.hash);
  });

  it("generates an ingest descriptor with the route prefix of a remote disk", async () => {
    const descriptor = await generateImageVariants("photo.png", {
      disk: "cloud",
      urlPrefix: "/private-images",
    });
    expect(descriptor).toMatchObject({
      src: "https://cdn.example.com/photo.png",
      width: 64,
      height: 32,
      variants: {
        thumb: {
          width: 16,
          height: 8,
          url: "/private-images/photo.png?variant=thumb",
          urls: { webp: "/private-images/photo.png?variant=thumb&format=webp" },
        },
      },
    });
  });

  it("rejects traversal before contacting the object store", async () => {
    expect(
      await resolveImageVariant({ disk: "cloud", path: "../photo.png", variant: "thumb" }),
    ).toBeUndefined();
    expect(driver.metadata).not.toHaveBeenCalled();
  });

  it("bounds the actual streamed bytes even when metadata understates the size", async () => {
    config.set("uploads.images.maxSourceBytes", 10);
    vi.mocked(driver.metadata).mockResolvedValue({
      size: 1,
      isDirectory: false,
      path: "photo.png",
      name: "photo.png",
    });
    await expect(
      resolveImageVariant({ disk: "cloud", path: "photo.png", variant: "thumb" }),
    ).rejects.toMatchObject({ status: 413 });
  });
});
