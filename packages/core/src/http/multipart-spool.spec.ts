/**
 * With `http.multipart.memoryLimit`, a file part above the limit is streamed to
 * a temporary file: `UploadedFile` behaves the same, `save()` streams it to
 * storage, and the file is removed when the response closes unless kept.
 */
import type { MultipartFile } from "@fastify/multipart";
import config from "@mongez/config";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storage } from "../storage";
import { registerMultipart } from "./multipart";
import { spooledFileCount, spoolOf } from "./multipart-spool";
import { UploadedFile } from "./uploaded-file";

const BOUNDARY = "----warlock-spool-boundary";

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function body(filename: string, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="doc"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

type Seen = { spooled: boolean; size: number; text: string; detected?: string; path?: string };

async function run(
  content: Buffer,
  handler?: (file: UploadedFile) => Promise<void>,
  readFirst = true,
): Promise<{ seen: Seen; status: number }> {
  const server = Fastify();
  let seen!: Seen;

  registerMultipart(server as never);
  server.post("/upload", async (request) => {
    const part = (request.body as { doc: MultipartFile }).doc;
    const file = new UploadedFile(part);
    const spool = spoolOf(part);

    seen = {
      spooled: spool !== undefined,
      size: readFirst ? await file.size() : 0,
      detected: readFirst ? await file.detectedMimeType() : undefined,
      text: readFirst ? (await file.buffer()).toString("latin1") : "",
      path: spool?.path,
    };

    await handler?.(file);

    return { ok: true };
  });
  await server.ready();

  const response = await server.inject({
    method: "POST",
    url: "/upload",
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: body("doc.png", content),
  });

  await server.close();

  return { seen, status: response.statusCode };
}

afterEach(() => {
  config.set("http.multipart", undefined);
  vi.restoreAllMocks();
});

describe("http.multipart.memoryLimit", () => {
  it("keeps every part in memory when unset", async () => {
    const { seen } = await run(Buffer.concat([PNG_HEAD, Buffer.alloc(5000, 1)]));

    expect(seen.spooled).toBe(false);
  });

  it("keeps a part under the limit in memory", async () => {
    config.set("http.multipart", { memoryLimit: 10_000 });

    const { seen } = await run(Buffer.concat([PNG_HEAD, Buffer.alloc(100, 1)]));

    expect(seen.spooled).toBe(false);
    expect(seen.size).toBe(112);
  });

  it("spools a part over the limit, and UploadedFile reads it back unchanged", async () => {
    config.set("http.multipart", { memoryLimit: 1000 });
    const content = Buffer.concat([PNG_HEAD, Buffer.alloc(5000, 7)]);

    const { seen, status } = await run(content);

    expect(status).toBe(200);
    expect(seen.spooled).toBe(true);
    expect(seen.size).toBe(content.length);
    expect(seen.detected).toBe("image/png");
    expect(Buffer.from(seen.text, "latin1").equals(content)).toBe(true);
  });

  it("removes the temporary file when the response closes", async () => {
    config.set("http.multipart", { memoryLimit: 1000 });

    const { seen } = await run(Buffer.alloc(5000, 7));

    await vi.waitFor(() => {
      expect(existsSync(seen.path!)).toBe(false);
      expect(spooledFileCount()).toBe(0);
    });
  });

  it("keeps the temporary file after the response when keep() was called, until discard()", async () => {
    config.set("http.multipart", { memoryLimit: 1000 });
    let kept!: UploadedFile;

    const { seen } = await run(Buffer.alloc(5000, 7), async (file) => {
      kept = file.keep();
    });

    // give the close handler its turn
    await vi.waitFor(() => expect(spooledFileCount()).toBeGreaterThanOrEqual(1));
    expect(existsSync(seen.path!)).toBe(true);

    await kept.discard();

    expect(existsSync(seen.path!)).toBe(false);
  });

  it("streams a spooled file to storage with putStream", async () => {
    config.set("http.multipart", { memoryLimit: 1000 });
    const putStream = vi
      .spyOn(storage, "putStream")
      .mockResolvedValue({ data: async () => ({ hash: "h" }) } as never);
    const put = vi.spyOn(storage, "put");

    await run(
      Buffer.alloc(5000, 7),
      async (file) => {
        await file.save("docs");
      },
      false,
    );

    expect(putStream).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
  });
});
