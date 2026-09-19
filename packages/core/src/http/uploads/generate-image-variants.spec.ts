import config from "@mongez/config";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Image } from "../../image";
import { storage } from "../../storage";
import { HttpError } from "../errors";
import { Request } from "../request";
import { Response } from "../response";
import type { UploadsImagesConfigurations } from "../uploads-types";
import { generateImageVariants } from "./generate-image-variants";
import { uploadedFileController } from "./uploaded-file.controller";

/**
 * `generateImageVariants` — the ingest-time counterpart of
 * `uploadedFileController`. Fixtures mirror the controller spec: a temp
 * storage root, a real image made with sharp, and the same config shape.
 */

type SharpModule = typeof import("sharp");

async function loadSharp(): Promise<SharpModule | undefined> {
  try {
    const module = await import("sharp");

    return ((module as { default?: SharpModule }).default ?? module) as SharpModule;
  } catch {
    return undefined;
  }
}

const sharp = await loadSharp();

if (!sharp) {
  console.warn(
    "[generate-image-variants.spec] sharp is not installed in core's dev dependencies; specs are skipped.",
  );
}

let workspace: string;
let storageRoot: string;
let cacheDirectory: string;
let app: FastifyInstance;

function imagesConfig(overrides: Partial<UploadsImagesConfigurations> = {}): void {
  config.set("uploads", {
    images: {
      variants: {
        thumb: { width: 32 },
        card: { width: 48, height: 48, fit: "cover", quality: 70 },
      },
      formats: ["webp", "avif"],
      cacheDirectory,
      ...overrides,
    },
  });
}

async function makeImage(
  format: "jpeg" | "png" | "webp" | "gif",
  width = 64,
  height = 64,
  color = { r: 200, g: 40, b: 40 },
): Promise<Buffer> {
  return sharp!({ create: { width, height, channels: 3, background: color } })
    .toFormat(format)
    .toBuffer();
}

function get(url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "GET", url, headers });
}

beforeAll(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-ingest-"));
  storageRoot = path.join(workspace, "storage");
  cacheDirectory = path.join(storageRoot, ".cache", "image-variants");

  fs.mkdirSync(storageRoot, { recursive: true });

  vi.spyOn(storage, "root").mockImplementation((appended?: string) =>
    path.join(storageRoot, appended ?? ""),
  );

  app = Fastify();
  app.get("/uploads/*", async (fastifyRequest, fastifyReply) => {
    const request = new Request();
    const response = new Response();
    response.setResponse(fastifyReply);
    request.response = response;
    response.request = request;
    request.setRequest(fastifyRequest).setRoute({ method: "GET", path: "/uploads/*" } as never);

    await uploadedFileController({ request, response });

    return fastifyReply;
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.restoreAllMocks();
  config.set("uploads", {});
  fs.rmSync(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  imagesConfig();
});

afterEach(() => {
  fs.rmSync(cacheDirectory, { recursive: true, force: true });
  if (vi.isMockFunction(Image.prototype.save)) {
    vi.mocked(Image.prototype.save).mockRestore();
  }
});

describe.skipIf(!sharp)("generateImageVariants — cache parity with the route", () => {
  it("writes derivatives the route then serves from cache, without generating again", async () => {
    fs.writeFileSync(path.join(storageRoot, "hero.jpg"), await makeImage("jpeg", 64, 64));

    const descriptor = await generateImageVariants("hero.jpg");

    expect(descriptor.variants.thumb).toBeDefined();
    expect(descriptor.variants.card).toBeDefined();

    const save = vi.spyOn(Image.prototype, "save");

    const result = await get("/uploads/hero.jpg?variant=thumb");

    expect(result.statusCode).toBe(200);
    expect(save).not.toHaveBeenCalled();
    expect((await sharp!(result.rawPayload).metadata()).width).toBe(32);
  });

  it("serves a requested extra format from the same file the helper wrote", async () => {
    fs.writeFileSync(path.join(storageRoot, "hero2.jpg"), await makeImage("jpeg", 64, 64));

    await generateImageVariants("hero2.jpg");

    const save = vi.spyOn(Image.prototype, "save");

    const result = await get("/uploads/hero2.jpg?variant=card&format=webp");

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("image/webp");
    expect(save).not.toHaveBeenCalled();
  });
});

describe.skipIf(!sharp)("generateImageVariants — descriptor shape", () => {
  it("returns a descriptor matching web's ImageDescriptor field for field", async () => {
    fs.writeFileSync(path.join(storageRoot, "shape.jpg"), await makeImage("jpeg", 64, 64));

    const descriptor = await generateImageVariants("shape.jpg");

    expect(descriptor.src).toBe("/uploads/shape.jpg");
    expect(descriptor.width).toBe(64);
    expect(descriptor.height).toBe(64);
    expect(descriptor.formats).toEqual(["webp", "avif"]);

    expect(descriptor.variants.thumb).toEqual({
      width: 32,
      height: 32,
      url: "/uploads/shape.jpg?variant=thumb",
      urls: {
        webp: "/uploads/shape.jpg?variant=thumb&format=webp",
        avif: "/uploads/shape.jpg?variant=thumb&format=avif",
      },
    });

    expect(descriptor.variants.card).toEqual({
      width: 48,
      height: 48,
      url: "/uploads/shape.jpg?variant=card",
      urls: {
        webp: "/uploads/shape.jpg?variant=card&format=webp",
        avif: "/uploads/shape.jpg?variant=card&format=avif",
      },
    });
  });

  it("computes the actual output height for a width-only variant on a non-square source", async () => {
    fs.writeFileSync(path.join(storageRoot, "wide.jpg"), await makeImage("jpeg", 100, 50));

    const descriptor = await generateImageVariants("wide.jpg", { variants: ["thumb"] });

    expect(descriptor.variants.thumb.width).toBe(32);
    expect(descriptor.variants.thumb.height).toBe(16);
  });
});

describe.skipIf(!sharp)("generateImageVariants — variants filter", () => {
  it("only generates the requested variants", async () => {
    fs.writeFileSync(path.join(storageRoot, "filtered.jpg"), await makeImage("jpeg", 64, 64));

    const descriptor = await generateImageVariants("filtered.jpg", { variants: ["thumb"] });

    expect(Object.keys(descriptor.variants)).toEqual(["thumb"]);
  });

  it("rejects an unknown variant name", async () => {
    fs.writeFileSync(path.join(storageRoot, "unknown.jpg"), await makeImage("jpeg", 64, 64));

    await expect(generateImageVariants("unknown.jpg", { variants: ["huge"] })).rejects.toThrow(
      HttpError,
    );
  });
});

describe.skipIf(!sharp)("generateImageVariants — source guards", () => {
  it("rejects a traversal path", async () => {
    fs.writeFileSync(path.join(workspace, "sibling.txt"), "TOP-SECRET");

    await expect(generateImageVariants("../sibling.txt")).rejects.toThrow(HttpError);

    try {
      await generateImageVariants("../sibling.txt");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
    }
  });

  it("rejects a gif source with 415", async () => {
    fs.writeFileSync(path.join(storageRoot, "anim.gif"), await makeImage("gif"));

    await expect(generateImageVariants("anim.gif")).rejects.toThrow(HttpError);

    try {
      await generateImageVariants("anim.gif");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(415);
    }
  });
});
