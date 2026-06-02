---
name: build-url
description: 'HTTP URL helpers — `url`, `publicUrl`, `assetsUrl`, `uploadsUrl`, anchored at `app.baseUrl`. Use to render `src` / `href` / API URLs in resources and responses. `setBaseUrl` is wired by the HTTP connector from `config.get("app.baseUrl")`. Triggers: `url`, `publicUrl`, `assetsUrl`, `uploadsUrl`, `setBaseUrl`, `BASE_URL`; "render an avatar src URL", "absolute download link", "embed asset URL in email", "URL helpers vs path helpers"; typical import `import { url, publicUrl, uploadsUrl } from "@warlock.js/core"`. Skip: filesystem paths — `@warlock.js/core/resolve-path/SKILL.md`; signed CDN URLs — `@warlock.js/core/store-file/SKILL.md`; resource output — `@warlock.js/core/define-resource/SKILL.md`; competing patterns: hand-rolled `${baseUrl}/...` template strings.'
---

# Warlock — build a URL

Path helpers ([`resolve-path/SKILL.md`](../resolve-path/SKILL.md)) give you absolute filesystem paths. URL helpers give you absolute HTTP URLs. Different jobs, often confused.

Use URL helpers whenever you need to render a string that goes into a browser, an HTTP client, or an email — `<img src=...>`, `<a href=...>`, an API response that includes a download link, a webhook payload.

## The shape

```ts
import { url, publicUrl, assetsUrl, uploadsUrl } from "@warlock.js/core";

url();                       // → "http://localhost:3000"
url("/health");              // → "http://localhost:3000/health"

publicUrl("favicon.ico");    // → "http://localhost:3000/public/favicon.ico"
assetsUrl("logo.png");       // → "http://localhost:3000/public/assets/logo.png"
uploadsUrl("avatars/42.png"); // → "http://localhost:3000/uploads/avatars/42.png"
```

Every helper resolves against the **base URL** the HTTP connector set at boot.

## Setting the base URL

`setBaseUrl(url)` is wired automatically — the HTTP connector reads `app.baseUrl` from config and sets it during boot:

```ts title="src/config/app.ts"
import type { AppConfigurations } from "@warlock.js/core";
import { env } from "@warlock.js/core";

const appConfigurations: AppConfigurations = {
  appName: env("APP_NAME", "Mongez"),
  baseUrl: env("BASE_URL", "http://localhost:3000"),
  // ...
};

export default appConfigurations;
```

The env var `BASE_URL` controls the deployed base. In production, set it to `https://api.example.com` (or whatever the deployed host is). In dev, `http://localhost:3000` is the default.

You can also call `setBaseUrl` manually if you need to override at runtime — but in normal app code, the HTTP connector handles this; you don't touch it.

```ts
import { setBaseUrl } from "@warlock.js/core";

setBaseUrl("https://cdn.example.com");
// → every subsequent url() / publicUrl() / assetsUrl() / uploadsUrl() uses this
```

## Full inventory

| Helper                | Resolves to                              | Use for                                     |
| --------------------- | ---------------------------------------- | ------------------------------------------- |
| `url(path?)`          | `<baseUrl>/<path>`                       | Arbitrary absolute URL on the same host.    |
| `publicUrl(path?)`    | `<baseUrl>/public/<path>`                | Files served out of the `public/` folder.   |
| `assetsUrl(path?)`    | `<baseUrl>/public/assets/<path>`         | Assets inside `public/assets/`.             |
| `uploadsUrl(path?)`   | `<baseUrl>/uploads/<path>`               | User-uploaded files served over HTTP.       |
| `setBaseUrl(url)`     | (sets the anchor for all of the above)   | Override at runtime — rarely needed.        |

`assetsUrl` is just `publicUrl` with `assets/` prepended — they share the same `/public/` mount point.

`url(path)` is the escape hatch — it composes the base URL with any path you give it, no convention enforced. Use it for one-off URLs that don't fit `public` / `uploads`.

## URL helpers vs. path helpers

The most common confusion. They look related but resolve completely differently:

| Goal                                          | Helper            | Returns                                     |
| --------------------------------------------- | ----------------- | ------------------------------------------- |
| **Read** a file from the filesystem           | `uploadsPath(...)` | `<cwd>/storage/uploads/<path>` (filesystem) |
| **Render** an `<img src>` for the same file   | `uploadsUrl(...)`  | `<baseUrl>/uploads/<path>` (HTTP URL)       |
| **Write** to public folder                    | `publicPath(...)`  | `<cwd>/public/<path>` (filesystem)          |
| **Embed** an asset URL in a response          | `publicUrl(...)`   | `<baseUrl>/public/<path>` (HTTP URL)        |

Pick by the consumer:

- **Filesystem read/write code** (services that read templates, scripts that copy files) → path helpers.
- **API responses, HTML, emails** (anything the browser or an HTTP client sees) → URL helpers.

