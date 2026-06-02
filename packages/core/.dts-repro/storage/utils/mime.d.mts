//#region ../../@warlock.js/core/src/storage/utils/mime.d.ts
/**
 * Get MIME type from file path or extension
 *
 * @param path - File path or extension
 * @returns MIME type or "application/octet-stream" if unknown
 */
declare function getMimeType(path: string): string;
/**
 * Common MIME type constants
 */
declare const MimeTypes: {
  readonly jpeg: "image/jpeg";
  readonly png: "image/png";
  readonly gif: "image/gif";
  readonly webp: "image/webp";
  readonly svg: "image/svg+xml";
  readonly ico: "image/x-icon";
  readonly pdf: "application/pdf";
  readonly txt: "text/plain";
  readonly html: "text/html";
  readonly css: "text/css";
  readonly js: "application/javascript";
  readonly json: "application/json";
  readonly xml: "application/xml";
  readonly zip: "application/zip";
  readonly gzip: "application/gzip";
  readonly mp3: "audio/mpeg";
  readonly mp4: "video/mp4";
  readonly webm: "video/webm";
  readonly ogg: "audio/ogg";
  readonly binary: "application/octet-stream";
};
//#endregion
export { MimeTypes, getMimeType };
//# sourceMappingURL=mime.d.mts.map