/**
 * A small PNG decoder and comparer, `node:zlib` only. Chrome writes 8-bit,
 * non-interlaced images (grey, grey+alpha, RGB or RGBA); anything else cannot
 * be decoded here and the caller falls back to comparing the bytes.
 */
import { inflateSync } from "node:zlib";

/** A decoded image: 8-bit RGBA pixels, row after row. */
export type DecodedPng = { width: number; height: number; data: Uint8Array };

/** How two images compare. */
export type PngComparison = {
  /** `true` when the size differs or more than `ratio` of the pixels differ by more than `delta` in a channel. */
  changed: boolean;
  /** Pixels that differ by more than the channel delta; `null` when the size differs. */
  differing: number | null;
  /** `differing` over the pixel count; `null` when the size differs. */
  ratio: number | null;
};

/** A pixel differs when any channel differs by more than this. */
export const PIXEL_DELTA = 16;
/** An image changed when more than this share of its pixels differ (0.1%). */
export const PIXEL_RATIO = 0.001;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Decode a PNG, or `null` when it is not an 8-bit non-interlaced grey, RGB or RGBA image. */
export function decodePng(bytes: Uint8Array): DecodedPng | null {
  if (bytes.length < 33 || SIGNATURE.some((value, index) => bytes[index] !== value)) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let colorType = -1;
  const chunks: Uint8Array[] = [];
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      if (length < 13) return null;

      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);

      const depth = body[8];
      colorType = body[9] ?? -1;

      if (depth !== 8 || body[12] !== 0 || CHANNELS[colorType] === undefined) return null;
    } else if (type === "IDAT") {
      chunks.push(body);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  const channels = CHANNELS[colorType];

  if (channels === undefined || width === 0 || height === 0 || chunks.length === 0) return null;

  let raw: Uint8Array;

  try {
    raw = inflateSync(Buffer.concat(chunks));
  } catch {
    return null;
  }

  const stride = width * channels;

  if (raw.length < height * (stride + 1)) return null;

  const rows = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const source = y * (stride + 1) + 1;
    const target = y * stride;

    for (let x = 0; x < stride; x++) {
      const value = raw[source + x] ?? 0;
      const left = x >= channels ? (rows[target + x - channels] ?? 0) : 0;
      const up = y > 0 ? (rows[target - stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (rows[target - stride + x - channels] ?? 0) : 0;
      let predicted: number;

      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = up;
          break;
        case 3:
          predicted = (left + up) >> 1;
          break;
        case 4:
          predicted = paeth(left, up, upLeft);
          break;
        default:
          return null;
      }

      rows[target + x] = (value + predicted) & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const from = pixel * channels;
    const to = pixel * 4;

    if (channels === 4) {
      data.set(rows.subarray(from, from + 4), to);
    } else if (channels === 3) {
      data.set(rows.subarray(from, from + 3), to);
      data[to + 3] = 255;
    } else {
      const grey = rows[from] ?? 0;

      data[to] = grey;
      data[to + 1] = grey;
      data[to + 2] = grey;
      data[to + 3] = channels === 2 ? (rows[from + 1] ?? 255) : 255;
    }
  }

  return { width, height, data };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);

  if (toLeft <= toUp && toLeft <= toUpLeft) return left;

  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * Compare two images: changed when the size differs, or when more than 0.1%
 * of the pixels differ by more than 16 in any channel. Equal bytes are never
 * changed.
 */
export function comparePng(
  before: Uint8Array,
  after: Uint8Array,
  limits: { delta?: number; ratio?: number } = {},
): PngComparison {
  if (Buffer.compare(before, after) === 0) return { changed: false, differing: 0, ratio: 0 };

  const left = decodePng(before);
  const right = decodePng(after);

  // Not decodable here: the bytes differ, so the image counts as changed.
  if (left === null || right === null) return { changed: true, differing: null, ratio: null };
  if (left.width !== right.width || left.height !== right.height) {
    return { changed: true, differing: null, ratio: null };
  }

  const delta = limits.delta ?? PIXEL_DELTA;
  const allowed = limits.ratio ?? PIXEL_RATIO;
  const pixels = left.width * left.height;
  let differing = 0;

  for (let pixel = 0; pixel < pixels; pixel++) {
    const at = pixel * 4;

    if (
      Math.abs((left.data[at] ?? 0) - (right.data[at] ?? 0)) > delta ||
      Math.abs((left.data[at + 1] ?? 0) - (right.data[at + 1] ?? 0)) > delta ||
      Math.abs((left.data[at + 2] ?? 0) - (right.data[at + 2] ?? 0)) > delta ||
      Math.abs((left.data[at + 3] ?? 0) - (right.data[at + 3] ?? 0)) > delta
    ) {
      differing++;
    }
  }

  const ratio = differing / pixels;

  return { changed: ratio > allowed, differing, ratio };
}
