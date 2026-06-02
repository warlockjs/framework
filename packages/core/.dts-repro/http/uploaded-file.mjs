import { sanitizePath } from "../utils/paths.mjs";
import { storage } from "../storage/storage.mjs";
import "../storage/index.mjs";
import { Image } from "../image/image.mjs";
import "../image/index.mjs";
import { uploadsConfig } from "./uploads-config.mjs";
import path from "path";
import { Random } from "@mongez/reinforcements";
import dayjs from "dayjs";
//#region ../../@warlock.js/core/src/http/uploaded-file.ts
/**
* UploadedFile - Handles multipart file uploads with storage and image integration
*
* Provides a fluent API for validating, transforming, and saving uploaded files
* to various storage drivers (local, S3, R2, etc.).
*
* @example
* ```typescript
* // Simple save with random name
* const file = await uploadedFile.save("avatars");
*
* // Original name with date prefix
* const file = await uploadedFile.save("avatars", {
*   name: "original",
*   prefix: { format: "yyyy/mm/dd", as: "directory" }
* });
*
* // With image transformations
* const file = await uploadedFile
*   .resize(800, 600)
*   .quality(85)
*   .format("webp")
*   .save("avatars");
*
* // Different storage driver
* const file = await uploadedFile.use("s3").save("avatars");
* ```
*/
var UploadedFile = class {
	/**
	* Create a new UploadedFile instance
	*
	* @param fileData - Multipart file data from Fastify
	* @throws Error if file data is invalid
	*/
	constructor(fileData) {
		this.fileData = fileData;
		this.hash = "";
		this._storage = storage;
		this._imageOptions = {};
		if (!fileData?.filename) throw new Error("Invalid file data: filename is required");
	}
	/**
	* Get file name (sanitized)
	*
	* Returns the original filename with special characters removed/replaced.
	*/
	get name() {
		return sanitizePath(this.fileData.filename);
	}
	/**
	* Get file MIME type
	*
	* @example "image/jpeg", "application/pdf"
	*/
	get mimeType() {
		return this.fileData.mimetype;
	}
	/**
	* Get file extension (lowercase, without dot)
	*
	* @example "jpg", "png", "pdf"
	*/
	get extension() {
		return path.extname(this.fileData.filename).replace(".", "").toLowerCase();
	}
	/**
	* Get file metadata
	*/
	async metadata() {
		const data = {
			name: this.name,
			mimeType: this.mimeType,
			extension: this.extension,
			size: await this.size()
		};
		if (this.isImage) {
			const dimensions = await this.dimensions();
			data.width = dimensions.width;
			data.height = dimensions.height;
		}
		return data;
	}
	/**
	* Get file size in bytes
	*
	* Buffers the file content if not already buffered.
	*/
	async size() {
		return (await this.buffer()).length;
	}
	/**
	* Get file buffer
	*
	* Caches the buffer after first call for efficiency.
	*/
	async buffer() {
		if (this.bufferedFileContent) return this.bufferedFileContent;
		this.bufferedFileContent = await this.fileData.toBuffer();
		return this.bufferedFileContent;
	}
	/**
	* Check if file is an image based on MIME type
	*/
	get isImage() {
		return this.mimeType.startsWith("image");
	}
	/**
	* Check if file is a video based on MIME type
	*/
	get isVideo() {
		return this.mimeType.startsWith("video");
	}
	/**
	* Check if file is an audio based on MIME type
	*/
	get isAudio() {
		return this.mimeType.startsWith("audio");
	}
	/**
	* Select a specific storage driver for this upload
	*
	* Returns this instance for chaining. The driver is used
	* when `save()` or `saveAs()` is called.
	*
	* @param driver - Driver name from storage configuration
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* await file.use("s3").save("avatars");
	* await file.use("r2").save("cdn/images");
	* ```
	*/
	use(driver) {
		this._storage = storage.use(driver);
		return this;
	}
	/**
	* Resize the image before saving
	*
	* Only applies to image files. Non-image files ignore this.
	*
	* @param width - Target width in pixels
	* @param height - Optional target height (maintains aspect ratio if omitted)
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* await file.resize(800).save("thumbnails");
	* await file.resize(400, 400).save("avatars");
	* ```
	*/
	resize(width, height) {
		this._imageOptions.resize = {
			width,
			height
		};
		return this;
	}
	/**
	* Set image output quality
	*
	* Quality affects file size and visual fidelity.
	* Only applies to formats that support quality (JPEG, WebP, AVIF).
	*
	* @param value - Quality value (1-100)
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* await file.quality(85).save("images");
	* ```
	*/
	quality(value) {
		if (value < 1 || value > 100) throw new Error("Quality must be between 1 and 100");
		this._imageOptions.quality = value;
		return this;
	}
	/**
	* Convert image to a specific format
	*
	* Changes the output format and updates the file extension accordingly.
	*
	* @param format - Target image format (jpeg, png, webp, avif, etc.)
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* await file.format("webp").save("images");
	* await file.resize(800).format("avif").quality(80).save("optimized");
	* ```
	*/
	format(format) {
		this._imageOptions.format = format;
		return this;
	}
	/**
	* Rotate the image
	*
	* @param degrees - Rotation angle in degrees (positive = clockwise)
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* await file.rotate(90).save("rotated");
	* ```
	*/
	rotate(degrees) {
		this._imageOptions.rotate = degrees;
		return this;
	}
	/**
	* Apply blur effect to the image
	*
	* @param sigma - Blur intensity (default: 3, minimum: 0.3)
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* await file.blur(5).save("blurred");
	* ```
	*/
	blur(sigma = 3) {
		if (sigma < .3) throw new Error("Blur sigma must be at least 0.3");
		this._imageOptions.blur = sigma;
		return this;
	}
	/**
	* Convert image to grayscale (black and white)
	*
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* await file.grayscale().save("bw-images");
	* ```
	*/
	grayscale() {
		this._imageOptions.grayscale = true;
		return this;
	}
	/**
	* Apply full image transformations
	*
	* Provides complete control over image processing. Can be used with:
	* - An options object for predefined transforms
	* - A callback function for chained operations
	*
	* @param config - Transform options or callback function
	* @returns This instance for chaining
	*
	* @example
	* ```typescript
	* // Using options object
	* await file.transform({
	*   resize: { width: 800, fit: "inside" },
	*   quality: 85
	* }).save("images");
	*
	* // Using callback for full control
	* await file.transform(img =>
	*   img.resize({ width: 800 })
	*      .watermark("logo.png", { gravity: "southeast" })
	*      .sharpen()
	* ).save("products");
	* ```
	*/
	transform(config) {
		this._transformConfig = config;
		return this;
	}
	/**
	* Get an Image instance for advanced manipulation
	*
	* Returns an Image instance from the file buffer for manual processing.
	* Use this when you need operations not covered by the fluent API.
	*
	* @returns Promise resolving to Image instance
	*
	* @example
	* ```typescript
	* const img = await file.toImage();
	* await img
	*   .resize({ width: 800 })
	*   .watermark("logo.png", { gravity: "southeast" })
	*   .save("path/to/output.jpg");
	* ```
	*/
	async toImage() {
		return new Image(await this.buffer());
	}
	/**
	* Get file width and height (only for images)
	*
	* @returns Dimensions object, or empty object if not an image
	*/
	async dimensions() {
		if (!this.isImage) return {};
		return new Image(await this.buffer()).dimensions();
	}
	/**
	* Validate file against the given options
	*
	* @param options - Validation rules
	* @throws Error if validation fails
	*
	* @example
	* ```typescript
	* await file.validate({
	*   allowedMimeTypes: ["image/jpeg", "image/png"],
	*   maxSize: 5 * 1024 * 1024 // 5MB
	* });
	* ```
	*/
	async validate(options) {
		const { allowedMimeTypes, allowedExtensions, maxSize } = options;
		if (allowedMimeTypes && !allowedMimeTypes.includes(this.mimeType)) throw new Error(`Invalid file type: ${this.mimeType}. Allowed types: ${allowedMimeTypes.join(", ")}`);
		if (allowedExtensions && !allowedExtensions.includes(this.extension)) throw new Error(`Invalid file extension: ${this.extension}. Allowed extensions: ${allowedExtensions.join(", ")}`);
		if (maxSize) {
			const fileSize = await this.size();
			if (fileSize > maxSize) throw new Error(`File too large: ${fileSize} bytes. Maximum allowed: ${maxSize} bytes`);
		}
	}
	/**
	* Save the file to a directory with automatic naming
	* Keep in mind to use only relative path to the root of storage
	* If you are using local driver
	* Uses the configured naming strategy and prefix options to generate
	* the final path. Returns a StorageFile for accessing file metadata.
	*
	* @param directory - Target directory path
	* @param options - Save options (name, prefix, driver, validate)
	* @returns StorageFile instance with file metadata and operations
	*
	* @example
	* ```typescript
	* // Random name (default)
	* await file.save("avatars");
	* // → avatars/x7k9m2p4.jpg
	*
	* // Original name
	* await file.save("avatars", { name: "original" });
	* // → avatars/photo.jpg
	*
	* // With date directory
	* await file.save("avatars", {
	*   prefix: { format: "yyyy/mm/dd", as: "directory" }
	* });
	* // → avatars/2025/12/21/x7k9m2p4.jpg
	*
	* // Original name with datetime prefix
	* await file.save("avatars", { name: "original", prefix: true });
	* // → avatars/21-12-2025-16-45-30-photo.jpg
	* ```
	*/
	async save(directory, options) {
		if (options?.validate) await this.validate(options.validate);
		const filename = this.resolveFilename(options);
		const prefix = this.resolvePrefix(options?.prefix);
		const location = this.buildLocation(directory, prefix, filename);
		return this.saveToLocation(location, options?.driver);
	}
	/**
	* Save the file to an explicit path
	*
	* Unlike `save()`, this method uses the exact path you provide.
	* No automatic naming or prefix is applied.
	*
	* @param location - Full file path (directory + filename)
	* @param options - Save options (driver, validate)
	* @returns StorageFile instance with file metadata
	*
	* @example
	* ```typescript
	* await file.saveAs("avatars/profile-123.png");
	* await file.saveAs("products/2025/featured-image.webp");
	* ```
	*/
	async saveAs(location, options) {
		if (options?.validate) await this.validate(options.validate);
		return this.saveToLocation(location, options?.driver);
	}
	/**
	* Get the StorageFile reference if file has been saved
	*
	* Returns undefined if file hasn't been saved yet.
	*/
	get storageFile() {
		return this._storageFile;
	}
	/**
	* Execute save to the specified location
	* @internal
	*/
	async saveToLocation(location, driver) {
		const content = await this.getProcessedContent();
		const storageInstance = this.resolveStorage(driver);
		const finalLocation = this.adjustLocationForFormat(location);
		this._storageFile = await storageInstance.put(content, finalLocation, { mimeType: this.getFinalMimeType() });
		const info = await this._storageFile.data();
		this.hash = info.hash || "";
		return this._storageFile;
	}
	/**
	* Get processed content (with transforms applied if applicable)
	* @internal
	*/
	async getProcessedContent() {
		const content = await this.buffer();
		if (!this.isImage || !this.hasTransforms()) return content;
		let img = new Image(content);
		if (typeof this._transformConfig === "function") img = this._transformConfig(img);
		else if (this._transformConfig) img = img.apply(this._transformConfig);
		img = this.applyImageOptions(img);
		return img.toBuffer();
	}
	/**
	* Apply high-level image options
	* @internal
	*/
	applyImageOptions(img) {
		const opts = this._imageOptions;
		if (opts.resize) img = img.resize({
			width: opts.resize.width,
			height: opts.resize.height
		});
		if (opts.rotate !== void 0) img = img.rotate(opts.rotate);
		if (opts.blur !== void 0) img = img.blur(opts.blur);
		if (opts.grayscale) img = img.grayscale();
		if (opts.quality !== void 0) img = img.quality(opts.quality);
		if (opts.format) img = img.format(opts.format);
		return img;
	}
	/**
	* Check if any transforms are queued
	* @internal
	*/
	hasTransforms() {
		return this._transformConfig !== void 0 || Object.keys(this._imageOptions).length > 0;
	}
	/**
	* Resolve storage instance to use
	* @internal
	*/
	resolveStorage(driver) {
		if (driver) return storage.use(driver);
		return this._storage || storage;
	}
	/**
	* Resolve the filename based on options and config
	* @internal
	*/
	resolveFilename(options) {
		const namingStrategy = options?.name ?? uploadsConfig("name") ?? "random";
		let baseName;
		if (namingStrategy === "original") baseName = path.basename(this.name, path.extname(this.name));
		else if (namingStrategy === "random") {
			const length = uploadsConfig("randomLength");
			baseName = Random.string(length);
		} else baseName = path.basename(namingStrategy, path.extname(namingStrategy));
		const ext = this.getFinalExtension();
		return `${baseName}.${ext}`;
	}
	/**
	* Resolve prefix based on options and config
	* @internal
	*/
	resolvePrefix(prefix) {
		if (prefix === false || prefix === void 0) {
			const configPrefix = uploadsConfig("prefix");
			if (!configPrefix) return "";
			prefix = configPrefix;
		}
		if (prefix === true) {
			const format = uploadsConfig("defaultPrefixFormat");
			return this.formatDatePrefix(format, "file");
		}
		if (typeof prefix === "string") return prefix;
		const parts = [];
		if (prefix.format) parts.push(this.formatDate(prefix.format));
		if (prefix.randomLength) parts.push(Random.string(prefix.randomLength));
		const combined = parts.join("-");
		if ((prefix.as ?? "file") === "directory") return combined ? `${combined}/` : "";
		return combined ? `${combined}-` : "";
	}
	/**
	* Format a date prefix with the given format
	* @internal
	*/
	formatDatePrefix(format, as) {
		const formatted = this.formatDate(format);
		return as === "directory" ? `${formatted}/` : `${formatted}-`;
	}
	/**
	* Format current date using token-based format string
	* @internal
	*/
	formatDate(format) {
		return dayjs().format(format);
	}
	/**
	* Build final location from directory, prefix, and filename
	* @internal
	*/
	buildLocation(directory, prefix, filename) {
		const dir = directory.replace(/\/$/, "");
		if (prefix.endsWith("/")) return `${dir}/${prefix}${filename}`;
		return `${dir}/${prefix}${filename}`;
	}
	/**
	* Get final extension (accounting for format changes)
	* @internal
	*/
	getFinalExtension() {
		if (this._imageOptions.format) {
			const format = this._imageOptions.format;
			if (format === "jpeg") return "jpg";
			return format;
		}
		return this.extension;
	}
	/**
	* Get final MIME type (accounting for format changes)
	* @internal
	*/
	getFinalMimeType() {
		if (this._imageOptions.format) {
			const format = this._imageOptions.format;
			if (format === "jpeg" || format === "jpg") return "image/jpeg";
			return `image/${format}`;
		}
		return this.mimeType;
	}
	/**
	* Adjust location to use correct extension if format changed
	* @internal
	*/
	adjustLocationForFormat(location) {
		if (!this._imageOptions.format) return location;
		const ext = this.getFinalExtension();
		const currentExt = path.extname(location);
		if (currentExt) return location.replace(currentExt, `.${ext}`);
		return `${location}.${ext}`;
	}
	/**
	* Convert to JSON representation
	*
	* Includes file metadata and base64 content for serialization.
	*/
	async toJSON() {
		return {
			name: this.name,
			mimeType: this.mimeType,
			extension: this.extension,
			size: await this.size(),
			isImage: this.isImage,
			isVideo: this.isVideo,
			isAudio: this.isAudio,
			dimensions: this.isImage ? await this.dimensions() : void 0,
			base64: (await this.buffer()).toString("base64")
		};
	}
};
//#endregion
export { UploadedFile };

//# sourceMappingURL=uploaded-file.mjs.map