---
name: store-file
description: 'Read/write/delete files via the `storage` singleton — disks, drivers (local/S3/R2/DO Spaces), `storage.use(name)`, `StorageFile` handles, presigned URLs. Triggers: `storage.put`, `storage.get`, `storage.use`, `StorageFile`, `storageConfigurations`, `getPresignedUrl`, `getPresignedUploadUrl`; "save an uploaded file", "switch between local and S3", "generate a presigned URL", "read file metadata"; typical import `import { storage } from "@warlock.js/core"`. Skip: multipart parsing + image chain — `@warlock.js/core/upload-file/SKILL.md`; image transforms — `@warlock.js/core/process-image/SKILL.md`; storage config shape — `@warlock.js/core/configure-app/SKILL.md`; competing libs `@aws-sdk/client-s3`, `multer`, `formidable`.'
---

# Warlock — store a file

`storage` is a singleton manager that wraps one or more drivers. Each driver lives behind a name (`"local"`, `"s3"`, `"r2"`, `"spaces"`). Calls go to the active driver by default; `storage.use("name")` returns a scoped view. Every write returns a `StorageFile` — a thin OOP wrapper with rich properties (`name`, `url`, `hash`, `size`) and chainable methods (`copy`, `move`, `delete`).

## The shape

```ts
import { storage } from "@warlock.js/core";

const file = await storage.put(buffer, "uploads/photo.jpg");

console.log(file.url);     // public URL
console.log(file.name);    // "photo.jpg"
console.log(file.hash);    // sha256
```

That's the entire surface for the common case. `storage.put(...)` writes to the default driver and returns a `StorageFile`.

## Configuration

`src/config/storage.ts` declares the disks. Each entry under `drivers` uses one of four built-in driver factories:

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
    aws: storageConfigurations.aws({
      accessKeyId: env("AWS_ACCESS_KEY_ID"),
      secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
      region: env("AWS_REGION"),
      bucket: env("AWS_S3_BUCKET"),
      urlPrefix: "/uploads",
    }),
    r2: storageConfigurations.r2({
      bucket: env("R2_BUCKET"),
      endpoint: env("R2_ENDPOINT"),
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      accountId: env("R2_ACCOUNT_ID"),
      region: env("R2_REGION", "auto"),
      publicDomain: env("R2_BASE_URL"),
    }),
    spaces: storageConfigurations.spaces({
      accessKeyId: env("DO_KEY"),
      secretAccessKey: env("DO_SECRET"),
      region: env("DO_REGION"),
      bucket: env("DO_BUCKET"),
      endpoint: env("DO_ENDPOINT"),
    }),
  },
};

export default storageOptions;
```

`default` names the disk used when callers don't specify one. The factories (`storageConfigurations.local|aws|r2|spaces`) just stamp the `driver` field on the options object — pass whatever the driver supports.

## File operations

The `storage` singleton (and any `storage.use(name)` scoped view) exposes the same operations:

### Writing

```ts
// From buffer
const file = await storage.put(buffer, "uploads/photo.jpg");

// With explicit metadata
await storage.put(buffer, "uploads/photo.jpg", {
  mimeType: "image/jpeg",
  cacheControl: "max-age=31536000",
});

// From stream (large files)
import { createReadStream } from "node:fs";
await storage.putStream(createReadStream("./video.mp4"), "uploads/video.mp4");

// From a URL (downloads then stores)
await storage.putFromUrl("https://example.com/image.jpg", "uploads/image.jpg");

// From base64 data URL
await storage.putFromBase64(
  "data:image/png;base64,iVBORw0KGgo...",
  "uploads/photo.png",
);

