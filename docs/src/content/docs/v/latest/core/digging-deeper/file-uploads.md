---
title: "File uploads"
description: Multipart uploads in Warlock — UploadedFile API, validation, save shortcuts, image transforms, storage driver selection, and the upload size config.
sidebar:
  order: 2
  label: "File uploads"
---

Multipart uploads in Warlock follow the same shape as everything else: declare the schema, attach it to the controller, read typed `UploadedFile` instances from `request.validated()`, save them with one call. The framework's multipart plugin does the parsing; the `UploadedFile` class does the rest.

This page covers the full lifecycle: from receiving a `multipart/form-data` body to having the bytes on disk (or S3, R2, anywhere) with a `StorageFile` reference you can persist.

## Mental model

When a multipart body arrives, the framework's Fastify multipart plugin attaches each file field as an `UploadedFile` instance on `request.body`. The validation layer treats files like any other field — `v.file()` validators apply size, mime, dimension checks. The controller pulls files out of `request.validated()` or `request.file(key)`, then calls `.save(directory)` to persist them through the storage layer.

```ts
import type { UploadedFile } from "@warlock.js/core";

// 1. arrives as UploadedFile
const file = request.file("avatar");

// 2. validate (optional — usually done in schema)
await file.validate({ allowedMimeTypes: ["image/png"], maxSize: 5 * 1024 * 1024 });

// 3. transform (optional, images only)
file.resize(400, 400).format("webp").quality(85);

// 4. save → StorageFile
const stored = await file.save("avatars", {
  prefix: { format: "yyyy/mm/dd", as: "directory" },
});

// 5. persist the path/hash to your DB
await Avatar.create({ path: stored.path, hash: file.hash });
```

You never construct an `UploadedFile` yourself. The framework does it when it parses a multipart body.

## Configuring the upload size limit

The framework sets `fileUploadLimit` (in bytes) per-file via the multipart plugin. Default is 10 MB. Override in `src/config/http.ts`:

```ts title="src/config/http.ts"
import type { HttpConfigurations } from "@warlock.js/core";

const httpConfigurations: HttpConfigurations = {
  fileUploadLimit: 50 * 1024 * 1024,   // 50 MB per file
  // ...
};

export default httpConfigurations;
```

This is a Fastify plugin limit — the multipart parser rejects bodies that exceed it before the request ever hits a controller. Set it generously above your largest expected file, then validate stricter limits in the schema per-field.

## Reading files from the request

Two readers on `Request`:

```ts
const single = request.file("avatar");        // UploadedFile | undefined
const many = request.files("attachments");    // UploadedFile[]
```

Use `files(key)` when the multipart field is repeated (`<input name="files" multiple>`). It returns an array; `[]` if nothing arrived.

In schema-driven controllers, **always** prefer `request.validated()` — the schema runs first, so by the time you read files, size and mime checks already passed:

```ts title="src/app/uploads/controllers/create-upload.controller.ts"
import { type RequestHandler } from "@warlock.js/core";
import { type UploadRequest } from "../requests";
import { uploadSchema } from "../schema";
import { createUploadService } from "../services/create-upload.service";

export const createUploadController: RequestHandler = async (
  request: UploadRequest,
  response,
) => {
  const { files } = request.validated();   // UploadedFile[] — already validated

  const uploads = await Promise.all(
    files.map((file) =>
      createUploadService({
        file,
        organizationId: request.user?.organizationId!,
        uploadedBy: request.user?.uuid,
      }),
    ),
  );

  return response.success({ uploads });
};

createUploadController.validation = {
  schema: uploadSchema,
};
```

The matching schema:

```ts title="src/app/uploads/schema/index.ts"
import { type UploadedFile } from "@warlock.js/core";
import { v } from "@warlock.js/seal";

const ALLOWED_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf",
  "audio/mpeg", "audio/wav",
  "video/mp4",
];

export const uploadSchema = v.object({
  files: v
    .array(v.file().maxSize({ unit: "MB", size: 50 }).mimeType(ALLOWED_MIME_TYPES))
    .maxLength(5),
});

export type UploadSchema = { files: UploadedFile[] };
```

Five files, 50 MB each, allowed types declared once.

## The `UploadedFile` API

The class is in `@warlock.js/core/src/http/uploaded-file.ts`. The surface is split into properties, type-checks, transforms, and save operations.

### Properties

| Property             | Type                           | Note                                            |
| -------------------- | ------------------------------ | ----------------------------------------------- |
| `file.name`          | `string`                       | sanitised filename                              |
| `file.mimeType`      | `string`                       | e.g. `"image/jpeg"`, `"application/pdf"`        |
| `file.extension`     | `string`                       | lowercase, no dot — `"jpg"`, `"pdf"`            |
| `file.hash`          | `string`                       | SHA-256 hash, populated after `.save()`         |
| `await file.size()`  | `Promise<number>`              | byte length (buffers content on first call)     |
| `await file.buffer()`| `Promise<Buffer>`              | full content, cached after first call           |
| `file.isImage`       | `boolean`                      | MIME starts with `"image"`                      |
| `file.isVideo`       | `boolean`                      | MIME starts with `"video"`                      |
| `file.isAudio`       | `boolean`                      | MIME starts with `"audio"`                      |

