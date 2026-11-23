import { describe, expect, it } from "vitest";
import { comparePng, decodePng } from "./png";
import { encodePng, solidPng } from "./png.test-support";

describe("PNG decode and compare", () => {
  it("decodes the pixels it wrote", () => {
    const decoded = decodePng(encodePng(2, 1, (x) => [x * 100, 5, 6, 255]));

    expect(decoded).toMatchObject({ width: 2, height: 1 });
    expect([...(decoded?.data ?? [])]).toEqual([0, 5, 6, 255, 100, 5, 6, 255]);
  });

  it("returns null for bytes that are not a PNG", () => {
    expect(
      decodePng(Buffer.from("not an image at all, long enough to pass the size guard")),
    ).toBeNull();
  });

  it("calls equal images unchanged", () => {
    expect(comparePng(solidPng(10, 10), solidPng(10, 10))).toEqual({
      changed: false,
      differing: 0,
      ratio: 0,
    });
  });

  it("ignores one pixel in a thousand", () => {
    // 100 x 100 = 10 000 pixels; 10 differ = 0.1%, not over the limit.
    const changed = encodePng(100, 100, (x, y) =>
      y === 0 && x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );

    expect(comparePng(solidPng(100, 100), changed)).toMatchObject({
      changed: false,
      differing: 10,
    });
  });

  it("ignores a difference under the channel delta", () => {
    expect(comparePng(solidPng(10, 10), solidPng(10, 10, [245, 255, 255, 255])).changed).toBe(
      false,
    );
  });

  it("calls an image changed when more than 0.1% of the pixels differ", () => {
    const changed = encodePng(100, 100, (x, y) =>
      y === 0 && x < 11 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );

    expect(comparePng(solidPng(100, 100), changed)).toMatchObject({ changed: true, differing: 11 });
  });

  it("calls a size change a change", () => {
    expect(comparePng(solidPng(10, 10), solidPng(10, 11))).toEqual({
      changed: true,
      differing: null,
      ratio: null,
    });
  });
});
