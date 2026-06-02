import { basename, dirname, extname } from "path";
//#region ../../@warlock.js/core/src/storage/storage-file.ts
/**
* StorageFile class - OOP wrapper for storage file operations
*
* Provides a fluent interface for working with files in storage,
* wrapping the underlying driver operations.
*
* @example
* ```typescript
* const file = await storage.put(buffer, "uploads/image.jpg");
*
* // Properties (sync, from cached data)
* file.name        // "image.jpg"
* file.extension   // "jpg"
* file.path        // "uploads/image.jpg"
* file.hash        // "sha256:abc123..."
*
* // Operations
* await file.copy("uploads/backup.jpg")
* await file.move("archive/image.jpg")
* await file.delete()
*
* // Content
* const buffer = await file.contents();
* const stream = await file.stream();
* ```
*/
var StorageFile = class StorageFile {
	/**
	* Create a new StorageFile instance
	*
	* @param path - Relative file path
	* @param driver - Driver instance
	* @param data - Optional initial data from put/copy operations
	*/
	constructor(path, driver, data) {
		this._deleted = false;
		this._path = path;
		this._driver = driver;
		this._data = data;
	}
	/**
	* Get the relative file path
	*/
	get path() {
		return this._path;
	}
	/**
	* Get the file name (with extension)
	*/
	get name() {
		return basename(this._path);
	}
	/**
	* Get the file extension (without dot)
	*/
	get extension() {
		return extname(this._path).slice(1).toLowerCase();
	}
	/**
	* Get the directory path
	*/
	get directory() {
		return dirname(this._path);
	}
	/**
	* Get the driver name
	*/
	get driver() {
		return this._driver.name;
	}
	/**
	* Check if file has been deleted
	*/
	get isDeleted() {
		return this._deleted;
	}
	/**
	* Get public URL (sync if data cached, otherwise computed)
	*/
	get url() {
		this.ensureNotDeleted();
		return this._data?.url || this._driver.url(this._path);
	}
	/**
	* Get the absolute filesystem path (local driver only)
	*/
	get absolutePath() {
		this.ensureNotDeleted();
		if ("path" in this._driver && typeof this._driver.path === "function") return this._driver.path(this._path);
	}
	/**
	* Get file hash (SHA-256, available from put operations)
	*/
	get hash() {
		return this._data?.hash;
	}
	/**
	* Get cached file data, or fetch it if not available
	*/
	async data() {
		this.ensureNotDeleted();
		if (!this._data) {
			const info = await this.metadata();
			this._data = {
				path: info.path,
				url: this._driver.url(this._path),
				size: info.size,
				hash: "",
				mimeType: info.mimeType || "application/octet-stream",
				driver: this._driver.name
			};
		}
		return this._data;
	}
	/**
	* Get file size in bytes
	*/
	async size() {
		return (await this.data()).size;
	}
	/**
	* Get MIME type
	*/
	async mimeType() {
		return (await this.data()).mimeType;
	}
	/**
	* Get last modified date (fetches from driver)
	*/
	async lastModified() {
		this.ensureNotDeleted();
		return (await this.metadata()).lastModified;
	}
	/**
	* Get ETag (cloud drivers, fetches from driver)
	*/
	async etag() {
		this.ensureNotDeleted();
		return (await this.metadata()).etag;
	}
	/**
	* Get file contents as Buffer
	*/
	async contents() {
		this.ensureNotDeleted();
		return this._driver.get(this._path);
	}
	/**
	* Get file contents as readable stream
	*/
	async stream() {
		this.ensureNotDeleted();
		return this._driver.getStream(this._path);
	}
	/**
	* Get file contents as UTF-8 text
	*/
	async text() {
		return (await this.contents()).toString("utf-8");
	}
	/**
	* Get file contents as base64 string
	*/
	async base64() {
		return (await this.contents()).toString("base64");
	}
	/**
	* Get file contents as data URL
	*/
	async dataUrl() {
		const [buffer, data] = await Promise.all([this.contents(), this.data()]);
		return `data:${data.mimeType};base64,${buffer.toString("base64")}`;
	}
	/**
	* Get a temporary signed URL
	*
	* @param expiresIn - Seconds until expiration (default: 3600)
	*/
	async temporaryUrl(expiresIn = 3600) {
		this.ensureNotDeleted();
		return this._driver.temporaryUrl(this._path, expiresIn);
	}
	/**
	* Check if the file exists
	*/
	async exists() {
		if (this._deleted) return false;
		return this._driver.exists(this._path);
	}
	/**
	* Copy the file to a new location
	*
	* @param destination - Destination path
	* @returns New StorageFile instance at destination
	*/
	async copy(destination) {
		this.ensureNotDeleted();
		const result = await this._driver.copy(this._path, destination);
		return new StorageFile(destination, this._driver, result);
	}
	/**
	* Move the file to a new location
	*
	* @param destination - Destination path
	* @returns This StorageFile instance with updated path
	*/
	async move(destination) {
		this.ensureNotDeleted();
		const result = await this._driver.move(this._path, destination);
		this._path = destination;
		this._data = result;
		return this;
	}
	/**
	* Rename the file (move within same directory)
	*
	* @param newName - New file name
	* @returns This StorageFile instance with updated path
	*/
	async rename(newName) {
		const newPath = this.directory === "." ? newName : `${this.directory}/${newName}`;
		return this.move(newPath);
	}
	/**
	* Delete the file
	*
	* @returns true if deleted, false if not found
	*/
	async delete() {
		this.ensureNotDeleted();
		const result = await this._driver.delete(this._path);
		this._deleted = true;
		return result;
	}
	/**
	* Set file visibility (cloud drivers only)
	*
	* @param visibility - "public" or "private"
	* @throws Error if driver doesn't support visibility
	*/
	async setVisibility(visibility) {
		this.ensureNotDeleted();
		if (!("setVisibility" in this._driver)) throw new Error("setVisibility is only available for cloud storage drivers");
		await this._driver.setVisibility(this._path, visibility);
		return this;
	}
	/**
	* Get file visibility (cloud drivers only)
	*
	* @throws Error if driver doesn't support visibility
	*/
	async getVisibility() {
		this.ensureNotDeleted();
		if (!("getVisibility" in this._driver)) throw new Error("getVisibility is only available for cloud storage drivers");
		return this._driver.getVisibility(this._path);
	}
	/**
	* Set storage class (cloud drivers only)
	*
	* @param storageClass - Storage class (e.g., "STANDARD", "GLACIER")
	* @throws Error if driver doesn't support storage class
	*/
	async setStorageClass(storageClass) {
		this.ensureNotDeleted();
		if (!("setStorageClass" in this._driver)) throw new Error("setStorageClass is only available for cloud storage drivers");
		await this._driver.setStorageClass(this._path, storageClass);
		return this;
	}
	/**
	* Ensure the file has not been deleted
	*/
	ensureNotDeleted() {
		if (this._deleted) throw new Error(`File "${this._path}" has been deleted`);
	}
	/**
	* Create a StorageFile instance from StorageFileData
	*
	* @param data - Storage file data from put/copy/move operations
	* @param driver - Driver instance
	*/
	static fromData(data, driver) {
		return new StorageFile(data.path, driver, data);
	}
	/**
	* Get file metadata
	*/
	async metadata() {
		this.ensureNotDeleted();
		return this._driver.metadata(this._path);
	}
	/**
	* Determine if this file is an image type
	*/
	async isImage() {
		return (await this.metadata()).mimeType.startsWith("image/");
	}
	/**
	* Determine if this file is a document type
	*/
	async isDocument() {
		return (await this.metadata()).mimeType.startsWith("application/");
	}
	/**
	* Determine if this file is a pdf type
	*/
	async isPdf() {
		return (await this.metadata()).mimeType.startsWith("application/pdf");
	}
	/**
	* Determine if this file is an excel file (any support excel file)
	*/
	async isExcel() {
		const metadata = await this.metadata();
		return metadata.mimeType.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") || metadata.mimeType.startsWith("application/vnd.ms-excel");
	}
	/**
	* Determine if this file is a doc file
	*/
	async isDoc() {
		const metadata = await this.metadata();
		return metadata.mimeType.startsWith("application/msword") || metadata.mimeType.startsWith("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
	}
	/**
	* Determine if this file is an audio type
	*/
	async isAudio() {
		return (await this.metadata()).mimeType.startsWith("audio/");
	}
	/**
	* Determine if this file is a video type
	*/
	async isVideo() {
		return (await this.metadata()).mimeType.startsWith("video/");
	}
	/**
	* Convert to plain object (returns cached data or constructs it)
	*/
	toJSON() {
		return {
			path: this._path,
			name: this.name,
			extension: this.extension,
			driver: this._driver.name,
			url: this._deleted ? "" : this.url,
			hash: this._data?.hash,
			size: this._data?.size,
			mimeType: this._data?.mimeType
		};
	}
	/**
	* String representation
	*/
	toString() {
		return this._path;
	}
};
//#endregion
export { StorageFile };

//# sourceMappingURL=storage-file.mjs.map