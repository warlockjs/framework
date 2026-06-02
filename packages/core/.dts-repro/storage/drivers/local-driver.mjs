import { storagePath } from "../../utils/paths.mjs";
import { url } from "../../utils/urls.mjs";
import { storageDriverContext } from "../context/storage-driver-context.mjs";
import { getMimeType } from "../utils/mime.mjs";
import { dirname, join } from "path";
import { ltrim } from "@mongez/reinforcements";
import { directoryExistsAsync, ensureDirectoryAsync, fileExistsAsync, removeDirectoryAsync, unlinkAsync } from "@warlock.js/fs";
import { createReadStream, createWriteStream } from "fs";
import { copyFile, readFile, readdir, rename, stat, writeFile } from "fs/promises";
import crypto from "crypto";
import { pipeline } from "stream/promises";
//#region ../../@warlock.js/core/src/storage/drivers/local-driver.ts
/**
* Local filesystem storage driver
*
* Stores files on the local filesystem with support for:
* - File operations (put, get, delete, copy, move)
* - Stream operations for large files
* - Batch operations
* - Signed temporary URLs
*/
var LocalDriver = class {
	constructor(options = {}) {
		this.options = options;
		this.name = "local";
		this.urlPrefix = "";
		this._metadata = /* @__PURE__ */ new Map();
		this.root = options.root ?? storagePath();
		this.urlPrefix = options.urlPrefix ?? "";
		this.temporaryUrlPrefix = options.temporaryUrlPrefix ?? "/temp-files";
		this.signatureKey = options.signatureKey;
	}
	/**
	* Apply prefix to location path
	*
	* Priority: context prefix > driver options prefix > no prefix
	* This allows multi-tenant scenarios where context overrides driver config.
	*
	* @param location - Original location path
	* @returns Location with prefix applied if one exists
	*/
	applyPrefix(location) {
		const prefix = storageDriverContext.getPrefix() || this.options.prefix;
		if (!prefix) return location;
		const cleanPrefix = prefix.replace(/\/+$/, "");
		const cleanLocation = location.replace(/^\/+/, "");
		if (cleanLocation.startsWith(cleanPrefix + "/") || cleanLocation === cleanPrefix) return cleanLocation;
		return `${cleanPrefix}/${cleanLocation}`;
	}
	/**
	* Put file to local storage
	*/
	async put(file, location, options) {
		const absolutePath = this.getAbsolutePath(location);
		await ensureDirectoryAsync(dirname(absolutePath));
		const fileBuffer = await this.toBuffer(file);
		const hash = this.calculateHash(fileBuffer);
		await writeFile(absolutePath, new Uint8Array(fileBuffer));
		const stats = await stat(absolutePath);
		const mimeType = options?.mimeType || this.guessMimeType(location);
		return {
			path: location,
			url: this.url(location),
			size: stats.size,
			hash,
			mimeType,
			driver: this.name
		};
	}
	/**
	* Put file from a readable stream (for large files)
	*/
	async putStream(stream, location, options) {
		const absolutePath = this.getAbsolutePath(location);
		await ensureDirectoryAsync(dirname(absolutePath));
		await pipeline(stream, createWriteStream(absolutePath));
		const fileBuffer = await readFile(absolutePath);
		const hash = this.calculateHash(fileBuffer);
		const stats = await stat(absolutePath);
		const mimeType = options?.mimeType || this.guessMimeType(location);
		return {
			path: location,
			url: this.url(location),
			size: stats.size,
			hash,
			mimeType,
			driver: this.name
		};
	}
	/**
	* Get file contents as Buffer
	*/
	async get(location) {
		const absolutePath = this.getAbsolutePath(location);
		if (!await fileExistsAsync(absolutePath)) throw new Error(`File not found: ${location}`);
		return readFile(absolutePath);
	}
	/**
	* Get file as a readable stream (for large files)
	*/
	async getStream(location) {
		const absolutePath = this.getAbsolutePath(location);
		if (!await fileExistsAsync(absolutePath)) throw new Error(`File not found: ${location}`);
		return createReadStream(absolutePath);
	}
	/**
	* Delete a file
	*/
	async delete(location) {
		const absolutePath = this.getAbsolutePath(location);
		if (!await fileExistsAsync(absolutePath)) return false;
		await unlinkAsync(absolutePath);
		return true;
	}
	/**
	* Delete multiple files at once
	*/
	async deleteMany(locations) {
		const results = [];
		for (const location of locations) try {
			const deleted = await this.delete(location);
			results.push({
				location,
				deleted
			});
		} catch (error) {
			results.push({
				location,
				deleted: false,
				error: error instanceof Error ? error.message : "Unknown error"
			});
		}
		return results;
	}
	/**
	* Delete directory
	*/
	async deleteDirectory(directoryPath) {
		await removeDirectoryAsync(directoryPath);
		return true;
	}
	/**
	* Check if file exists
	*/
	async exists(location) {
		const absolutePath = this.getAbsolutePath(location);
		return Boolean(await fileExistsAsync(absolutePath));
	}
	/**
	* Get public URL for file
	*/
	url(location) {
		return url(this.urlPrefix + "/" + ltrim(location, "/"));
	}
	/**
	* Get a temporary signed URL that expires
	* Returns a clean URL with encoded token: {temporaryUrlPrefix}/{token}
	*
	* @param location - File path
	* @param expiresIn - Seconds until expiration (default: 3600)
	*/
	async temporaryUrl(location, expiresIn = 3600) {
		if (!this.signatureKey) throw new Error("Temporary URLs require a signatureKey in LocalDriver options. Configure storage.drivers.local.signatureKey in your config.");
		const token = this.encodeTemporaryToken(location, expiresIn);
		return `${this.temporaryUrlPrefix}/${token}`;
	}
	/**
	* Encode a temporary token containing path, expiry, and signature
	*
	* @param location - File path
	* @param expiresIn - Seconds until expiration
	*/
	encodeTemporaryToken(location, expiresIn) {
		if (!this.signatureKey) throw new Error("Temporary tokens require a signatureKey");
		const exp = Math.floor(Date.now() / 1e3) + expiresIn;
		const payload = {
			path: location,
			exp,
			sig: crypto.createHmac("sha256", this.signatureKey).update(`${location}:${exp}`).digest("hex")
		};
		const json = JSON.stringify(payload);
		return Buffer.from(json).toString("base64url");
	}
	/**
	* Validate a temporary URL token
	* Returns a result object with validation status, file info, and convenience methods
	*
	* @param token - The token from the URL
	*/
	async validateTemporaryToken(token) {
		if (!this.signatureKey) return {
			valid: false,
			error: "missing_key"
		};
		let payload;
		try {
			const json = Buffer.from(token, "base64url").toString("utf-8");
			payload = JSON.parse(json);
		} catch {
			return {
				valid: false,
				error: "invalid_token"
			};
		}
		if (!payload.path || !payload.exp || !payload.sig) return {
			valid: false,
			error: "invalid_token"
		};
		const now = Math.floor(Date.now() / 1e3);
		if (payload.exp < now) return {
			valid: false,
			error: "expired"
		};
		const expectedSig = crypto.createHmac("sha256", this.signatureKey).update(`${payload.path}:${payload.exp}`).digest("hex");
		const sigBuffer = Buffer.from(payload.sig, "hex");
		const expectedBuffer = Buffer.from(expectedSig, "hex");
		if (sigBuffer.length !== expectedBuffer.length) return {
			valid: false,
			error: "invalid_signature"
		};
		if (!crypto.timingSafeEqual(new Uint8Array(sigBuffer), new Uint8Array(expectedBuffer))) return {
			valid: false,
			error: "invalid_signature"
		};
		const absolutePath = this.getAbsolutePath(payload.path);
		if (!await fileExistsAsync(absolutePath)) return {
			valid: false,
			error: "file_not_found"
		};
		return {
			valid: true,
			path: payload.path,
			absolutePath,
			expiresAt: /* @__PURE__ */ new Date(payload.exp * 1e3),
			mimeType: this.guessMimeType(payload.path),
			driver: this,
			getFile: () => this.get(payload.path),
			getStream: () => this.getStream(payload.path)
		};
	}
	/**
	* Get file info/metadata without downloading
	*/
	async metadata(location) {
		if (this._metadata.has(location)) return this._metadata.get(location);
		const absolutePath = this.getAbsolutePath(location);
		if (!await fileExistsAsync(absolutePath)) throw new Error(`File not found: ${absolutePath}`);
		const stats = await stat(absolutePath);
		const name = location.split("/").pop() || "";
		this._metadata.set(location, {
			path: location,
			name,
			size: stats.size,
			isDirectory: stats.isDirectory(),
			lastModified: stats.mtime,
			mimeType: this.guessMimeType(location)
		});
		return this._metadata.get(location);
	}
	/**
	* Get file size in bytes (shortcut for metadata().size)
	*/
	async size(location) {
		return (await this.metadata(location)).size;
	}
	/**
	* Copy file to a new location
	*/
	async copy(from, to) {
		const fromPath = this.getAbsolutePath(from);
		const toPath = this.getAbsolutePath(to);
		if (!await fileExistsAsync(fromPath)) throw new Error(`Source file not found: ${from}`);
		await ensureDirectoryAsync(dirname(toPath));
		await copyFile(fromPath, toPath);
		const fileBuffer = await readFile(toPath);
		const hash = this.calculateHash(fileBuffer);
		const stats = await stat(toPath);
		return {
			path: to,
			url: this.url(to),
			size: stats.size,
			hash,
			mimeType: this.guessMimeType(to),
			driver: this.name
		};
	}
	/**
	* Move file to a new location
	*/
	async move(from, to) {
		const fromPath = this.getAbsolutePath(from);
		const toPath = this.getAbsolutePath(to);
		if (!await fileExistsAsync(fromPath)) throw new Error(`Source file not found: ${from}`);
		await ensureDirectoryAsync(dirname(toPath));
		await rename(fromPath, toPath);
		const fileBuffer = await readFile(toPath);
		const hash = this.calculateHash(fileBuffer);
		const stats = await stat(toPath);
		return {
			path: to,
			url: this.url(to),
			size: stats.size,
			hash,
			mimeType: this.guessMimeType(to),
			driver: this.name
		};
	}
	/**
	* List files in a directory
	*/
	async list(directory, options) {
		const absolutePath = this.getAbsolutePath(directory);
		const files = [];
		if (!await directoryExistsAsync(absolutePath)) return files;
		const entries = await readdir(absolutePath, { withFileTypes: true });
		for (const entry of entries) {
			const entryPath = join(directory, entry.name);
			const entryStats = await stat(this.getAbsolutePath(entryPath));
			files.push({
				path: entryPath,
				name: entry.name,
				size: entryStats.size,
				isDirectory: entry.isDirectory(),
				lastModified: entryStats.mtime,
				mimeType: entry.isFile() ? this.guessMimeType(entry.name) : void 0
			});
			if (options?.recursive && entry.isDirectory()) {
				const subFiles = await this.list(entryPath, options);
				files.push(...subFiles);
			}
			if (options?.limit && files.length >= options.limit) break;
		}
		return files;
	}
	/**
	* Get absolute filesystem path for a location
	*/
	path(location) {
		return this.getAbsolutePath(location);
	}
	/**
	* Get the storage root directory
	*/
	getRoot() {
		return this.root;
	}
	/**
	* Get absolute file path
	*/
	getAbsolutePath(location) {
		const prefixedLocation = this.applyPrefix(location);
		return join(this.root, prefixedLocation);
	}
	/**
	* Convert various input types to Buffer
	*/
	async toBuffer(file) {
		if (Buffer.isBuffer(file)) return file;
		if (typeof file === "string") return readFile(file);
		return file.buffer();
	}
	/**
	* Calculate SHA-256 hash
	*/
	calculateHash(buffer) {
		return crypto.createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
	}
	/**
	* Guess MIME type from file extension
	*/
	guessMimeType(location) {
		return getMimeType(location);
	}
};
//#endregion
export { LocalDriver };

//# sourceMappingURL=local-driver.mjs.map