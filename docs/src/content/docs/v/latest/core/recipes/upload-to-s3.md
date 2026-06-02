---
title: "Upload to S3"
description: Wire an S3 (or R2 / DigitalOcean Spaces) disk into Warlock's storage layer, accept multipart uploads, validate file size and MIME type, save via `uploaded.save(...)` or the lowercase `storage` singleton, and serve the result over a public or signed URL.
sidebar:
  order: 10
  label: "Upload to S3"
---

Warlock's storage layer abstracts the disk away — the same `UploadedFile.save(...)` call writes to local disk in dev, S3 in staging, R2 in production. You configure the disks once in `src/config/storage.ts`; everywhere else, you reference them by name. This recipe walks the full path: add the AWS SDK, configure an S3 disk, accept a multipart upload, validate it, save it to the disk, and shape the response.

We'll build `POST /uploads/avatar` — accepts a single image, resizes to 400x400, converts to WebP, saves to S3.

## Step 1 — Install the AWS SDK

Warlock's storage layer talks to S3 via the AWS SDK v3. It's a peer dependency, so you install it in the project:

```bash
yarn add @aws-sdk/client-s3
```

R2 and DigitalOcean Spaces use the same SDK — they're S3-compatible. No separate package per provider.

## Step 2 — Configure an S3 disk

Open `src/config/storage.ts`. The file declares which disks are available and which is the default:

```ts title="src/config/storage.ts"
import {
  env,
  type StorageConfigurations,
  storageConfigurations,
  storagePath,
} from "@warlock.js/core";

const storageOptions: StorageConfigurations = {
  default: "local",
  drivers: {
    local: storageConfigurations.local({
      root: storagePath(),
      urlPrefix: "/uploads",
    }),
    s3: storageConfigurations.aws({
      bucket: env("AWS_S3_BUCKET"),
      region: env("AWS_REGION"),
      accessKeyId: env("AWS_ACCESS_KEY_ID"),
      secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
      urlPrefix: env("AWS_URL_PREFIX"),
    }),
  },
};

export default storageOptions;
```

Five things to notice:

1. **`storageConfigurations.aws({...})`** is the factory — it returns a config object with `driver: "s3"` already stamped. Don't write `{ driver: "s3", ... }` by hand.
2. **The disk name (`"s3"`) is your handle.** Use it everywhere: `storage.use("s3")`, `file.use("s3")`, `{ disk: "s3" }`. Pick a meaningful name (`"public-images"`, `"private-docs"`) — what S3 _is_, not where you are.
3. **`default` picks the disk used when no name is passed.** `storage.put(buf, "path")` writes to whichever disk this names. Keep local as default in dev; switch to S3 in staging/prod via env.
4. **`urlPrefix`** is prepended when generating public URLs. Point it at your CDN domain (`https://cdn.example.com`) and `file.url` returns CDN URLs instead of raw S3 URLs.
5. **The same factory pattern handles R2 (`storageConfigurations.r2`) and DigitalOcean Spaces (`storageConfigurations.spaces`).** R2 also takes an `accountId` and an optional `publicDomain`.

Add the env vars to `.env`:

```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=my-app-uploads
AWS_URL_PREFIX=https://my-app-uploads.s3.us-east-1.amazonaws.com
```

For R2:

```ts
r2: storageConfigurations.r2({
  bucket: env("R2_BUCKET"),
  endpoint: env("R2_ENDPOINT"),
  accessKeyId: env("R2_ACCESS_KEY_ID"),
  secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  accountId: env("R2_ACCOUNT_ID"),
  region: env("R2_REGION", "auto"),
  publicDomain: env("R2_BASE_URL"),
  prefix: "warlock.js",
}),
```

`prefix` is an S3-key prefix that gets prepended to every operation (`production/app-name/...`). Useful when sharing a bucket across environments.

## Step 3 — Generate the uploads module

If you don't have an `uploads` module yet, scaffold one:

```bash
yarn warlock generate.module uploads
yarn warlock generate.controller uploads/upload-avatar --with-validation
```

That gives you the routes file, the controller stub, a schema, and a request type.

## Step 4 — The schema

Multipart fields come into the request as `UploadedFile` instances. Use `v.file()` to validate them — chain `.image()`, `.maxSize()`, `.mimeType()`, etc:

```ts title="src/app/uploads/schema/upload-avatar.schema.ts"
import { v, type Infer } from "@warlock.js/seal";

export const uploadAvatarSchema = v.object({
  avatar: v
    .file()
    .image()
    .maxSize({ unit: "MB", size: 5 })
    .mimeType(["image/jpeg", "image/png", "image/webp"]),
});

export type UploadAvatarSchema = Infer<typeof uploadAvatarSchema>;
```

The methods on `v.file()`:

