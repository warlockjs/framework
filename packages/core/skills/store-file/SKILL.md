---
name: store-file
description: 'Read/write/delete files via the `storage` singleton — disks, drivers (local/S3/R2/DO Spaces), `storage.use(name)`, `StorageFile` handles, presigned URLs. Triggers: `storage.put`, `storage.get`, `storage.use`, `StorageFile`, `storageConfigurations`, `getPresignedUrl`, `getPresignedUploadUrl`; "save an uploaded file", "switch between local and S3", "generate a presigned URL", "read file metadata"; typical import `import { storage } from "@warlock.js/core"`. Skip: multipart parsing + image chain — the `upload-file` topic; image transforms — the `process-image` topic; storage config shape — the `configure-app` topic; competing libs `@aws-sdk/client-s3`, `multer`, `formidable`.'
---

# Warlock — store a file

`storage` is a singleton manager that wraps one or more drivers. Each driver lives behind a name (`"local"`, `"s3"`, `"r2"`, `"spaces"`). Calls go to the active driver by default; `storage.use("name")` returns a scoped view. Every write returns a `StorageFile` — a thin OOP wrapper with rich properties (`name`, `url`, `hash`, `size`) and chainable methods (`copy`, `move`, `delete`).

## The shape

```ts
import { storage } from "@warlock.js/core";

declare const buffer: Buffer; // file contents

const file = await storage.put(buffer, "uploads/photo.jpg");

console.log(file.url); // public URL
console.log(file.name); // "photo.jpg"
console.log(file.hash); // sha256
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
import { createReadStream } from "node:fs";
import { storage, type Request } from "@warlock.js/core";

declare const buffer: Buffer; // file contents
declare const request: Request; // the current request

// From buffer
const file = await storage.put(buffer, "uploads/photo.jpg");

// With explicit metadata
await storage.put(buffer, "uploads/photo.jpg", {
  mimeType: "image/jpeg",
  cacheControl: "max-age=31536000",
});

// From stream (large files)
await storage.putStream(createReadStream("./video.mp4"), "uploads/video.mp4");

// From a URL (downloads then stores)
await storage.putFromUrl("https://example.com/image.jpg", "uploads/image.jpg");

// From base64 data URL
await storage.putFromBase64("data:image/png;base64,iVBORw0KGgo...", "uploads/photo.png");

// From an UploadedFile (multipart upload)
await storage.put(request.file("image")!, "uploads/avatar.jpg"); // validate the upload first
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
await storage.exists("uploads/photo.jpg"); // boolean
const info = await storage.metadata("uploads/photo.jpg"); // { size, mimeType, lastModified, ... }
const bytes = await storage.size("uploads/photo.jpg");
```

### Create-only — `putIfAbsent` (5.20.0)

```ts
if (storage.supportsPutIfAbsent()) {
  const created = await storage.putIfAbsent("content", "locks/job.txt"); // StorageFile | null
}
```

Atomic; `null` = already exists. A string is **content** (unlike `put`). Local: temp file + hard link; S3/R2: `If-None-Match: *`; not on Spaces. Unsupported drivers throw `StorageCapabilityError`. In production a local default disk warns about single-server use — silence with `storage.silenceSingleServerWarning`.

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
storage.url("uploads/photo.jpg"); // public URL (sync)
await storage.temporaryUrl("private/doc.pdf", 3600); // signed URL, expires in seconds
```

## Private-address check without the framework — `@warlock.js/core/net`

`putFromUrl` refuses private, loopback, link-local and cloud-metadata hosts. Its classifier is also a side-effect-free subpath that loads only `node:net`, so workers, CLIs and standalone agent processes can reuse the rules without booting Core:

```ts
import { isPrivateOrReservedIp } from "@warlock.js/core/net";

const address = "10.0.0.1";

