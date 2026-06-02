import { http } from "@mongez/http";
//#region ../../@warlock.js/core/src/image/image.ts
/**
* Installation instructions for sharp
*/
const SHARP_INSTALL_INSTRUCTIONS = `
Image processing requires the sharp package.
Install it with:

  warlock add image

Or manually:

  npm install sharp
  pnpm add sharp
  yarn add sharp
`.trim();
/**
* Module availability flag
*/
let moduleExists = null;
/**
* Cached sharp function (loaded at import time)
*/
let sharpFn;
/**
* Eagerly load sharp module at import time
*/
async function loadSharpModule() {
	try {
		sharpFn = (await import("sharp")).default;
		moduleExists = true;
	} catch {
		moduleExists = false;
	}
}
loadSharpModule();
/**
* Image manipulation class with deferred pipeline execution.
*
* **Important:** This class requires the `sharp` package to be installed.
* Install it with: `warlock add image` or `npm install sharp`
*
* Sharp is lazy-loaded on the first async operation (save, toBuffer, etc.),
* so the constructor and all chainable methods remain synchronous.
*
* All operations are synchronous and stored as descriptors.
* The pipeline is executed only when calling output methods:
* - `save()` - Save to file
* - `toBuffer()` - Get as buffer
* - `toBase64()` - Get as base64 string
* - `toDataUrl()` - Get as data URL
*
* @example
* ```typescript
* // All chaining is synchronous - single await at the end
* await new Image("photo.jpg")
*   .resize({ width: 800 })
*   .watermark("logo.png", { gravity: "southeast" })
*   .quality(85)
*   .save("output.jpg");
* ```
*/
var Image = class Image {
	static {
		this.QUALITY_FORMATS = [
			"jpeg",
			"jpg",
			"webp",
			"avif",
			"tiff",
			"heif"
		];
	}
	/**
	* Constructor
	*/
	constructor(image) {
		this.options = {};
		this.operations = [];
		this.cachedMetadata = null;
		this.pipelineExecuted = false;
		if (moduleExists === false) throw new Error(`sharp is not installed.\n\n${SHARP_INSTALL_INSTRUCTIONS}`);
		if (image instanceof Object && "clone" in image && typeof image.clone === "function") this.image = image;
		else this.image = sharpFn(image);
	}
	/**
	* Create image instance from file path
	*/
	static fromFile(path) {
		return new Image(path);
	}
	/**
	* Create image instance from buffer
	*/
	static fromBuffer(buffer) {
		return new Image(buffer);
	}
	/**
	* Create image instance from url
	*/
	static async fromUrl(url) {
		const { data, error } = await http.get(url, { responseType: "arrayBuffer" });
		if (error || !data) throw new Error(`Failed to load image from URL "${url}": ${error?.message ?? "Empty response received"}`);
		return new Image(Buffer.from(data));
	}
	/**
	* Add an operation to the deferred pipeline
	*/
	addOperation(operation) {
		this.operations.push(operation);
		return this;
	}
	/**
	* Apply multiple transformations at once with a predefined execution order.
	*
	* This method ensures transformations are applied in a logical order:
	* resize → crop → rotate → flip/flop → colorspace → effects → opacity → format
	*
	* For custom ordering, use individual chained methods instead.
	*/
	apply(options) {
		if (options.resize) this.resize(options.resize);
		if (options.crop) this.crop(options.crop);
		if (options.rotate !== void 0) this.rotate(options.rotate);
		if (options.flip) this.flip();
		if (options.flop) this.flop();
		if (options.blackAndWhite || options.grayscale) this.blackAndWhite();
		if (options.blur !== void 0) this.blur(options.blur);
		if (options.sharpen) {
			const sharpenOptions = typeof options.sharpen === "boolean" ? void 0 : options.sharpen;
			this.sharpen(sharpenOptions);
		}
		if (options.tint) this.tint(options.tint);
		if (options.negate) {
			const negateOptions = typeof options.negate === "boolean" ? void 0 : options.negate;
			this.negate(negateOptions);
		}
		if (options.trim) {
			const trimOptions = typeof options.trim === "boolean" ? void 0 : options.trim;
			this.trim(trimOptions);
		}
		if (options.watermark) this.watermark(options.watermark.image, options.watermark.options);
		if (options.watermarks) this.watermarks(options.watermarks);
		if (options.opacity !== void 0) this.opacity(options.opacity);
		if (options.format) this.format(options.format);
		if (options.quality !== void 0) this.quality(options.quality);
		return this;
	}
	/**
	* Set image opacity (0-100)
	*/
	opacity(value) {
		if (value < 0 || value > 100) throw new Error("Opacity must be between 0 and 100");
		return this.addOperation({
			type: "opacity",
			value
		});
	}
	/**
	* Convert image to black and white
	*/
	blackAndWhite() {
		return this.addOperation({ type: "blackAndWhite" });
	}
	/**
	* Alias for blackAndWhite
	*/
	grayscale() {
		return this.blackAndWhite();
	}
	/**
	* Get image dimensions (cached after first call)
	*/
	async dimensions() {
		const metadata = await this.metadata();
		return {
			width: metadata.width,
			height: metadata.height
		};
	}
	/**
	* Get image metadata (cached after first call)
	*
	* The metadata is cached to avoid repeated async operations.
	* Use `refreshMetadata()` to force a fresh fetch.
	*/
	async metadata() {
		if (!this.cachedMetadata) this.cachedMetadata = await this.image.metadata();
		return this.cachedMetadata;
	}
	/**
	* Force refresh of cached metadata
	*
	* Call this after transformations if you need updated metadata.
	*/
	async refreshMetadata() {
		this.cachedMetadata = await this.image.metadata();
		return this.cachedMetadata;
	}
	/**
	* Clear cached metadata
	*/
	clearMetadataCache() {
		this.cachedMetadata = null;
		return this;
	}
	/**
	* Resize image
	*/
	resize(options) {
		if (typeof options.width !== "undefined" && !options.width) delete options.width;
		if (typeof options.height !== "undefined" && !options.height) delete options.height;
		return this.addOperation({
			type: "resize",
			options
		});
	}
	/**
	* Crop/extract a region from the image
	*/
	crop(options) {
		return this.addOperation({
			type: "crop",
			options
		});
	}
	/**
	* Set image quality (1-100)
	* Quality is stored and applied when saving/exporting
	* based on the final format.
	*/
	quality(quality) {
		if (quality < 1 || quality > 100) throw new Error("Quality must be between 1 and 100");
		this.options.quality = quality;
		return this;
	}
	/**
	* Execute the deferred pipeline - apply all stored operations
	*/
	async executePipeline() {
		if (this.pipelineExecuted) return this.image;
		for (const operation of this.operations) await this.executeOperation(this.image, operation);
		await this.applyFormatAndQuality(this.image);
		this.pipelineExecuted = true;
		return this.image;
	}
	/**
	* Execute a single operation
	*/
	async executeOperation(image, operation) {
		switch (operation.type) {
			case "resize":
				image.resize(operation.options);
				break;
			case "crop":
				image.extract(operation.options);
				break;
			case "rotate":
				image.rotate(operation.angle);
				break;
			case "flip":
				image.flip();
				break;
			case "flop":
				image.flop();
				break;
			case "blur":
				image.blur(operation.sigma);
				break;
			case "sharpen":
				image.sharpen(operation.options);
				break;
			case "blackAndWhite":
				image.toColourspace("b-w");
				break;
			case "opacity": {
				const alpha = Math.round(operation.value / 100 * 255);
				const alphaPixel = Buffer.from([
					255,
					255,
					255,
					alpha
				]);
				image.composite([{
					blend: "dest-in",
					input: alphaPixel
				}]);
				break;
			}
			case "negate":
				image.negate(operation.options);
				break;
			case "tint":
				image.tint(operation.color);
				break;
			case "trim":
				image.trim(operation.options);
				break;
			case "watermark": {
				const buffer = await this.resolveImageBuffer(operation.config.image);
				image.composite([{
					input: buffer,
					...operation.config.options
				}]);
				break;
			}
			case "watermarks": {
				const buffers = await Promise.all(operation.configs.map((config) => this.resolveImageBuffer(config.image)));
				image.composite(operation.configs.map((config, index) => ({
					input: buffers[index],
					...config.options
				})));
				break;
			}
		}
	}
	/**
	* Resolve an image input to a buffer
	*/
	async resolveImageBuffer(input) {
		if (input instanceof Image) return input.image.toBuffer();
		return sharpFn(input).toBuffer();
	}
	/**
	* Apply format and quality options.
	* If no format is explicitly set, preserves the original format and applies
	* quality appropriately based on the format type.
	*/
	async applyFormatAndQuality(image) {
		const { quality, format } = this.options;
		if (format) {
			const formatOptions = quality ? { quality } : void 0;
			image.toFormat(format, formatOptions);
			return;
		}
		if (quality === void 0) return;
		const originalFormat = (await this.metadata()).format;
		if (!originalFormat) {
			image.webp({ quality });
			return;
		}
		if (Image.QUALITY_FORMATS.includes(originalFormat)) image.toFormat(originalFormat, { quality });
		else if (originalFormat === "png") {
			const compressionLevel = Math.round(9 - quality / 100 * 9);
			image.png({ compressionLevel });
		} else if (originalFormat === "gif") image.gif();
	}
	/**
	* Save to file
	*/
	async save(path) {
		return (await this.executePipeline()).toFile(path);
	}
	/**
	* Convert to webp and save to file
	*/
	async saveAsWebp(path) {
		this.options.format = "webp";
		return (await this.executePipeline()).toFile(path);
	}
	/**
	* Change the file format
	*/
	format(format) {
		this.options.format = format;
		return this;
	}
	/**
	* Add watermark (deferred - executed at save time)
	*/
	watermark(image, options = {}) {
		return this.addOperation({
			type: "watermark",
			config: {
				image,
				options
			}
		});
	}
	/**
	* Add multiple watermarks (deferred - executed at save time)
	*/
	watermarks(configs) {
		return this.addOperation({
			type: "watermarks",
			configs
		});
	}
	/**
	* Rotate image
	*/
	rotate(angle) {
		return this.addOperation({
			type: "rotate",
			angle
		});
	}
	/**
	* Flip image vertically (top to bottom)
	*/
	flip() {
		return this.addOperation({ type: "flip" });
	}
	/**
	* Flop image horizontally (left to right)
	*/
	flop() {
		return this.addOperation({ type: "flop" });
	}
	/**
	* Blur image
	*/
	blur(sigma) {
		if (sigma < .3) throw new Error("Blur sigma must be at least 0.3");
		return this.addOperation({
			type: "blur",
			sigma
		});
	}
	/**
	* Convert to base64
	*/
	async toBase64() {
		return (await (await this.executePipeline()).toBuffer()).toString("base64");
	}
	/**
	* Convert to data URL (base64 with mime type prefix)
	*/
	async toDataUrl() {
		const metadata = await this.metadata();
		const format = this.options.format || metadata.format || "png";
		return `data:${`image/${format === "jpg" ? "jpeg" : format}`};base64,${await this.toBase64()}`;
	}
	/**
	* Sharpen image
	*/
	sharpen(options) {
		return this.addOperation({
			type: "sharpen",
			options
		});
	}
	/**
	* Negate/invert image colors
	*/
	negate(options) {
		return this.addOperation({
			type: "negate",
			options
		});
	}
	/**
	* Tint image with a color
	*/
	tint(color) {
		return this.addOperation({
			type: "tint",
			color
		});
	}
	/**
	* Trim edges from the image
	*/
	trim(options) {
		return this.addOperation({
			type: "trim",
			options
		});
	}
	/**
	* Convert to buffer
	*/
	async toBuffer() {
		return (await this.executePipeline()).toBuffer();
	}
	/**
	* Clone the image for separate transformations
	*/
	clone() {
		const clonedImage = new Image(this.image.clone());
		clonedImage.options = { ...this.options };
		clonedImage.operations = [...this.operations];
		clonedImage.cachedMetadata = this.cachedMetadata ? { ...this.cachedMetadata } : null;
		return clonedImage;
	}
	/**
	* Get the current stored options
	*/
	getOptions() {
		return { ...this.options };
	}
	/**
	* Get the pending operations count
	*/
	getPendingOperationsCount() {
		return this.operations.length;
	}
	/**
	* Reset all stored options
	*/
	resetOptions() {
		this.options = {};
		return this;
	}
	/**
	* Clear all pending operations
	*/
	clearOperations() {
		this.operations = [];
		this.pipelineExecuted = false;
		return this;
	}
	/**
	* Reset the image to its initial state (clear operations and options)
	*/
	reset() {
		this.operations = [];
		this.options = {};
		this.pipelineExecuted = false;
		this.cachedMetadata = null;
		return this;
	}
};
//#endregion
export { Image };

//# sourceMappingURL=image.mjs.map