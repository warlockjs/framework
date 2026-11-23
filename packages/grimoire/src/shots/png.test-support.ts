/** Spec helper: a tiny PNG encoder (8-bit RGBA, filter 0), `node:zlib` only. */
import { deflateSync } from "node:zlib";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  const tail = Buffer.alloc(4);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);

  head.writeUInt32BE(body.length);
  tail.writeUInt32BE(crc32(typed));

  return Buffer.concat([head, typed, tail]);
}

/** An image of `width` x `height`; `pixel(x, y)` gives `[r, g, b, a]`. */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const rows = Buffer.alloc(height * (width * 4 + 1));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A solid image. */
export function solidPng(
  width: number,
  height: number,
  color: [number, number, number, number] = [255, 255, 255, 255],
): Buffer {
  return encodePng(width, height, () => color);
}