| Method            | Effect                                                          |
| ----------------- | --------------------------------------------------------------- |
| `.image()`        | Requires the file to be an image (`mimeType.startsWith("image/")`). |
| `.maxSize(opts)`  | Max file size. Accepts `{ unit: "MB"\|"KB"\|"GB", size: N }` or a raw byte count. |
| `.minSize(opts)`  | Min file size. Same shape.                                      |
| `.mimeType(list)` | Allow-list of MIME types. String or array.                      |
| `.accept(exts)`   | Allow-list of file extensions (without the dot).                |
| `.maxWidth(px)` / `.minWidth(px)` | Image-only. Max/min width in pixels.            |
| `.maxHeight(px)` / `.minHeight(px)` | Image-only.                                   |
| `.pdf()` / `.excel()` / `.word()` | Shortcut MIME-type filters.                     |

If validation fails, the framework returns `400` with `errors.avatar = "..."` and your controller never runs.

## Step 5 — The controller

The schema file exports both the value and its inferred type — no separate `*.request.ts` alias. For an authenticated upload, type the handler as `GuardedRequestHandler<UploadAvatarSchema>` (or `RequestHandler<Request<UploadAvatarSchema>>` for a public route):

```ts title="src/app/uploads/controllers/upload-avatar.controller.ts"
import { type GuardedRequestHandler } from "app/auth/types/guarded-request.type";
import {
  type UploadAvatarSchema,
  uploadAvatarSchema,
} from "../schema/upload-avatar.schema";

export const uploadAvatarController: GuardedRequestHandler<UploadAvatarSchema> = async (
  request,
  response,
) => {
  const { avatar } = request.validated();

  const file = await avatar
    .resize(400, 400)
    .format("webp")
    .quality(85)
    .use("s3")
    .save("avatars");

  return response.successCreate({
    path: file.path,
    url: file.url,
    mimeType: file.mimeType,
  });
};

uploadAvatarController.validation = {
  schema: uploadAvatarSchema,
};
```

What's happening, in order:

1. **`request.validated()`** — the schema-typed input. `avatar` is an `UploadedFile`.
2. **`.resize(400, 400)`** — queues an image transform. Doesn't execute yet.
3. **`.format("webp")`** — converts the output format. The final saved file will have a `.webp` extension automatically.
4. **`.quality(85)`** — sets WebP encode quality.
5. **`.use("s3")`** — picks the disk by name. Returns `this`, so chaining continues.
6. **`.save("avatars")`** — _now_ executes: applies the queued transforms, uploads to `s3://my-app-uploads/avatars/<random>.webp`, returns a `StorageFile`.

The `StorageFile` exposes the resolved path, the public URL, the mime type, the size, and a few more — see the storage source for the full surface.

Response:

```json
{
  "path": "avatars/x7k9m2p4.webp",
  "url": "https://my-app-uploads.s3.us-east-1.amazonaws.com/avatars/x7k9m2p4.webp",
  "mimeType": "image/webp"
}
```

Without `urlPrefix` configured, the URL is the raw S3 URL. With it set to your CDN domain, the URL points at the CDN. You typically store `path` in the database (stable, portable) and compute `url` on read (cheap, current with the prefix config).

## Step 6 — Auto-naming and prefixing

`UploadedFile.save(directory, options)` is fluent — the default puts a random filename in the directory you pass. Pass options to control naming:

```ts
await avatar.save("avatars", {
  name: "original",                                           // → avatars/photo.webp
});

await avatar.save("avatars", {
  name: "random",                                             // (default) avatars/x7k9m2p4.webp
});

await avatar.save("avatars", {
  prefix: { format: "yyyy/MM/dd", as: "directory" },          // → avatars/2026/05/23/x7k9m2p4.webp
});

await avatar.save("avatars", {
  name: "original",
  prefix: true,                                               // → avatars/23-05-2026-12-30-45-photo.webp
});

await avatar.save("avatars", {
  driver: "s3",                                               // alternative to .use("s3")
});
```

For an explicit path with no auto-naming, use `saveAs`:

```ts
await avatar.saveAs(`avatars/users/${userId}.webp`);
```

## Step 7 — Register the route

```ts title="src/app/uploads/routes.ts"
import { router } from "@warlock.js/core";
import { guarded } from "app/shared/utils/router";
import { uploadAvatarController } from "./controllers/upload-avatar.controller";

guarded(() => {
  router.post("/uploads/avatar", uploadAvatarController);
});
```

`guarded(...)` requires auth — `request.user` is populated, so you can include the user ID in the path:

```ts
const file = await avatar
  .resize(400, 400)
  .format("webp")
  .use("s3")
  .save(`avatars/${request.user.id}`);
```

## Step 8 — Hit it from curl

```bash
curl -X POST http://localhost:3000/uploads/avatar \
  -H "Authorization: Bearer <token>" \
  -F "avatar=@./test-image.jpg"
```

The `-F` flag uploads a multipart form. The field name (`avatar`) matches the schema field. The response:

```json
{
  "path": "avatars/abc123/x7k9m2p4.webp",
  "url": "https://my-app-uploads.s3.us-east-1.amazonaws.com/avatars/abc123/x7k9m2p4.webp",
  "mimeType": "image/webp"
}
```

## Public URLs vs presigned URLs

S3 objects are private by default. You have two patterns:

### Public bucket, public URLs

