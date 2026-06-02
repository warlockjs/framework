---
name: upload-file
description: 'Handle multipart file uploads — read via `request.file()` or `request.validated()`, validate with `v.file()`, save via `UploadedFile.save()` or the storage layer, transform images inline. Triggers: `UploadedFile`, `request.file`, `v.file`, `.save`, `.saveAs`, `.resize`, `.format`, `.quality`, `.image`, `.mimeType`, `.maxSize`; "accept a file upload", "validate file size and mime", "save to S3 or local disk", "resize an uploaded image on save"; typical import `import type { UploadedFile, RequestHandler } from "@warlock.js/core"`. Skip: storage drivers + presigned URLs — `@warlock.js/core/store-file/SKILL.md`; image-only transforms — `@warlock.js/core/process-image/SKILL.md`; schema rules — `@warlock.js/core/validate-input/SKILL.md`; competing libs `multer`, `formidable`, `busboy`.'
---

# Warlock — upload a file

Multipart uploads come in as `UploadedFile` instances. The class wraps Fastify's multipart data and adds a fluent API for validation, image transforms, and storage. Save with `.save(directory)` for auto-naming or `.saveAs(path)` for an explicit path; both return a `StorageFile` with the final path/URL.

## The shape

```ts title="src/app/uploads/schema/index.ts"
import { v } from "@warlock.js/seal";

export const uploadAvatarSchema = v.object({
  avatar: v
    .file()
    .image()
    .maxSize({ unit: "MB", size: 5 })
    .mimeType(["image/jpeg", "image/png", "image/webp"]),
});
```

```ts title="src/app/uploads/controllers/upload-avatar.controller.ts"
import { type GuardedRequestHandler } from "app/auth/types/guarded-request.type";
import { type UploadAvatarSchema, uploadAvatarSchema } from "../schema/upload-avatar.schema";

export const uploadAvatarController: GuardedRequestHandler<UploadAvatarSchema> = async (
  request,
  response,
) => {
  const { avatar } = request.validated();

  const file = await avatar
    .resize(400, 400)
    .format("webp")
    .quality(85)
    .save(`avatars/${request.user.id}`);

  return response.successCreate({ path: file.path, url: file.url });
};

uploadAvatarController.validation = {
  schema: uploadAvatarSchema,
};
```

That's the full flow: schema declares the validation (value + type from one file in `schema/`), controller uses `GuardedRequestHandler<UploadAvatarSchema>` (or `RequestHandler<Request<UploadAvatarSchema>>` for public routes), pull from `request.validated()`, chain transforms, save to disk. The result is a `StorageFile` with `path`, `url`, `mimeType`, and the rest.

## Reading the file

Inside a controller:

```ts
import type { RequestHandler, UploadedFile } from "@warlock.js/core";

export const uploadController: RequestHandler = async (request, response) => {
  // option A — direct from request, no validation
  const file: UploadedFile | undefined = request.file("avatar");

  if (!file) {
    return response.badRequest({ error: "missing file" });
  }

  // option B — typed via the schema (preferred when you've defined one)
  const { avatar } = request.validated<{ avatar: UploadedFile }>();
};
```

`request.file(key)` returns `UploadedFile | undefined`. With a schema attached, `request.validated()` is typed via `Infer<typeof schema>` so the file field comes out as `UploadedFile` directly.

For multi-file uploads, use an array schema (`v.array(v.file())`) — the validated value is `UploadedFile[]`.

## The `UploadedFile` API

From `@warlock.js/core/src/http/uploaded-file.ts`:

| Member                              | Returns                | Notes                                                  |
| ----------------------------------- | ---------------------- | ------------------------------------------------------ |
| `file.name`                         | `string`               | sanitized original filename                            |
| `file.mimeType`                     | `string`               | e.g. `"image/jpeg"`                                    |
| `file.extension`                    | `string`               | lowercased, no dot — e.g. `"jpg"`                      |
| `file.isImage` / `isVideo` / `isAudio` | `boolean`           | MIME-type prefix checks                                |
| `await file.size()`                 | `number` (bytes)       | buffers the file on first call                         |
| `await file.buffer()`               | `Buffer`               | cached after first call                                |
| `await file.dimensions()`           | `{ width?, height? }`  | empty object if not an image                           |
| `await file.metadata()`             | `{ name, mimeType, extension, size, width?, height? }` | one-shot metadata |
| `await file.toImage()`              | `Image`                | for advanced transforms outside the fluent API         |
| `await file.toJSON()`               | metadata + base64      | for serialization / debugging                          |

