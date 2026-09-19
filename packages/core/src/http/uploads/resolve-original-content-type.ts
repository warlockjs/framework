import mime from "mime";

/**
 * Extension-derived MIME types that are never safe to advertise as-is: a
 * browser that trusts one of these will parse and execute the response body
 * (inline `<script>` in an svg, markup and script in html/xhtml/xml), so an
 * upload served under its real type is stored XSS the moment it is fetched
 * from the app's own origin.
 */
const INLINE_EXECUTABLE_MIME_TYPES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
]);

/**
 * Content type for an upload original that is being served as an
 * `attachment` (see `uploaded-file.controller.ts`): the extension-derived
 * type, except the svg/html/xml family, which is downgraded to
 * `application/octet-stream` so a browser never sniffs or renders it.
 */
export function resolveOriginalContentType(filePath: string): string {
  const type = mime.getType(filePath) || "application/octet-stream";

  return INLINE_EXECUTABLE_MIME_TYPES.has(type) ? "application/octet-stream" : type;
}