if (isPrivateOrReservedIp(address)) {
  throw new Error(`Refusing private address ${address}`);
}
```

Same function as the root `@warlock.js/core` export.

## Switching drivers — `storage.use(name)`

For a single call against a non-default driver, scope it:

```ts
const r2File = await storage.use("r2").put(buffer, "exports/data.csv");
const localFile = await storage.use("local").put(buffer, "tmp/preview.jpg");

// Both return StorageFile with identical API
console.log(r2File.url);
console.log(localFile.url);
```

`storage.use(name)` returns a `ScopedStorage` with the same surface as `storage`, directory operations included (`storage.use("private").deleteDirectory(dir)` type-checks; no cast). To change the default permanently, call `storage.setDefault(name)` — but you almost always want per-call scoping for clarity.

## Cached image variants follow their source

On a local disk, `delete`, `deleteMany`, `move` and `deleteDirectory` (for every file under it) also remove the file's cached image derivatives (the `?variant=` renders of `uploadedFileController`). For a file removed some other way, call `purgeImageVariants(path, { disk? })`; with no path it clears that disk's derivative cache — or, when `uploads.images.cacheDirectory` is set (shared by every local disk), every disk's derivatives. Serve another local disk's files and variants with `createUploadedFileController({ disk: "private" })`, or call `resolveImageVariant({ disk, path, variant, format? })` from your own authenticated route. A configured `uploads.images.cacheDirectory` is shared by every disk: never put it inside `public/` (Warlock warns once if you do).

Give derivatives a dedicated cache folder, even when it sits beneath a storage root. Full and per-file purges delete recognized image, source-manifest and temporary files in the generated shard/source/generation layout; they retain directories, unrelated files and symlinks. Eviction validates the same directory layout; it may remove empty generated generation directories, while user folders and unrelated entries are never touched. Per-file purges and stale-generation pruning also reject symlinked shard/source directories. Pruning removes only recognized files from older generation-shaped folders, retaining current-generation files and unrelated entries. Reserve generated-looking paths for derivatives and reclaim files from older cache layouts manually.

### Bound the cache and render remote disks

Set `uploads.images.maxCacheBytes` (default `512 * 1024 * 1024`) and `maxCacheAge` (seconds, default seven days). Hits older than the age render again. A write schedules a coalesced background check, at most once per minute; hits never walk the cache. The check walks the cache only on the first check after boot, when the byte estimate is over budget, when the oldest retained derivative has expired, or once per `maxCacheAge`. The sweep removes expired derivatives and evicts oldest files to meet the byte budget, retaining the file being returned even when it alone exceeds that budget. It also removes writer temporaries older than an hour (left by a crashed write), and a generation directory left without derivatives loses its `source.json` and then the empty directory once it is older than five minutes, which reclaims old object-storage generations after ETag changes. The byte budget can be exceeded until the next sweep; idle caches are cleaned after the next generated derivative. Use `Number.MAX_SAFE_INTEGER` for a practically unbounded budget. Keep the cache on a local, writable filesystem outside `public/`; it must not equal or contain any configured local storage root, including runtime-registered disks. Generation and purge use the same guard and compare realpaths, including symlinked directories and existing ancestors of paths not yet created. An overlapping setting throws `ImageVariantsConfigError` before cache removal, as does a cache or root that cannot be resolved (`ENOTDIR`, `EACCES`, `ELOOP`; the original error is its `cause`). The guard result is remembered per cache, disk root and configured local roots; a newly registered disk is checked again.

```ts
import { createUploadedFileController, generateImageVariants, router } from "@warlock.js/core";