Image transforms (chainable, no-op for non-images):

| Method                          | Notes                                  |
| ------------------------------- | -------------------------------------- |
| `.resize(width, height?)`       | proportional if `height` omitted       |
| `.format(format)`               | `"jpeg" | "png" | "webp" | "avif" | ...` — extension is auto-updated |
| `.quality(1–100)`               | JPEG/WebP/AVIF only                    |
| `.rotate(deg)`                  | positive = clockwise                   |
| `.blur(sigma?)`                 | default `3`, min `0.3`                 |
| `.grayscale()`                  | —                                      |
| `.transform(opts | callback)`   | full sharp/`ImageTransformOptions` control |

Save:

```ts
await file.save(directory, options?);   // auto-named, returns StorageFile
await file.saveAs(fullPath, options?);  // explicit path, returns StorageFile
```

Driver selection:

```ts
await file.use("s3").save("avatars");        // single upload
await file.use("r2").saveAs("cdn/x.webp");
```

## Save options

```ts
type SaveOptions = {
  name?: "random" | "original" | string; // default "random"
  prefix?:
    | true                                  // default datetime prefix
    | string                                // static prefix
    | {
        format?: string;                    // dayjs-style format
        randomLength?: number;
        as?: "file" | "directory";          // default "file"
      };
  driver?: StorageDriverName;
  validate?: FileValidationOptions;         // throws on mismatch
};
```

```ts
// Random name (default): avatars/x7k9m2p4.jpg
await file.save("avatars");

// Keep original: avatars/photo.jpg
await file.save("avatars", { name: "original" });

// Date directory + random name: avatars/2026/05/23/x7k9m2p4.jpg
await file.save("avatars", {
  prefix: { format: "YYYY/MM/DD", as: "directory" },
});

// Validate-then-save in one call
await file.save("avatars", {
  validate: {
    allowedMimeTypes: ["image/jpeg", "image/png"],
    maxSize: 5 * 1024 * 1024,
  },
});
```

For an explicit path, `saveAs` skips naming/prefix logic:

```ts
await file.saveAs("avatars/profile-123.png");
```

## What `save()` returns: `StorageFile`

```ts
const stored = await file.save("avatars");

stored.path;          // "avatars/x7k9m2p4.webp" (after format transform)
stored.url;           // public URL (driver-dependent)
await stored.size();
await stored.mimeType();
stored.extension;
await stored.data();  // full info object incl. hash
```

`StorageFile` is the standard handle returned by every `Storage.put()` / `UploadedFile.save()` call. Use it from then on — the `UploadedFile` is best discarded after save.

## Saving directly via the storage layer

`UploadedFile.save()` is the shortcut. For full control, drop to the storage API and pass the buffer:

```ts
import { storage } from "@warlock.js/core";

const buffer = await file.buffer();

const stored = await storage.use("s3").put(buffer, "uploads/manual/file.bin", {
  mimeType: file.mimeType,
});
```

`storage.put(content, location, options)` accepts `Buffer | string | UploadedFile | Readable`. Also: `putStream`, `putFromUrl`, `putFromBase64`. Use the storage layer directly for non-file payloads (already-processed buffers, programmatically generated content) and `UploadedFile.save()` for raw multipart uploads.

## Validation rules

Inside a seal schema, file rules chain on `v.file()`:

```ts
v.file()                                          // must be UploadedFile
  .image()                                        // must be image MIME
  .accept(["jpg", "png", "webp"])                 // extension allowlist
  .mimeType(["image/jpeg", "image/png"])          // MIME allowlist
  .pdf() / .excel() / .word()                     // shortcuts
  .minSize({ unit: "KB", size: 10 })
  .maxSize({ unit: "MB", size: 5 })
  .minWidth(200).maxWidth(4000)
  .minHeight(200).maxHeight(4000);
```