## Patterns

### Render an avatar URL in a resource

```ts title="src/app/users/resources/user.resource.ts"
import { defineResource, uploadsUrl } from "@warlock.js/core";

export const UserResource = defineResource({
  schema: {
    id: "string",
    email: "string",
    // `uploadsUrl` cast joins the stored path with the base URL automatically
    avatarUrl: ["avatar_path", "uploadsUrl"],
  },
});
```

The stored value (`avatars/42.png`) is the filesystem-relative key — relative to `storage/uploads/`. The `uploadsUrl` cast renders the full URL by joining it with the base URL. For conditional logic (e.g. fall back to `null` when there's no avatar), use a resolver function instead:

```ts
export const UserResource = defineResource({
  schema: {
    id: "string",
    email: "string",
    avatarUrl: function (_value, resource) {
      const path = resource.get("avatar_path"); // e.g. "avatars/42.png"

      return path ? uploadsUrl(path) : null;
    },
  },
});
```

### Asset URL in an HTML email

```tsx title="src/app/users/emails/welcome.email.tsx"
import { assetsUrl } from "@warlock.js/core";
import { Body, Container, Html, Img } from "@react-email/components";

export function WelcomeEmail() {
  return (
    <Html>
      <Body>
        <Container>
          <Img src={assetsUrl("logo.png")} alt="Logo" />
          <h1>Welcome!</h1>
        </Container>
      </Body>
    </Html>
  );
}
```

Email clients can't reach `localhost` — make sure `BASE_URL` is the public host before sending production mail. Otherwise the `src` resolves to `http://localhost:3000/...` and recipients see broken images.

### Absolute API URL in a webhook payload

```ts
await sendWebhook({
  url: vendor.callback_url,
  payload: {
    order_id: order.id,
    receipt_url: url(`/orders/${order.id}/receipt`),  // → "https://api.example.com/orders/42/receipt"
  },
});
```

The receiver needs the full URL — they'll never see your `Host` header to deduce the rest.

### Override per-request for a multi-tenant CDN

```ts
// Inside a request handler that needs a tenant-specific URL prefix
const tenantCdn = `https://${tenant.slug}.cdn.example.com`;
const fullUrl = `${tenantCdn}/uploads/${path}`;
```

Don't call `setBaseUrl` per request — it's process-global and races every other request. Build the URL manually with template strings instead.

## Gotchas

- **`setBaseUrl` is process-global.** Calling it inside a request handler changes the URL for **every** in-flight request. The HTTP connector sets it once on boot — leave it alone in app code.
- **No host detection from the request.** These helpers don't read `request.host` / `X-Forwarded-Host`. They use the configured `app.baseUrl` only. If your app sits behind a reverse proxy and you need the actual host the user typed, read it from the request directly.
- **Trailing slashes are stripped from the base, leading slashes from the path.** `url("/foo")` and `url("foo")` both return `<base>/foo`. Don't bother double-checking the slash.
- **`uploadsUrl` doesn't know about `uploads.root` overrides.** Even if your filesystem is mounted at `/mnt/uploads`, the URL stays `<baseUrl>/uploads/<path>` — that's the HTTP route the framework serves uploads from. The two are decoupled by design.
- **`publicUrl` vs `assetsUrl`.** `publicUrl("logo.png")` resolves to `/public/logo.png`; `assetsUrl("logo.png")` to `/public/assets/logo.png`. Convention is: framework assets go in `public/assets/`, ad-hoc files (favicon.ico, robots.txt) at `public/` root.
- **The `baseUrl` config is read once at HTTP-connector boot.** Changing the config after boot doesn't update the cached value — either restart, or call `setBaseUrl` manually (with the global-state caveat above).
- **Email + localhost = broken links.** Always use a public host in `BASE_URL` for environments that send mail. Production should never have `localhost` in there.

## See also

- [`resolve-path/SKILL.md`](../resolve-path/SKILL.md) — filesystem path helpers (`uploadsPath`, `publicPath`, ...). Use for read/write; use the URL helpers for rendering.
- [`store-file/SKILL.md`](../store-file/SKILL.md) — the `storage.url(path)` driver method, which can produce signed CDN URLs for non-local drivers (S3 etc.). Use that over `uploadsUrl` when you're on a remote driver.
- [`upload-file/SKILL.md`](../upload-file/SKILL.md) — the `UploadedFile` lifecycle; where the path that feeds `uploadsUrl` comes from.
- [`define-resource/SKILL.md`](../define-resource/SKILL.md) — the `url` / `uploadsUrl` / `storageUrl` casts (and resolver functions) are the right place to call URL helpers.
- [`configure-app/SKILL.md`](../configure-app/SKILL.md) — `src/config/app.ts` and the `baseUrl` env wiring.
