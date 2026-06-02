---
name: process-image
description: 'Transform images with the `Image` class — resize, crop, rotate, format, quality, watermark, blur, etc. — using a deferred pipeline that runs only at `save()` / `toBuffer()` / `toBase64()` / `toDataUrl()` time. Requires sharp via `warlock add image`. Triggers: `Image`, `Image.fromFile`, `Image.fromBuffer`, `Image.fromUrl`, `.resize`, `.crop`, `.watermark`, `.toBuffer`, `.toDataUrl`, `.apply`; "resize an image", "generate a thumbnail", "watermark a product photo", "build an image pipeline"; typical import `import { Image } from "@warlock.js/core"`. Skip: multipart upload entry — `@warlock.js/core/upload-file/SKILL.md`; storage persistence — `@warlock.js/core/store-file/SKILL.md`; competing libs `sharp` direct, `jimp`, `imagemagick`, `gm`.'
---

# Warlock — process an image

`Image` (from `@warlock.js/core`) wraps `sharp` with a **deferred pipeline**: every chainable method (`resize`, `crop`, `format`, `quality`, `watermark`, ...) records an operation; only `save()` / `toBuffer()` / `toBase64()` / `toDataUrl()` actually run sharp. The constructor and chain stay synchronous; one `await` at the end fires the whole pipeline.

`sharp` is lazy-loaded — the framework throws a clear install hint if it isn't there.

## The shape

```ts
import { Image } from "@warlock.js/core";

// All chaining is synchronous — single await at the end
await new Image("./photo.jpg")
  .resize({ width: 800 })
  .format("webp")
  .quality(85)
  .save("./output.webp");
```

That's the full contract. The chain doesn't touch sharp until the output method fires.

## Installation

```bash
warlock add image
```

Adds `sharp` to your dependencies. Skip it and the first `new Image(...)` throws with an install hint.

## Constructors

```ts
new Image("./avatar.jpg")            // path
new Image(buffer)                     // Buffer
new Image(uint8Array)                 // Uint8Array
new Image(arrayBuffer)                // ArrayBuffer
new Image(existingSharpInstance)      // wrap a sharp.Sharp you already built

// Or via static factories:
Image.fromFile("./avatar.jpg");
Image.fromBuffer(buffer);
await Image.fromUrl("https://example.com/photo.jpg");   // @mongez/http under the hood
```

`Image.fromUrl(...)` is the only async factory — it fetches the URL via `@mongez/http` (`responseType: "arrayBuffer"`), then wraps the bytes. The rest are synchronous.

## Transforms (chainable)

Every method returns `this` so calls chain. Transforms are descriptors; nothing runs until the output method.

| Method                                       | Effect                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `.resize({ width?, height?, fit?, ... })`    | sharp resize — accepts the full `sharp.ResizeOptions` shape                  |
| `.crop({ left, top, width, height })`        | extract a region                                                             |
| `.rotate(deg)`                               | clockwise rotation                                                           |
| `.flip()`                                    | mirror vertically (top↔bottom)                                               |
| `.flop()`                                    | mirror horizontally (left↔right)                                             |
| `.blur(sigma)`                               | gaussian blur (sigma is required, must be ≥ 0.3 — throws otherwise)          |
| `.sharpen(options?)`                         | sharp's sharpen                                                              |
| `.grayscale()` / `.blackAndWhite()`          | grayscale (aliases)                                                          |
| `.tint(color)`                               | color tint                                                                   |
| `.negate(options?)`                          | invert colors                                                                |
| `.opacity(value)`                            | 0–100, applied via composite                                                 |
| `.trim(options?)`                            | trim borders                                                                 |
| `.watermark(image, options?)`                | overlay one watermark — two positional args (`image` accepts the same inputs as the constructor, plus another `Image`; `options` is `sharp.OverlayOptions`) |
| `.watermarks([{ image, options }, ...])`     | overlay many — one `WatermarkConfig` object (`{ image, options }`) per entry  |
| `.format(format)`                            | output format — `"jpeg"`, `"png"`, `"webp"`, `"avif"`, `"tiff"`, `"heif"`, ... |
| `.quality(1–100)`                            | lossy formats only (`jpeg` / `webp` / `avif` / `tiff` / `heif`); ignored otherwise |
| `.apply(options)`                            | apply many transforms in one call, in a fixed canonical order                |