Size accepts either bytes (`.maxSize(5_242_880)`) or `{ unit, size }` (`{ unit: "MB", size: 5 }`). See [`validate-input`](../validate-input/SKILL.md) for the full validation pattern.

For ad-hoc validation outside a schema:

```ts
await file.validate({
  allowedMimeTypes: ["image/jpeg", "image/png"],
  allowedExtensions: ["jpg", "jpeg", "png"],
  maxSize: 5 * 1024 * 1024,
});
// throws on mismatch
```

## Common patterns

### Multi-file upload

```ts title="src/app/uploads/schema/index.ts"
import { v } from "@warlock.js/seal";

export const uploadFilesSchema = v.object({
  files: v
    .array(v.file().maxSize({ unit: "MB", size: 50 }).mimeType(ALLOWED_MIME_TYPES))
    .maxLength(5),
});
```

```ts title="src/app/uploads/controllers/create-upload.controller.ts"
import type { RequestHandler } from "@warlock.js/core";

export const createUploadController: RequestHandler = async (request, response) => {
  const { files } = request.validated();

  const saved = await Promise.all(
    files.map((file) =>
      file.save(`uploads/${request.user.organizationId}`, {
        prefix: { as: "directory", format: "DD-MM-YYYY" },
      }),
    ),
  );

  return response.successCreate({ uploads: saved.map((f) => ({ path: f.path })) });
};
```

### Image processing pipeline

```ts
const thumb = await avatar.resize(200, 200).format("webp").quality(80).save("avatars/thumb");

const full = await avatar.resize(1200).format("webp").quality(90).save("avatars/full");
```

Each chain produces a fresh transform — but `UploadedFile` is stateful, so do this once and keep references to the saved `StorageFile`s.

### Saving to S3 with a content type override

```ts
const file = await uploadedFile
  .use("s3")
  .save("documents", { name: "original" });

// or, full storage layer:
await storage.use("s3").put(await uploadedFile.buffer(), "documents/report.pdf", {
  mimeType: "application/pdf",
  cacheControl: "max-age=31536000",
});
```

### Stream a download from a stored file

The reverse direction — sending a stored file back via `response.sendFile(...)` is the cleanest path. For dynamic content, use `response.stream(...)`. See [`send-response`](../send-response/SKILL.md).

## Gotchas

- **`file.buffer()` reads the entire file into memory.** For large uploads, prefer `Storage.putStream(...)` (drop straight from `request.file().fileData.file` if you have access — but in most cases `save()` is fine).
- **Image transforms only apply to images.** `file.resize(...).save(...)` on a PDF is a no-op for the resize and a successful save for the file.
- **`save()` rewrites the extension on format change.** `file.format("webp").save("avatars")` produces `avatars/<name>.webp` regardless of the upload's original extension.
- **`.use(driver)` mutates the instance.** It returns `this`; subsequent saves on the same instance keep the driver. Re-instantiate or call `.use("local")` to reset.
- **Multipart parsing needs `fileUploadLimit` headroom.** Default is `10MB` (configurable via `http.fileUploadLimit` in `src/config/http.ts`). Schema `maxSize` is checked after parsing, so set the multipart limit at least as high.
- **`request.file("key")` returns `undefined` for missing files** — no throw. Always check before chaining.
- **The hash is empty until save.** `file.hash` is populated by the SHA-256 from `StorageFile.data()` after `save()` resolves.

## See also

- [`validate-input/SKILL.md`](../validate-input/SKILL.md) — `v.file()` rules and the validation pipeline.
- [`create-controller/SKILL.md`](../create-controller/SKILL.md) — pulling files from `request.validated()` vs `request.file()`.
- [`send-response/SKILL.md`](../send-response/SKILL.md) — `response.sendFile(...)` for serving the stored file back.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — storage configuration and driver selection.