Two more — both useful for resources / API responses:

```ts
const info = await file.metadata();
// { name, mimeType, extension, size, width?, height? }

const json = await file.toJSON();
// { name, mimeType, extension, size, isImage, isVideo, isAudio, dimensions, base64 }
```

`toJSON()` includes the file content as base64 — only call it when you actually want to ship the bytes inline. For most server-side flows you'll `save()` the file and persist the resulting path/hash instead.

### Type checks and dimensions

```ts
if (file.isImage) {
  const dims = await file.dimensions();   // { width, height }
}
```

`dimensions()` reads image metadata via the framework's `Image` class (Sharp under the hood). Non-images return `{}`.

### Inline validation

If you don't validate via the schema (rare, but sometimes for ad-hoc admin endpoints), use `file.validate(...)`:

```ts
await file.validate({
  allowedMimeTypes: ["image/jpeg", "image/png"],
  allowedExtensions: ["jpg", "png"],
  maxSize: 5 * 1024 * 1024,
});
```

This **throws** if validation fails (it's not the framework's gentle 400 path — that's what schemas are for). Wrap in try/catch or just let it propagate to the framework's error handler.

## Saving files

Two methods: `save(directory, options?)` (automatic naming) and `saveAs(location, options?)` (explicit path).

### `save(directory, options?)`

The framework picks the filename based on `options.name` and the global uploads config:

| Strategy       | Filename                                     |
| -------------- | -------------------------------------------- |
| `"random"`     | random alphanumeric (default; length from config) |
| `"original"`   | sanitised original filename                  |
| custom string  | uses your name, auto-appends extension       |

```ts
// random name (default)
await file.save("avatars");
// → avatars/x7k9m2p4abcdef.jpg

// original name
await file.save("avatars", { name: "original" });
// → avatars/cute-cat.jpg

// with a date prefix as a directory segment
await file.save("avatars", {
  prefix: { format: "yyyy/mm/dd", as: "directory" },
});
// → avatars/2026/05/22/x7k9m2p4abcdef.jpg

// original name with date prefix glued to filename
await file.save("avatars", {
  name: "original",
  prefix: { format: "DD-MM-YYYY", as: "file" },
});
// → avatars/22-05-2026-cute-cat.jpg
```

`prefix` accepts:

- `true` — use the default datetime format from the uploads config
- `string` — static prefix, e.g. `"avatar-"` or `"user-42-"`
- `PrefixOptions` — `{ format, randomLength, as }` for full control

`save()` returns a `StorageFile` with the persisted path, MIME type, and (if you call `data()`) hash. The `file.hash` property is also populated.

### `saveAs(location, options?)`

Same as `save()` but you pass the **full path**. No automatic naming or prefix.

```ts
await file.saveAs("avatars/profile-123.png");
await file.saveAs("products/2026/featured-image.webp");
```

Use this when the path comes from upstream code (a service that owns the naming convention).

### Choosing the storage driver

By default `save()` writes to the configured default storage. Override per upload with `.use(driver)`:

```ts
await file.use("s3").save("avatars");
await file.use("r2").save("cdn/images");
```

Or via the options:

```ts
await file.save("avatars", { driver: "s3" });
```

Drivers come from your project's `src/config/storage.ts`. See [Storage](./storage.md) for the full driver setup.

### A real save flow

Here's the actual upload service from the reference codebase — saves to R2, creates an orphaned `uploads` row, and lets the controller link it to an entity later:

```ts title="src/app/uploads/services/create-upload.service.ts"
import type { UploadedFile } from "@warlock.js/core";
import dayjs from "dayjs";
import { Upload } from "../models/upload/upload.model";

type CreateUploadInput = {
  file: UploadedFile;
  organizationId: string;
  uploadedBy?: string;
};

export async function createUploadService({
  file: uploadedFile,
  organizationId,
  uploadedBy,
}: CreateUploadInput): Promise<Upload> {
  const file = await uploadedFile.save(`uploads/${organizationId}`, {
    prefix: { as: "directory", format: "DD-MM-YYYY" },
  });

  const size = await file.size();
  const mimeType = await file.mimeType();
  const expiresAt = dayjs().add(1, "day").toDate();

  return Upload.create({
    organization_id: organizationId,
    uploaded_by: uploadedBy,
    path: file.path,
    mime_type: mimeType,
    extension: file.extension,
    original_name: uploadedFile.name,
    size,
    expires_at: expiresAt,
  });
}
```

The `expires_at` is the project's "orphaned uploads are cleaned up after 24h" policy — a tip you may want to copy for any side-uploaded file that hasn't been linked to its parent entity yet.

## Image transforms

For images, chain transforms before `save()`. Each method returns the file so you can keep chaining:

```ts
await file
  .resize(800, 600)        // width, height (height optional → aspect-preserving)
  .quality(85)             // 1–100
  .format("webp")          // jpeg | png | webp | avif | ...
  .rotate(90)              // degrees clockwise
  .blur(3)                 // sigma
  .grayscale()             // black & white
  .save("avatars");
```

For full control, use `transform()` with either an options object or a callback:

```ts
// options
await file
  .transform({ resize: { width: 800, fit: "inside" }, quality: 85 })
  .save("images");

// callback — full Image API
await file
  .transform((img) =>
    img
      .resize({ width: 800 })
      .watermark("logo.png", { gravity: "southeast" })
      .sharpen(),
  )
  .save("products");
```

If you set `format("webp")`, the saved file's extension and MIME type follow — the framework rewrites the path to `.webp` for you.

Non-image files ignore the image transforms — calling `.resize()` on a PDF is a no-op, not an error.

For deeper image work (chained operations, watermarks, frame extraction from videos), see the dedicated [Image processing](./image-processing.md) guide.

## File validators (`v.file()`)

The framework injects `v.file()` into seal via the `filePlugin` (auto-registered). The returned `FileValidator` chains:

```ts
v.file()                           // required — must be an UploadedFile
v.file().optional()                // optional file field
v.file().image()                   // must be an image
v.file().accept(["jpg", "png"])    // allowed extensions
v.file().mimeType("application/pdf")              // single MIME
v.file().mimeType(["image/png", "image/jpeg"])    // many MIMEs
v.file().pdf()                     // shortcut for application/pdf
v.file().excel()                   // .xls + .xlsx
v.file().word()                    // .doc + .docx

v.file().minSize(1024)                          // bytes
v.file().minSize({ size: 100, unit: "KB" })     // friendly units
v.file().maxSize({ size: 50, unit: "MB" })
v.file().min(1024)   // alias for minSize
v.file().max(1024)   // alias for maxSize

// image-only
v.file().image().minWidth(100).maxWidth(4000)
v.file().image().minHeight(100).maxHeight(4000)
```

Combine for full-fidelity rules:

```ts
v.file()
  .image()
  .mimeType(["image/jpeg", "image/png", "image/webp"])
  .maxSize({ size: 5, unit: "MB" })
  .minWidth(200)
  .maxHeight(4000);
```

For arrays of files:

```ts
v.array(v.file().maxSize({ size: 50, unit: "MB" })).maxLength(5)
```

`v.file().saveTo("path/...")` is a built-in transformer that calls `.save()` after validation and replaces the file value with the resulting path. Handy for one-shot endpoints where the path is the only thing you persist — though most apps prefer to call `.save()` explicitly in a service so they can also store the hash, size, original name, etc.

## Cleanup of orphans

Uploads sometimes happen out-of-band — you accept a file, return its id, and the user attaches it to a chat message minutes later. If the user abandons the flow, you don't want orphaned blobs sitting in storage.

The pattern: store an `expires_at` timestamp when you save, and run a scheduled job to delete uploads where `expires_at < now()` **and** the parent linkage is still null. The reference codebase does this for chat uploads:

```ts
const expiresAt = dayjs().add(1, "day").toDate();

return Upload.create({
  // ...
  entity_id: undefined,    // null — orphaned until attached
  expires_at: expiresAt,
});
```

Then a scheduled task scans for orphans and calls `.destroy()`. The actual storage file is deleted via the `Upload` model's `onDeleted` event hook (deleting the row tears down the file too).

## Gotchas

- **Schema-driven controllers should always read files via `request.validated()`.** It returns the typed `UploadedFile` from the schema, with all size/MIME checks already done. `request.file(key)` is for ad-hoc endpoints without a schema.
- **`file.buffer()` reads the whole file into memory.** Fine for images and PDFs; for video uploads, consider streaming directly to the storage driver instead. The first call buffers; subsequent calls return the cached buffer.
- **`fileUploadLimit` is a per-file limit at the multipart layer.** Once exceeded, Fastify rejects the body before your code sees it. Per-field stricter limits go in the schema with `v.file().maxSize(...)`.
- **`save()` returns a `StorageFile`; that's what you persist.** Store `storageFile.path`, the file's `hash`, MIME type, and original name. Don't persist the `UploadedFile` instance itself.
- **`format("webp")` rewrites the path extension.** If your DB stores file paths, capture them from the returned `StorageFile.path`, not from `file.name` + `file.extension` before save — those still reflect the original upload.
- **Calling `.save()` twice creates two files.** The class doesn't memoise. If you want a single saved file with multiple references, save once and pass the `StorageFile` around.
- **Non-image transforms are ignored, not errors.** `.resize(800)` on a PDF silently does nothing. The transforms are queued; only applied if `file.isImage` is true at save time.

## See also

- **[HTTP request](../the-basics/http-request.md)** — `request.file()` / `request.files()` and the rest of the request surface.
- **[Validation](../the-basics/validation.md)** — wiring `v.file()` into a schema and attaching it to a controller.
- **[Storage](./storage.md)** — drivers, scoped storage, and the `StorageFile` API.
- **[Image processing](./image-processing.md)** — the `Image` class behind the chained transforms.