`apply(options)` accepts an `ImageTransformOptions` object — every transform above as a key. Useful when transforms come from config or a request payload.

## Outputs

Each of these fires the pipeline exactly once and returns the result. Subsequent calls run the pipeline again (operations aren't memoised).

```ts
await image.save("./output.webp");          // write to disk; returns the absolute path
const buffer = await image.toBuffer();      // → Buffer
const base64 = await image.toBase64();      // → "iVBORw0KGgo..."
const dataUrl = await image.toDataUrl();    // → "data:image/webp;base64,..."
```

## Common patterns

### Resize an uploaded avatar to two sizes

```ts
import { Image } from "@warlock.js/core";

const buffer = await uploadedAvatar.buffer();

await new Image(buffer)
  .resize({ width: 400, height: 400 })
  .format("webp")
  .quality(85)
  .save("./storage/uploads/avatars/full.webp");

await new Image(buffer)
  .resize({ width: 100, height: 100 })
  .format("webp")
  .quality(80)
  .save("./storage/uploads/avatars/thumb.webp");
```

Two separate `Image` instances → two pipelines. They don't share state.

### Watermark + resize + format

```ts
await new Image(productPhoto)
  .resize({ width: 1200 })
  .watermark("./assets/logo.png", { gravity: "southeast" })
  .quality(90)
  .save("./output.jpg");
```

The chained `.watermark(image, options)` takes two positional arguments. (The object form `{ image, options }` is only used inside `apply({ watermark: {...} })` and `.watermarks([...])`.)

### Batch transforms via `apply()`

```ts
await new Image(buffer)
  .apply({
    resize: { width: 800 },
    grayscale: true,
    blur: 2,
    format: "webp",
    quality: 80,
  })
  .save("./output.webp");
```

`apply()` runs operations in a fixed canonical order: resize → crop → rotate → flip/flop → grayscale/blackAndWhite → blur → sharpen → tint → negate → trim → watermark(s) → opacity → format/quality. If you need a different order (e.g. blur **before** resize), use the fluent chain.

### Read metadata

```ts
const metadata = await new Image(buffer).image.metadata();
console.log(metadata.width, metadata.height, metadata.format);
```

The wrapper exposes the underlying `sharp.Sharp` via `.image` for anything not surfaced through chainable methods. Operations through `.image` bypass the deferred pipeline — they run immediately.

## Composition with `UploadedFile`

`UploadedFile` (from multipart uploads) has its own chainable `.resize().format().quality().save(...)` that runs through `Image` internally — same deferred execution, same transforms. Use it when the source is a multipart upload; reach for `new Image(...)` directly when the source is a buffer/path/URL.

See [`upload-file`](../upload-file/SKILL.md) for the multipart entry point and [`store-file`](../store-file/SKILL.md) for persisting the output through storage drivers.

## Gotchas

- **`sharp` is required.** Without `warlock add image`, the constructor throws with an install hint. Lazy-loaded — error fires at first use, not at module import.
- **One `Image` = one pipeline run.** Calling `save()` twice runs the pipeline twice. To reuse output, capture the buffer once with `toBuffer()` and reuse it.
- **`.quality(...)` is silently ignored on PNG.** PNG is lossless. JPEG, WebP, AVIF, TIFF, HEIF honor it.
- **`apply()` ordering is canonical, not insertion order.** If the order matters, chain manually.
- **`.image` is the raw sharp instance.** Operations on it bypass the deferred pipeline and run immediately — useful for metadata, dangerous if you mix it with chained transforms.
- **`Image.fromUrl(...)` makes a network call** (via `@mongez/http`). It throws if the response is empty or errors. Wrap with `retry(...)` if the source URL can be flaky.

## See also

- [`upload-file/SKILL.md`](../upload-file/SKILL.md) — multipart uploads, where image transforms typically start.
- [`store-file/SKILL.md`](../store-file/SKILL.md) — persisting image output through storage drivers (local / S3 / R2 / Spaces).
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — where image-processing services live.