router.get("/cloud-images/*", createUploadedFileController({ disk: "r2" }));
const descriptor = await generateImageVariants("products/photo.jpg", {
  disk: "r2",
  urlPrefix: "/cloud-images",
});
```

For an object-storage disk, `descriptor.src` is the driver's original URL; variant URLs use `/cloud-images` and its controller accepts variant queries only (an original request there returns 404). Selecting a remote disk explicitly opts that route into cloud serving; the default `uploadedFileController` continues to return 404 when the default disk is cloud. `createUploadedFileController({ remote: true })` opts into the default cloud disk. Protect a remote route before serving private derivatives: an unguarded route exposes every allowed image in that bucket/prefix, including originals otherwise served only through signed URLs. Use signed original URLs separately for private buckets. `resolveImageVariant` also accepts remote disks. Requests read source metadata; an ETag, size and last-modified date select the cached generation without downloading the source on a hit. Without an ETag, bytes are downloaded and hashed. Concurrent loads for the same disk/path/version are shared, bounded by `maxSourceBytes`, and ingest generation downloads once for all variants and formats. The default remote cache is `<app>/storage/.cache/image-variants`. Bucket identity and the effective storage prefix isolate cached sources. After remote deletion or moving, call `purgeImageVariants(path, { disk: "r2" })` yourself; age/size cleanup also reclaims those derivatives.

## `StorageFile` — the OOP handle

Every `put*`/`copy`/`move` returns a `StorageFile`. You can also build one for an existing path:

```ts
const file = storage.file("uploads/photo.jpg");
```

### Sync properties (no I/O)

| Property         | Description                               |
| ---------------- | ----------------------------------------- |
| `file.path`      | full storage path (`"uploads/photo.jpg"`) |
| `file.name`      | basename (`"photo.jpg"`)                  |
| `file.extension` | lowercased ext, no dot (`"jpg"`)          |
| `file.directory` | parent directory                          |
| `file.driver`    | driver name (`"local"` / `"s3"` / …)      |
| `file.url`       | public URL (uses cached value if present) |
| `file.hash`      | sha256, set by `put*` operations          |
| `file.isDeleted` | `true` after `file.delete()`              |

### Async data

```ts
await file.data(); // full StorageFileData with size/mimeType/url/hash
await file.size();
await file.mimeType();
await file.lastModified();
await file.etag(); // cloud only
```

### Operations

```ts
await file.copy("backups/photo.jpg"); // → new StorageFile at the copy
await file.move("archive/photo.jpg"); // → returns this; path is updated in place
await file.delete(); // marks isDeleted
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
import { storage, type RequestHandler } from "@warlock.js/core";

export const temporaryFileController: RequestHandler = async ({ request, response }) => {
  const result = await storage.validateTemporaryToken(String(request.input("token")));

  if (!result.valid) {
    return response.forbidden({ error: result.error });
  }

  if (result.absolutePath) {
    return response.sendFile(result.absolutePath);
  }

  const stream = await result.getStream!();
  stream.pipe(response.raw);
};
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

| Event          | Fires                  |
| -------------- | ---------------------- |
| `beforePut`    | before write           |
| `afterPut`     | after successful write |
| `beforeDelete` | before delete          |
| `afterDelete`  | after delete           |
| `beforeCopy`   | before copy            |
| `afterCopy`    | after copy             |
| `beforeMove`   | before move            |
| `afterMove`    | after move             |

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
import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { storage } from "@warlock.js/core";

export const uploadAvatarController: GuardedRequestHandler = async ({ request, response }) => {
  const upload = request.file("avatar");

  if (!upload) {
    return response.badRequest({ error: "missing file" });
  }

  const file = await storage.put(upload, `avatars/${request.locals.user.id}/${upload.name}`);

  return response.successCreate({ url: file.url, hash: file.hash });
};
```

### Direct browser upload via presigned URL

```ts
const uploadUrl = await storage.use("r2").getPresignedUploadUrl(`uploads/${userId}/${filename}`, {
  expiresIn: 600,
  contentType: mimeType,
});

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

- The `configure-app` topic — `src/config/storage.ts` shape and `env()` patterns.
- The `warlock-conventions` topic — module layout for upload flows (`src/app/uploads/`).
- The `send-response` topic — `response.sendFile(absPath)` for serving local files.