// From an UploadedFile (multipart upload)
await storage.put(request.file("image"), "uploads/avatar.jpg");
```

Every `put*` returns a `StorageFile`.

### Reading

```ts
const buffer = await storage.get("uploads/photo.jpg");
const stream = await storage.getStream("uploads/video.mp4");
const json = await storage.getJson("config/settings.json");
```

`get()` loads the whole file into memory. Use `getStream()` for anything > a few MB.

### Existence + metadata

```ts
await storage.exists("uploads/photo.jpg");                  // boolean
const info = await storage.metadata("uploads/photo.jpg");   // { size, mimeType, lastModified, ... }
const bytes = await storage.size("uploads/photo.jpg");
```

### Delete / copy / move

```ts
await storage.delete("uploads/photo.jpg");
await storage.deleteMany(["a.txt", "b.txt", "c.txt"]);
await storage.copy("uploads/photo.jpg", "backups/photo.jpg");
await storage.move("uploads/temp.jpg", "uploads/photo.jpg");
```

Directory operations:

```ts
await storage.copyDirectory("uploads/temp", "uploads/final");
await storage.moveDirectory("uploads/temp", "uploads/final");
await storage.emptyDirectory("uploads/temp");
await storage.deleteDirectory("uploads/temp");
```

### Listing

```ts
const files = await storage.list("uploads", { recursive: true, limit: 100 });
// → StorageFileInfo[]
```

### URLs

```ts
storage.url("uploads/photo.jpg");                        // public URL (sync)
await storage.temporaryUrl("private/doc.pdf", 3600);     // signed URL, expires in seconds
```

## Switching drivers — `storage.use(name)`

For a single call against a non-default driver, scope it:

```ts
const r2File = await storage.use("r2").put(buffer, "exports/data.csv");
const localFile = await storage.use("local").put(buffer, "tmp/preview.jpg");

// Both return StorageFile with identical API
console.log(r2File.url);
console.log(localFile.url);
```

`storage.use(name)` returns a `ScopedStorage` with the same surface as `storage`. To change the default permanently, call `storage.setDefault(name)` — but you almost always want per-call scoping for clarity.

## `StorageFile` — the OOP handle

Every `put*`/`copy`/`move` returns a `StorageFile`. You can also build one for an existing path:

```ts
const file = storage.file("uploads/photo.jpg");
```

### Sync properties (no I/O)

| Property         | Description                                    |
| ---------------- | ---------------------------------------------- |
| `file.path`      | full storage path (`"uploads/photo.jpg"`)      |
| `file.name`      | basename (`"photo.jpg"`)                       |
| `file.extension` | lowercased ext, no dot (`"jpg"`)               |
| `file.directory` | parent directory                               |
| `file.driver`    | driver name (`"local"` / `"s3"` / …)           |
| `file.url`       | public URL (uses cached value if present)      |
| `file.hash`      | sha256, set by `put*` operations               |
| `file.isDeleted` | `true` after `file.delete()`                   |

### Async data

```ts
await file.data();        // full StorageFileData with size/mimeType/url/hash
await file.size();
await file.mimeType();
await file.lastModified();
await file.etag();        // cloud only
```

### Operations

```ts
await file.copy("backups/photo.jpg");      // → new StorageFile at the copy
await file.move("archive/photo.jpg");      // → returns this; path is updated in place
await file.delete();                       // marks isDeleted
const buffer = await file.contents();
const stream = await file.stream();
```

`file.copy(dest)` returns a fresh `StorageFile` for the copy. `file.move(dest)` (and `file.rename(name)`) mutate the receiver — they rewrite `this._path`, refresh the cached data, and return the same instance. The handle stays valid at its new location.

## Cloud-only operations

Some methods only work against cloud drivers (`s3`, `r2`, `spaces`). Calling them on `local` throws.

### Presigned URLs (direct upload/download)

```ts
const downloadUrl = await storage.getPresignedUrl("private/doc.pdf", {
  expiresIn: 3600, // seconds
});

const uploadUrl = await storage.getPresignedUploadUrl("uploads/file.pdf", {
  expiresIn: 3600,
  contentType: "application/pdf",
});

// Client can PUT directly to uploadUrl, bypassing your server
```

For these you usually scope to a specific cloud disk:

```ts
const url = await storage.use("r2").getPresignedUrl(path, { expiresIn: 600 });
```

### Visibility + storage class

```ts
await storage.setVisibility("uploads/photo.jpg", "public");
await storage.setVisibility("private/doc.pdf", "private");
const v = await storage.getVisibility("uploads/photo.jpg");

await storage.setStorageClass("archive/old.zip", "GLACIER");
```

### Cloud driver helper

For cloud-only chains, get the typed cloud interface:

```ts
const cloud = storage.useCloud("s3");
await cloud.getPresignedUrl("private/doc.pdf");
await cloud.getBucket();
await cloud.getRegion();
```

## Temporary URLs on the local driver

Local storage signs URLs with an HMAC token (no presigned URL — there is no S3 here). Validate inbound tokens before serving:

```ts
import { storage } from "@warlock.js/core";

