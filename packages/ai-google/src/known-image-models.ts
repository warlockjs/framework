/**
 * Model-id prefixes Google exposes through the **Imagen** image API
 * (`ai.models.generateImages`) — `imagen-3.0-*`, `imagen-4.0-*`, and
 * their fast/ultra variants. All are per-image-metered and return
 * base64 bytes.
 *
 * Gemini's *native* image output (`gemini-2.5-flash-image`) is a
 * different surface (`generateContent` with `responseModalities`) and
 * is intentionally NOT routed here — `google.image()` targets the
 * dedicated Imagen endpoint only.
 *
 * Used by {@link isGoogleImageModel} for the construction-time guard so
 * `google.image({ name: "gemini-2.5-flash" })` fails fast with a
 * curated error rather than a downstream 400.
 */
export const GOOGLE_IMAGE_MODEL_PREFIXES = ["imagen-"] as const;

/**
 * True when `name` is a recognized Google Imagen model. A prefix match
 * so dated/variant ids (`imagen-4.0-ultra-generate-001`) are covered
 * without an exact-list maintenance burden.
 *
 * @example
 * isGoogleImageModel("imagen-4.0-generate-001"); // true
 * isGoogleImageModel("gemini-2.5-flash");         // false
 */
export function isGoogleImageModel(name: string): boolean {
  return GOOGLE_IMAGE_MODEL_PREFIXES.some((prefix) => name.startsWith(prefix));
}
