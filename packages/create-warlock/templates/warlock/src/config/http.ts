import type { HttpConfigurations } from "@warlock.js/core";
import { env } from "@warlock.js/core";
import { formatHttpErrorResponse } from "../app/shared/utils/format-http-error-response";

const httpConfigurations: HttpConfigurations = {
  port: env("HTTP_PORT", 3000),
  host: env("HTTP_HOST", "localhost"),
  log: true,
  // errorMapper classifies thrown non-HttpErrors; it cannot shape returned
  // validation, not-found, or rate-limit responses. Format all JSON errors at
  // the transport boundary, including Fastify's early rejections.
  errorMapper: () => ({ status: 500 }),
  errorResponse: formatHttpErrorResponse,
  // Compress JSON and HTML responses with br/gzip for clients that accept it.
  // Set `false` when a proxy or CDN in front of the app already compresses.
  compression: true,
  // Largest single uploaded file, in bytes. Each file part is held in memory
  // while the request is read, before route middleware runs, so keep this
  // close to the biggest file the app really accepts. To allow larger files,
  // raise it here (e.g. `50 * 1024 * 1024` for 50 MB) and add a size rule on
  // the route's validation schema.
  fileUploadLimit: 10 * 1024 * 1024, // 10 MB
  multipart: {
    // Which routes read multipart (file upload) bodies. "declared" reads them
    // only on routes marked `uploads: true` (in the starter: POST /users,
    // POST /posts and PUT /posts/:id); every other route answers 415. The
    // default stays "all" until 6.0, which reads them on every route before
    // route middleware (auth included) runs. Keep "all" if a web page action
    // accepts files.
    routes: "declared",
  },
  rateLimit: {
    max: 260,
    duration: 60 * 1000, // 1 minute
  },
  cors: {
    // Browser origins allowed to call this API from another site, comma-separated
    // in CORS_ORIGINS (e.g. "https://app.example.com,http://localhost:5173").
    // Empty (the default) allows same-origin requests only. `origin: "*"` lets
    // every website read every response; use it only for a fully public API.
    origin: String(env("CORS_ORIGINS", ""))
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    // allowed methods
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  },
  // Safe for local dev: `false` trusts nothing in front of this process, so
  // request.ip/protocol/hostname read the raw socket. Behind a proxy/LB/CDN
  // in production, set this to the proxy's own IP/CIDR or a list of them, for
  // example `["10.0.0.0/8", "203.0.113.7"]`. Avoid `true`: it trusts whatever
  // forwarded address a client sends when the edge appends to the header
  // instead of replacing it. If the edge sets a header you can rely on (for
  // example Cloudflare's), name it in `realIpHeader`. A wrong value makes rate
  // limiting, ip-filter allowlists, and absolute URLs (e.g. the sitemap) trust
  // the wrong client.
  trustProxy: false,
  // Opt-in, nonce-based Content-Security-Policy — off by default, zero
  // behaviour change. Flip `enabled: true` to turn it on; the framework
  // appends the request's own `'nonce-<value>'` to `script-src` for you.
  // csp: {
  //   enabled: false,
  //   directives: {
  //     "script-src": ["'self'"],
  //     "object-src": ["'none'"],
  //     "base-uri": ["'self'"],
  //   },
  // },
};

export default httpConfigurations;