If the bucket policy makes objects readable without authentication (the bucket is public), `file.url` is a directly usable URL. You return it from the API; clients fetch it directly. Cheap, fast, works with CDN.

This is the right pattern for: avatars, public product images, anything you'd put on a marketing site.

### Private bucket, presigned URLs

For private content (signed contracts, paid downloads, private documents), keep the bucket private and generate a time-limited presigned URL on demand:

```ts title="src/app/uploads/controllers/get-document-url.controller.ts"
import { storage, type RequestHandler } from "@warlock.js/core";

export const getDocumentUrlController: RequestHandler = async (request, response) => {
  const path = request.input("path");

  const url = await storage.use("s3").temporaryUrl(path, 300); // 5 minutes

  return response.success({ url });
};
```

`temporaryUrl(path, expiresIn)` returns a signed URL that's valid for `expiresIn` seconds. The client uses it as a direct download link.

If you need uploads to bypass your server entirely (large files, mobile clients), get a presigned _upload_ URL from `storage.getPresignedUploadUrl(path, options)`. The client `PUT`s directly to S3.

## Storing the upload in the database

In a real app, you'd track every upload in the DB so you can attach files to entities, audit them, and clean up orphans. The project's `src/app/uploads/` module is a complete example — it has an `Upload` Cascade model with `path`, `mimeType`, `size`, an `entity_id` (initially `NULL`), and an `expires_at` that lets a scheduled job purge orphans.

A simplified version:

```ts title="src/app/uploads/services/save-upload.service.ts"
import type { UploadedFile } from "@warlock.js/core";
import { Upload } from "../models/upload";

type SaveUploadInput = {
  file: UploadedFile;
  directory: string;
  uploadedBy: string;
};

export async function saveUploadService({
  file,
  directory,
  uploadedBy,
}: SaveUploadInput) {
  const storageFile = await file.use("s3").save(directory, {
    prefix: { format: "yyyy/MM/dd", as: "directory" },
  });

  return Upload.create({
    path: storageFile.path,
    url: storageFile.url,
    mime_type: file.mimeType,
    size: await file.size(),
    original_name: file.name,
    uploaded_by: uploadedBy,
  });
}
```

The model row holds the path; the disk holds the bytes. Cleaner separation, easier to audit.

## Multi-file uploads

For uploading multiple files at once, use an array of files in the schema:

```ts
import { v } from "@warlock.js/seal";

export const uploadGallerySchema = v.object({
  images: v
    .array(
      v.file()
        .image()
        .maxSize({ unit: "MB", size: 10 })
        .mimeType(["image/jpeg", "image/png", "image/webp"]),
    )
    .maxLength(10),
});
```

The controller reads the array and processes in parallel:

```ts
export const uploadGalleryController: RequestHandler = async (
  request: UploadGalleryRequest,
  response,
) => {
  const { images } = request.validated();

  const files = await Promise.all(
    images.map((image) =>
      image.use("s3").save(`gallery/${request.user.id}`),
    ),
  );

  return response.successCreate({
    files: files.map((file) => ({ path: file.path, url: file.url })),
  });
};
```

Multipart accepts repeated field names — `-F "images=@./a.jpg" -F "images=@./b.jpg"` arrives as the same array.

## Gotchas

- **`storage` is the lowercase singleton.** Not `Storage.disk(...)`. Use `storage.use("s3")` for a scoped view, `storage.put(...)` for the default disk.
- **`use("s3")` vs `{ disk: "s3" }`.** `file.use("s3").save(...)` is the chainable form on `UploadedFile`. The `{ disk: "s3" }` option also works on `save()` — they're equivalent.
- **The `.webp` extension swap happens automatically.** When you chain `.format("webp")`, `save("avatars")` writes to `avatars/<random>.webp`, not `.jpg`. The class adjusts the final location.
- **Image transforms only apply to images.** Calling `.resize(...)` on a PDF is a no-op, not an error. The class checks `isImage` before running transforms.
- **File size is in bytes by default.** `v.file().maxSize(5_000_000)` is 5MB. Use `{ unit: "MB", size: 5 }` for the readable form.
- **Public-bucket URLs vs CDN URLs vs presigned URLs are three different things.** Public bucket: bucket policy allows public reads, `file.url` works directly. CDN: `urlPrefix` config rewrites the URL to your CDN domain. Presigned: bucket is private, `temporaryUrl()` produces a signed URL per request.
- **R2 needs `accountId`.** Without it, the driver throws on construction. R2 also accepts `publicDomain` (your custom domain) — set it if you've wired Cloudflare's public access.
- **The local driver is fine for dev.** It writes to `storage/uploads/` (resolved via `storagePath()`). No need to spin up MinIO unless you're testing S3-specific features like presigned URLs.

## See also

- [File uploads guide](../digging-deeper/file-uploads.md) — the full `UploadedFile` surface, image transforms, naming strategies
- [Validation guide](../the-basics/validation.md) — `v.file()` and the file validators
- ``upload-file` skill` — concise reference for upload controllers
- ``store-file` skill` — using `storage` directly without a controller (background jobs, CLI commands)
- [Protected routes](./protected-routes.md) — most upload endpoints are guarded
