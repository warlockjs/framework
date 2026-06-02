import mime from "mime";
//#region ../../@warlock.js/core/src/storage/utils/mime.ts
/**
* MIME type utilities
*
* This module wraps the mime package to avoid type conflicts
* with @types/send which has its own @types/mime dependency.
*/
/**
* Get MIME type from file path or extension
*
* @param path - File path or extension
* @returns MIME type or "application/octet-stream" if unknown
*/
function getMimeType(path) {
	return mime.getType(path) || "application/octet-stream";
}
/**
* Common MIME type constants
*/
const MimeTypes = {
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	pdf: "application/pdf",
	txt: "text/plain",
	html: "text/html",
	css: "text/css",
	js: "application/javascript",
	json: "application/json",
	xml: "application/xml",
	zip: "application/zip",
	gzip: "application/gzip",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	webm: "video/webm",
	ogg: "audio/ogg",
	binary: "application/octet-stream"
};
//#endregion
export { MimeTypes, getMimeType };

//# sourceMappingURL=mime.mjs.map