const result = await storage.validateTemporaryToken(token);

if (!result.valid) {
  return response.forbidden({ error: result.error });
}

if (result.absolutePath) {
  return response.sendFile(result.absolutePath);
}

const stream = await result.getStream!();
stream.pipe(response.raw);
```

Cloud drivers always return `{ valid: false }` from `validateTemporaryToken` — they validate via presigned URL on the cloud side.

## Runtime driver registration

For multi-tenancy or runtime config, register a driver after boot:

```ts
storage.register("tenant-s3", {
  driver: "s3",
  bucket: tenant.bucket,
  region: tenant.region,
  accessKeyId: tenant.key,
  secretAccessKey: tenant.secret,
});

await storage.use("tenant-s3").put(buffer, "data.csv");
```

`storage.register(name, config)` clears any cached instance for that name, so the next access rebuilds with the new config.

## Events

`storage.on(event, handler)` subscribes to lifecycle hooks. Event types:

| Event          | Fires                              |
| -------------- | ---------------------------------- |
| `beforePut`    | before write                       |
| `afterPut`     | after successful write             |
| `beforeDelete` | before delete                      |
| `afterDelete`  | after delete                       |
| `beforeCopy`   | before copy                        |
| `afterCopy`    | after copy                         |
| `beforeMove`   | before move                        |
| `afterMove`    | after move                         |

```ts
storage.on("afterPut", ({ location, file }) => {
  console.log(`uploaded ${file?.size} bytes to ${location}`);
});

storage.on("afterDelete", ({ location }) => {
  analytics.track("file_deleted", { path: location });
});
```

## Common patterns

### Switching disk per env

```ts title="src/config/storage.ts"
const storageOptions: StorageConfigurations = {
  default: env("STORAGE_DRIVER", "local"),
  drivers: {
    local: storageConfigurations.local({ root: storagePath(), urlPrefix: "/uploads" }),
    r2: storageConfigurations.r2({ ... }),
  },
};
```

Set `STORAGE_DRIVER=r2` in production, leave unset in dev — same code uses local files in dev and R2 in prod.

### Uploading a request file

```ts
import type { RequestHandler, Response } from "@warlock.js/core";
import { storage } from "@warlock.js/core";

export const uploadAvatarController: RequestHandler = async (request, response: Response) => {
  const upload = request.file("avatar");
  const file = await storage.put(upload, `avatars/${request.user.id}/${upload.fileName}`);

  return response.successCreate({ url: file.url, hash: file.hash });
};
```

### Direct browser upload via presigned URL

```ts
const uploadUrl = await storage.use("r2").getPresignedUploadUrl(
  `uploads/${userId}/${filename}`,
  { expiresIn: 600, contentType: mimeType },
);

return response.success({ uploadUrl });
```

Client `PUT`s the bytes straight to R2 — your server never sees them.

## Gotchas

- **`storage` is the lowercase singleton.** Don't `new Storage()` — there's no point, and configuration won't reach it.
- **`storage.path(location)` only works on the local driver.** Calls on cloud drivers throw. Check the driver if you don't control it.
- **`StorageFile.move()` mutates the receiver and returns it.** After `await file.move(dest)`, `file.path` now points at `dest` — the same instance stays live (unlike the manager's `storage.move(from, to)`, which returns a fresh `StorageFile`). `file.copy(dest)`, by contrast, leaves the receiver untouched and returns a new handle.
- **Local URLs are relative (`/uploads/...`).** Prefix with `baseUrl` from `config.get("app").baseUrl` if you need absolute. Cloud drivers return absolute URLs.
- **Presigned uploads enforce content-type at the cloud side.** Mismatched `contentType` between the presigned URL and the actual upload returns 403 from the cloud — match exactly.
- **Driver name keys are case-sensitive** — `"r2"`, not `"R2"`. Match what's in `src/config/storage.ts`.

## See also

- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `src/config/storage.ts` shape and `env()` patterns.
- [`warlock-conventions/SKILL.md`](../warlock-conventions/SKILL.md) — module layout for upload flows (`src/app/uploads/`).
- [`send-response/SKILL.md`](../send-response/SKILL.md) — `response.sendFile(absPath)` for serving local files.
