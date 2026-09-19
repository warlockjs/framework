import config from "@mongez/config";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Image } from "../../image";
import { storage } from "../../storage";
import { Request } from "../request";
import { Response } from "../response";
import type { UploadsImagesConfigurations } from "../uploads-types";
import { uploadedFileController } from "./uploaded-file.controller";

/**
 * `uploadedFileController` end to end, through a real Fastify instance so the
 * router's own URL decoding and query parsing are part of what is tested. The
 * storage root is a temp directory; fixtures are real images made with sharp.
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
    "[uploaded-file.controller.spec] sharp is not installed in core's dev dependencies; the image-generation specs are skipped.",
  );
}

const SECRET = "TOP-SECRET-OUTSIDE-THE-STORAGE-ROOT";

let workspace: string;
let storageRoot: string;
let outsideDirectory: string;
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

function listFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .flatMap((entry) => (entry.isFile() ? [path.join(entry.parentPath, entry.name)] : []));
}

function get(url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: "GET", url, headers });
}

beforeAll(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-uploads-"));
  storageRoot = path.join(workspace, "storage");
  outsideDirectory = path.join(workspace, "outside");
  cacheDirectory = path.join(storageRoot, ".cache", "image-variants");

  fs.mkdirSync(storageRoot, { recursive: true });
  fs.mkdirSync(outsideDirectory, { recursive: true });
  fs.writeFileSync(path.join(outsideDirectory, "secret.txt"), SECRET);
  fs.writeFileSync(path.join(workspace, "sibling.txt"), SECRET);
  // a sibling whose name shares the root's prefix: `storage-evil` starts with `storage`
  fs.mkdirSync(path.join(workspace, "storage-evil"));
  fs.writeFileSync(path.join(workspace, "storage-evil", "secret.txt"), SECRET);
  fs.writeFileSync(path.join(storageRoot, "notes.txt"), "hello");

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
});

describe("uploadedFileController — path containment", () => {
  it("serves a file inside the storage root", async () => {
    const result = await get("/uploads/notes.txt");

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe("hello");
  });

  it.each([
    ["an encoded ../ climb", "/uploads/%2e%2e%2fsibling.txt"],
    ["a literal .. with an encoded slash", "/uploads/..%2fsibling.txt"],
    ["a deeper climb from a subdirectory", "/uploads/sub%2f..%2f..%2fsibling.txt"],
    ["an encoded ../ into an outside directory", "/uploads/%2e%2e%2foutside%2fsecret.txt"],
    [
      "a sibling directory sharing the root's name prefix",
      "/uploads/..%2fstorage-evil%2fsecret.txt",
    ],
    ["an encoded backslash climb", "/uploads/..%5csibling.txt"],
  ])("returns 404 for %s and reads nothing outside the root", async (_label, url) => {
    const result = await get(url);

    expect(result.statusCode).toBe(404);
    expect(result.body).not.toContain(SECRET);
  });

  it("returns 404 for an absolute path", async () => {
    const absolute = encodeURIComponent(path.join(workspace, "sibling.txt"));
    const result = await get(`/uploads/${absolute}`);

    expect(result.statusCode).toBe(404);
    expect(result.body).not.toContain(SECRET);
  });

  it("returns 404 for a NUL byte", async () => {
    const result = await get("/uploads/notes.txt%00.png");

    expect(result.statusCode).toBe(404);
  });

  it("does not decode a second time: %252e%252e%252f stays literal", async () => {
    const result = await get("/uploads/%252e%252e%252fsibling.txt");

    expect(result.statusCode).toBe(404);
    expect(result.body).not.toContain(SECRET);
  });

  it("returns 404 for a link that points outside the root", async () => {
    const link = path.join(storageRoot, "escape");

    try {
      fs.symlinkSync(outsideDirectory, link, "junction");
    } catch (error) {
      console.warn(`[uploaded-file.controller.spec] cannot create a link here: ${error}`);
      return;
    }

    try {
      const result = await get("/uploads/escape/secret.txt");

      expect(result.statusCode).toBe(404);
      expect(result.body).not.toContain(SECRET);
    } finally {
      fs.rmSync(link, { recursive: false, force: true });
    }
  });

  it("returns 404 for a missing file", async () => {
    const result = await get("/uploads/missing.txt");

    expect(result.statusCode).toBe(404);
  });

  it("never serves the variant cache directory", async () => {
    fs.mkdirSync(path.join(cacheDirectory, "ab"), { recursive: true });
    fs.writeFileSync(path.join(cacheDirectory, "ab", "abc.webp"), "cached");

    const result = await get("/uploads/.cache/image-variants/ab/abc.webp");

    expect(result.statusCode).toBe(404);
  });
});

describe("uploadedFileController — query allowlist", () => {
  beforeAll(async () => {
    if (!sharp) return;

    fs.writeFileSync(path.join(storageRoot, "photo.jpg"), await makeImage("jpeg"));
  });

  it.each([
    ["an unknown key (the old ?w= resize)", "/uploads/photo.jpg?w=100"],
    ["an unknown key next to a variant", "/uploads/photo.jpg?variant=thumb&h=10"],
    ["a repeated variant key", "/uploads/photo.jpg?variant=thumb&variant=thumb"],
    ["a repeated format key", "/uploads/photo.jpg?variant=thumb&format=webp&format=webp"],
    ["an unknown variant", "/uploads/photo.jpg?variant=huge"],
    ["an inherited property name as variant", "/uploads/photo.jpg?variant=constructor"],
    ["a format outside the allowlist", "/uploads/photo.jpg?variant=thumb&format=png"],
    ["format without variant", "/uploads/photo.jpg?format=webp"],
    ["an empty variant", "/uploads/photo.jpg?variant="],
  ])("returns 400 for %s", async (_label, url) => {
    const result = await get(url);

    expect(result.statusCode).toBe(400);
  });

  it("returns 400 for a format the app did not allow", async () => {
    imagesConfig({ formats: ["webp"] });

    const result = await get("/uploads/photo.jpg?variant=thumb&format=avif");

    expect(result.statusCode).toBe(400);
  });

  it("returns 400 for any variant when no images config exists", async () => {
    config.set("uploads", {});

    const result = await get("/uploads/photo.jpg?variant=thumb");

    expect(result.statusCode).toBe(400);
  });
});

describe.skipIf(!sharp)("uploadedFileController — originals", () => {
  it("serves the original bytes with the long cache when there is no query", async () => {
    const bytes = await makeImage("jpeg");
    fs.writeFileSync(path.join(storageRoot, "original.jpg"), bytes);

    const result = await get("/uploads/original.jpg");

    expect(result.statusCode).toBe(200);
    expect(Buffer.compare(result.rawPayload, bytes)).toBe(0);
    expect(result.headers["content-type"]).toBe("image/jpeg");
    expect(result.headers["cache-control"]).toContain("max-age=31536000");
  });
});

describe("uploadedFileController — content sniffing (security)", () => {
  it("serves an svg with a script as an attachment, sandboxed, and never as its real type", async () => {
    fs.writeFileSync(
      path.join(storageRoot, "evil.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );

    const result = await get("/uploads/evil.svg");

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-disposition"]).toContain("attachment");
    expect(result.headers["content-disposition"]).toContain('filename="evil.svg"');
    expect(result.headers["content-security-policy"]).toBe("sandbox");
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(result.headers["content-type"]).not.toBe("image/svg+xml");
    expect(result.headers["content-type"]).toContain("application/octet-stream");
  });

  it("serves an html original as an attachment", async () => {
    fs.writeFileSync(
      path.join(storageRoot, "page.html"),
      "<script>alert(document.cookie)</script>",
    );

    const result = await get("/uploads/page.html");

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-disposition"]).toContain("attachment");
    expect(result.headers["content-type"]).toContain("application/octet-stream");
  });

  it("serves svg bytes named .png as an attachment, never inline", async () => {
    fs.writeFileSync(
      path.join(storageRoot, "liar.png"),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );

    const result = await get("/uploads/liar.png");

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-disposition"]).toContain("attachment");
  });

  it.skipIf(!sharp)(
    "serves a png original inline, with its image content type and nosniff",
    async () => {
      fs.writeFileSync(path.join(storageRoot, "real.png"), await makeImage("png"));

      const result = await get("/uploads/real.png");

      expect(result.statusCode).toBe(200);
      expect(result.headers["content-disposition"]).toBeUndefined();
      expect(result.headers["content-type"]).toBe("image/png");
      expect(result.headers["x-content-type-options"]).toBe("nosniff");
    },
  );

  it.skipIf(!sharp)(
    "serves jpeg-magic bytes named .html as an attachment, sandboxed, never as text/html",
    async () => {
      fs.writeFileSync(path.join(storageRoot, "polyglot.html"), await makeImage("jpeg"));

      const result = await get("/uploads/polyglot.html");

      expect(result.statusCode).toBe(200);
      expect(result.headers["content-disposition"]).toContain("attachment");
      expect(result.headers["content-security-policy"]).toBe("sandbox");
      expect(result.headers["content-type"]).not.toBe("text/html");
      expect(result.headers["content-type"]).toContain("application/octet-stream");
    },
  );

  it.skipIf(!sharp)(
    "serves png-magic bytes named .jpg as an attachment (raster/extension mismatch)",
    async () => {
      fs.writeFileSync(path.join(storageRoot, "mismatch.jpg"), await makeImage("png"));

      const result = await get("/uploads/mismatch.jpg");

      expect(result.statusCode).toBe(200);
      expect(result.headers["content-disposition"]).toContain("attachment");
      expect(result.headers["content-type"]).not.toBe("image/png");
    },
  );

  it.skipIf(!sharp)("carries nosniff on variant responses too", async () => {
    fs.writeFileSync(path.join(storageRoot, "hero-nosniff.jpg"), await makeImage("jpeg", 64, 64));

    const result = await get("/uploads/hero-nosniff.jpg?variant=thumb");

    expect(result.statusCode).toBe(200);
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe.skipIf(!sharp)("uploadedFileController — source checks", () => {
  it("returns 404 for a variant of a missing source", async () => {
    const result = await get("/uploads/nothing.jpg?variant=thumb");

    expect(result.statusCode).toBe(404);
  });

  it("returns 415 for an svg", async () => {
    fs.writeFileSync(
      path.join(storageRoot, "vector.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    );

    const result = await get("/uploads/vector.svg?variant=thumb");

    expect(result.statusCode).toBe(415);
  });

  it("returns 415 for a gif", async () => {
    fs.writeFileSync(path.join(storageRoot, "anim.gif"), await makeImage("gif"));

    const result = await get("/uploads/anim.gif?variant=thumb");

    expect(result.statusCode).toBe(415);
  });

  it("detects by magic bytes, not by extension: a gif named .jpg is refused", async () => {
    fs.writeFileSync(path.join(storageRoot, "liar.jpg"), await makeImage("gif"));

    const result = await get("/uploads/liar.jpg?variant=thumb");

    expect(result.statusCode).toBe(415);
  });

  it("returns 415 for text named .png", async () => {
    fs.writeFileSync(path.join(storageRoot, "text.png"), "not an image at all");

    const result = await get("/uploads/text.png?variant=thumb");

    expect(result.statusCode).toBe(415);
  });

  it("accepts png and webp sources", async () => {
    fs.writeFileSync(path.join(storageRoot, "source.png"), await makeImage("png"));
    fs.writeFileSync(path.join(storageRoot, "source.webp"), await makeImage("webp"));

    const png = await get("/uploads/source.png?variant=thumb");
    const webp = await get("/uploads/source.webp?variant=thumb");

    expect(png.statusCode).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    expect(webp.statusCode).toBe(200);
    expect(webp.headers["content-type"]).toBe("image/webp");
  });

  it("accepts an avif source when sharp can decode it", async () => {
    const avif = await sharp!({
      create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .avif()
      .toBuffer();
    fs.writeFileSync(path.join(storageRoot, "source.avif"), avif);

    const result = await get("/uploads/source.avif?variant=thumb");

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("image/avif");
  });

  it("returns 413 for a source over maxSourceBytes", async () => {
    fs.writeFileSync(path.join(storageRoot, "heavy.jpg"), await makeImage("jpeg"));
    imagesConfig({ maxSourceBytes: 100 });

    const result = await get("/uploads/heavy.jpg?variant=thumb");

    expect(result.statusCode).toBe(413);
  });

  it("returns 413 for a source over maxSourcePixels", async () => {
    fs.writeFileSync(path.join(storageRoot, "wide.jpg"), await makeImage("jpeg", 64, 64));
    imagesConfig({ maxSourcePixels: 64 * 64 - 1 });

    const result = await get("/uploads/wide.jpg?variant=thumb");

    expect(result.statusCode).toBe(413);
    expect(listFiles(cacheDirectory)).toEqual([]);
  });
});

describe.skipIf(!sharp)("uploadedFileController — variants", () => {
  const source = () => path.join(storageRoot, "hero.jpg");

  beforeEach(async () => {
    fs.writeFileSync(source(), await makeImage("jpeg", 64, 64));
  });

  afterEach(() => {
    if (vi.isMockFunction(Image.prototype.save)) {
      vi.mocked(Image.prototype.save).mockRestore();
    }
  });

  it("generates on the first request and serves from the cache on the second", async () => {
    const save = vi.spyOn(Image.prototype, "save");

    const first = await get("/uploads/hero.jpg?variant=thumb");

    expect(first.statusCode).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(listFiles(cacheDirectory)).toHaveLength(1);

    const second = await get("/uploads/hero.jpg?variant=thumb");

    expect(second.statusCode).toBe(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(Buffer.compare(second.rawPayload, first.rawPayload)).toBe(0);
    expect((await sharp!(first.rawPayload).metadata()).width).toBe(32);
  });

  it("stores the derivative at <cacheDirectory>/<first 2 hex>/<hash>.<ext>", async () => {
    const result = await get("/uploads/hero.jpg?variant=thumb&format=webp");
    const hash = String(result.headers.etag).replaceAll('"', "");

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(cacheDirectory, hash.slice(0, 2), `${hash}.webp`))).toBe(true);
  });

  it("generates once for 10 concurrent misses (single-flight)", async () => {
    const original = Image.prototype.save;
    const save = vi.spyOn(Image.prototype, "save").mockImplementation(async function (
      this: Image,
      target: string,
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));

      return original.call(this, target);
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => get("/uploads/hero.jpg?variant=card")),
    );

    expect(results.map((result) => result.statusCode)).toEqual(Array(10).fill(200));
    expect(save).toHaveBeenCalledTimes(1);

    for (const result of results) {
      expect(Buffer.compare(result.rawPayload, results[0].rawPayload)).toBe(0);
    }
  });

  it("sends immutable cache headers, a hash ETag, and answers 304 on a match", async () => {
    const first = await get("/uploads/hero.jpg?variant=thumb");

    expect(first.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(first.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);

    const second = await get("/uploads/hero.jpg?variant=thumb", {
      "if-none-match": String(first.headers.etag),
    });

    expect(second.statusCode).toBe(304);
    expect(second.rawPayload.length).toBe(0);

    const stale = await get("/uploads/hero.jpg?variant=thumb", { "if-none-match": '"nope"' });

    expect(stale.statusCode).toBe(200);
  });

  it.each([
    ["", "image/jpeg", "jpeg"],
    ["&format=webp", "image/webp", "webp"],
    ["&format=avif", "image/avif", "heif"],
  ])("sets the content type per output format (%s)", async (query, contentType, sharpFormat) => {
    const result = await get(`/uploads/hero.jpg?variant=thumb${query}`);

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe(contentType);
    expect((await sharp!(result.rawPayload).metadata()).format).toBe(sharpFormat);
  });

  it("makes a new derivative when the source changes", async () => {
    const save = vi.spyOn(Image.prototype, "save");
    const before = await get("/uploads/hero.jpg?variant=thumb");

    fs.writeFileSync(source(), await makeImage("jpeg", 96, 80, { r: 10, g: 200, b: 10 }));
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(source(), later, later);

    const after = await get("/uploads/hero.jpg?variant=thumb");

    expect(after.statusCode).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(save).toHaveBeenCalledTimes(2);
    expect(listFiles(cacheDirectory)).toHaveLength(2);
  });

  it("leaves no .tmp- file after a successful generation", async () => {
    await get("/uploads/hero.jpg?variant=card&format=webp");

    const files = listFiles(cacheDirectory);

    expect(files).toHaveLength(1);
    expect(files.filter((file) => file.includes(".tmp-"))).toEqual([]);
  });

  it("returns a bare 500, and leaves no .tmp- or final file, when generation fails", async () => {
    vi.spyOn(Image.prototype, "save").mockImplementation(async (target: string) => {
      fs.writeFileSync(target, "half written");
      throw new Error("disk exploded at /very/secret/internal/path");
    });

    const result = await get("/uploads/hero.jpg?variant=thumb");

    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain("secret/internal");
    expect(result.body).not.toContain("exploded");
    expect(listFiles(cacheDirectory)).toEqual([]);
  });
});
