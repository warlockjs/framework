import {
  directoryExistsAsync,
  ensureDirectoryAsync,
  fileExistsAsync,
  removeDirectoryAsync,
  unlinkAsync,
} from "@warlock.js/fs";
import { ltrim } from "@mongez/reinforcements";
import crypto from "crypto";
import { createReadStream, createWriteStream, promises as fsPromises } from "fs";
import { copyFile, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { Transform, type Readable } from "stream";
import { pipeline } from "stream/promises";
import { UploadedFile } from "../../http";
import { storagePath } from "../../utils/paths";
import { url } from "../../utils/urls";
import { storageDriverContext } from "../context/storage-driver-context";
import { resolveWithinRoot } from "../utils/contain-path";
import { StorageError } from "../utils/storage-error";
import type {
  DeleteManyResult,
  ListOptions,
  LocalStorageDriverOptions,
  PutOptions,
  StorageDriverContract,
  StorageDriverType,
  StorageFileData,
  StorageFileInfo,
  TemporaryTokenPayload,
  TemporaryTokenValidation,
} from "../types";
import { getMimeType } from "../utils/mime";

/**
 * Local filesystem storage driver
 *
 * Stores files on the local filesystem with support for:
 * - File operations (put, get, delete, copy, move)
 * - Stream operations for large files
 * - Batch operations
 * - Signed temporary URLs
 */
export class LocalDriver implements StorageDriverContract {
  /**
   * Driver name
   */
  public readonly name: StorageDriverType = "local";

  /**
   * Root path for storage
   */
  protected root: string;

  /**
   * URL prefix for file URLs
   */
  protected urlPrefix: string = "";

  /**
   * URL prefix for temporary file URLs
   */
  protected temporaryUrlPrefix: string;

  /**
   * Secret key for signing temporary URLs
   */
  protected signatureKey?: string;

  public constructor(public options: LocalStorageDriverOptions = {}) {
    // Resolve the root to an absolute, normalized path up front so the
    // path-traversal containment check (resolveWithinRoot) has a stable
    // anchor to compare resolved locations against.
    this.root = resolve(options.root ?? storagePath());
    this.urlPrefix = options.urlPrefix ?? "";
    this.temporaryUrlPrefix = options.temporaryUrlPrefix ?? "/temp-files";
    this.signatureKey = options.signatureKey;
  }

  // ============================================================
  // Prefix Operations
  // ============================================================

  /**
   * Apply prefix to location path
   *
   * Priority: context prefix > driver options prefix > no prefix
   * This allows multi-tenant scenarios where context overrides driver config.
   *
   * @param location - Original location path
   * @returns Location with prefix applied if one exists
   */
  public applyPrefix(location: string): string {
    // Check context prefix first (highest priority)
    const contextPrefix = storageDriverContext.getPrefix();
    const prefix = contextPrefix || this.options.prefix;

    if (!prefix) {
      return location;
    }

    const cleanPrefix = prefix.replace(/\/+$/, "");
    const cleanLocation = location.replace(/^\/+/, "");

    // Avoid double-prefixing
    if (cleanLocation.startsWith(cleanPrefix + "/") || cleanLocation === cleanPrefix) {
      return cleanLocation;
    }

    return `${cleanPrefix}/${cleanLocation}`;
  }

  // ============================================================
  // Core File Operations
  // ============================================================

  /**
   * Put file to local storage
   */
  public async put(
    file: Buffer | string | UploadedFile,
    location: string,
    options?: PutOptions,
  ): Promise<StorageFileData> {
    const absolutePath = this.getAbsolutePath(location);

    await ensureDirectoryAsync(dirname(absolutePath));

    const fileBuffer = await this.toBuffer(file);
    const hash = this.calculateHash(fileBuffer);

    await writeFile(absolutePath, new Uint8Array(fileBuffer));


    const stats = await stat(absolutePath);
    const mimeType = options?.mimeType || this.guessMimeType(location);

    return {
      path: this.applyPrefix(location),
      url: this.url(location),
      size: stats.size,
      hash,
      mimeType,
      driver: this.name,
    };
  }

  /**
   * Atomically put a file only if nothing exists at `location`.
   *
   * Content is written to a temp file in the same directory, then hard-linked
   * to the target. `link()` fails with EEXIST if the target exists, so exactly
   * one concurrent caller wins, the object never appears half-written, and the
   * check is atomic on NFS too. Returns `null` only on EEXIST; other errors throw.
   */
  public async putIfAbsent(
    file: Buffer | string,
    location: string,
    options?: PutOptions,
  ): Promise<StorageFileData | null> {
    const absolutePath = this.getAbsolutePath(location);
    const directory = dirname(absolutePath);

    await ensureDirectoryAsync(directory);

    // Unlike put(), a string here is CONTENT, never a source path (matches
    // the cloud driver): the objects this protects are small JSON bodies.
    const fileBuffer = typeof file === "string" ? Buffer.from(file) : file;
    const hash = this.calculateHash(fileBuffer);

    const tempPath = join(
      directory,
      `.${basename(absolutePath)}.${crypto.randomBytes(8).toString("hex")}.tmp`,
    );

    try {
      await writeFile(tempPath, new Uint8Array(fileBuffer));

      try {
        await fsPromises.link(tempPath, absolutePath);
      } catch (error: any) {
        if (error?.code === "EEXIST") {
          return null;
        }

        throw error;
      }
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }


    const stats = await stat(absolutePath);
    const mimeType = options?.mimeType || this.guessMimeType(location);

    return {
      path: this.applyPrefix(location),
      url: this.url(location),
      size: stats.size,
      hash,
      mimeType,
      driver: this.name,
    };
  }

  /**
   * Put file from a readable stream (for large files)
   */
  public async putStream(
    stream: Readable,
    location: string,
    options?: PutOptions,
  ): Promise<StorageFileData> {
    const absolutePath = this.getAbsolutePath(location);

    await ensureDirectoryAsync(dirname(absolutePath));

    // Hash while streaming so large files are never read back into memory
    const hasher = crypto.createHash("sha256");
    const hashTransform = new Transform({
      transform(chunk, _encoding, callback) {
        hasher.update(chunk);
        callback(null, chunk);
      },
    });

    const writeStream = createWriteStream(absolutePath);
    await pipeline(stream, hashTransform, writeStream);


    const hash = hasher.digest("hex");
    const stats = await stat(absolutePath);
    const mimeType = options?.mimeType || this.guessMimeType(location);

    return {
      path: this.applyPrefix(location),
      url: this.url(location),
      size: stats.size,
      hash,
      mimeType,
      driver: this.name,
    };
  }

  /**
   * Get file contents as Buffer
   */
  public async get(location: string): Promise<Buffer> {
    const absolutePath = this.getAbsolutePath(location);

    if (!(await fileExistsAsync(absolutePath))) {
      throw new Error(`File not found: ${location}`);
    }

    return readFile(absolutePath);
  }

  /**
   * Get file as a readable stream (for large files)
   */
  public async getStream(location: string): Promise<Readable> {
    const absolutePath = this.getAbsolutePath(location);

    if (!(await fileExistsAsync(absolutePath))) {
      throw new Error(`File not found: ${location}`);
    }

    return createReadStream(absolutePath);
  }

  /**
   * Delete a file
   */
  public async delete(location: string): Promise<boolean> {
    const absolutePath = this.getAbsolutePath(location);

    if (!(await fileExistsAsync(absolutePath))) {
      return false;
    }

    await unlinkAsync(absolutePath);


    return true;
  }

  /**
   * Delete multiple files at once
   */
  public async deleteMany(locations: string[]): Promise<DeleteManyResult[]> {
    const results: DeleteManyResult[] = [];

    for (const location of locations) {
      try {
        const deleted = await this.delete(location);
        results.push({ location, deleted });
      } catch (error) {
        results.push({
          location,
          deleted: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  }

  /**
   * Delete directory
   *
   * The directory path is resolved through {@link getAbsolutePath} so it is
   * contained within the storage root — the raw, caller-supplied argument is
   * never handed to the filesystem (preventing `../` traversal deletes).
   */
  public async deleteDirectory(directoryPath: string, options?: { allowRoot?: boolean }) {
    const absolutePath = this.getAbsolutePath(directoryPath);

    if (!options?.allowRoot && resolve(absolutePath) === this.root) {
      throw new StorageError(
        `Refusing to delete the storage root ("${directoryPath}"). Pass { allowRoot: true } to confirm.`,
        { context: { directoryPath } },
      );
    }

    await removeDirectoryAsync(absolutePath);

    return true;
  }

  /**
   * Check if file exists
   */
  public async exists(location: string): Promise<boolean> {
    const absolutePath = this.getAbsolutePath(location);
    return Boolean(await fileExistsAsync(absolutePath));
  }

  // ============================================================
  // URL Operations
  // ============================================================

  /**
   * Get public URL for file
   */
  public url(location: string): string {
    return url(this.urlPrefix + "/" + ltrim(this.applyPrefix(location), "/"));
  }

  /**
   * Get a temporary signed URL that expires
   * Returns a clean URL with encoded token: {temporaryUrlPrefix}/{token}
   *
   * @param location - File path
   * @param expiresIn - Seconds until expiration (default: 3600)
   */
  public async temporaryUrl(location: string, expiresIn = 3600): Promise<string> {
    if (!this.signatureKey) {
      throw new Error(
        "Temporary URLs require a signatureKey in LocalDriver options. " +
          "Configure storage.drivers.local.signatureKey in your config.",
      );
    }

    const token = this.encodeTemporaryToken(location, expiresIn);
    return `${this.temporaryUrlPrefix}/${token}`;
  }

  /**
   * Encode a temporary token containing path, expiry, and signature
   *
   * @param location - File path
   * @param expiresIn - Seconds until expiration
   */
  public encodeTemporaryToken(location: string, expiresIn: number): string {
    if (!this.signatureKey) {
      throw new Error("Temporary tokens require a signatureKey");
    }

    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const sig = crypto
      .createHmac("sha256", this.signatureKey)
      .update(`${location}:${exp}`)
      .digest("hex");

    const payload: TemporaryTokenPayload = { path: location, exp, sig };
    const json = JSON.stringify(payload);

    // Use base64url encoding (URL-safe base64)
    return Buffer.from(json).toString("base64url");
  }

  /**
   * Validate a temporary URL token
   * Returns a result object with validation status, file info, and convenience methods
   *
   * @param token - The token from the URL
   */
  public async validateTemporaryToken(token: string): Promise<TemporaryTokenValidation> {
    // Check signature key
    if (!this.signatureKey) {
      return { valid: false, error: "missing_key" };
    }

    // Decode token
    let payload: TemporaryTokenPayload;
    try {
      const json = Buffer.from(token, "base64url").toString("utf-8");
      payload = JSON.parse(json);
    } catch {
      return { valid: false, error: "invalid_token" };
    }

    // Validate payload structure
    if (!payload.path || !payload.exp || !payload.sig) {
      return { valid: false, error: "invalid_token" };
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { valid: false, error: "expired" };
    }

    // Verify signature
    const expectedSig = crypto
      .createHmac("sha256", this.signatureKey)
      .update(`${payload.path}:${payload.exp}`)
      .digest("hex");

    const sigBuffer = Buffer.from(payload.sig, "hex");
    const expectedBuffer = Buffer.from(expectedSig, "hex");

    if (sigBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: "invalid_signature" };
    }

    const isValidSig = crypto.timingSafeEqual(
      new Uint8Array(sigBuffer),
      new Uint8Array(expectedBuffer),
    );

    if (!isValidSig) {
      return { valid: false, error: "invalid_signature" };
    }

    // Check file exists
    const absolutePath = this.getAbsolutePath(payload.path);
    if (!(await fileExistsAsync(absolutePath))) {
      return { valid: false, error: "file_not_found" };
    }

    // Build successful result with convenience methods
    const result: TemporaryTokenValidation = {
      valid: true,
      path: payload.path,
      absolutePath,
      expiresAt: new Date(payload.exp * 1000),
      mimeType: this.guessMimeType(payload.path),
      driver: this,
      getFile: () => this.get(payload.path),
      getStream: () => this.getStream(payload.path),
    };

    return result;
  }

  // ============================================================
  // Metadata Operations
  // ============================================================

  /**
   * Get file info/metadata without downloading
   */
  public async metadata(location: string): Promise<StorageFileInfo> {
    const absolutePath = this.getAbsolutePath(location);

    if (!(await fileExistsAsync(absolutePath))) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    const stats = await stat(absolutePath);
    const name = location.split("/").pop() || "";

    return {
      path: location,
      name,
      size: stats.size,
      isDirectory: stats.isDirectory(),
      lastModified: stats.mtime,
      mimeType: this.guessMimeType(location),
    };
  }

  /**
   * Get file size in bytes (shortcut for metadata().size)
   */
  public async size(location: string): Promise<number> {
    const metadata = await this.metadata(location);
    return metadata.size;
  }

  // ============================================================
  // File Operations
  // ============================================================

  /**
   * Copy file to a new location
   */
  public async copy(from: string, to: string): Promise<StorageFileData> {
    const fromPath = this.getAbsolutePath(from);
    const toPath = this.getAbsolutePath(to);

    if (!(await fileExistsAsync(fromPath))) {
      throw new Error(`Source file not found: ${from}`);
    }

    await ensureDirectoryAsync(dirname(toPath));
    await copyFile(fromPath, toPath);


    const hash = await this.hashFile(toPath);
    const stats = await stat(toPath);

    return {
      path: this.applyPrefix(to),
      url: this.url(to),
      size: stats.size,
      hash,
      mimeType: this.guessMimeType(to),
      driver: this.name,
    };
  }

  /**
   * Move file to a new location
   */
  public async move(from: string, to: string): Promise<StorageFileData> {
    const fromPath = this.getAbsolutePath(from);
    const toPath = this.getAbsolutePath(to);

    if (!(await fileExistsAsync(fromPath))) {
      throw new Error(`Source file not found: ${from}`);
    }

    await ensureDirectoryAsync(dirname(toPath));
    await rename(fromPath, toPath);


    const hash = await this.hashFile(toPath);
    const stats = await stat(toPath);

    return {
      path: this.applyPrefix(to),
      url: this.url(to),
      size: stats.size,
      hash,
      mimeType: this.guessMimeType(to),
      driver: this.name,
    };
  }

  /**
   * List files in a directory
   */
  public async list(directory: string, options?: ListOptions): Promise<StorageFileInfo[]> {
    const absolutePath = this.getAbsolutePath(directory);
    const files: StorageFileInfo[] = [];

    // A listing target is a DIRECTORY, so guard with `directoryExistsAsync`.
    // `fileExistsAsync` resolves `false` for a folder, which would make `list`
    // always return [] for a real, populated directory.
    if (!(await directoryExistsAsync(absolutePath))) {
      return files;
    }

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
        mimeType: entry.isFile() ? this.guessMimeType(entry.name) : undefined,
      });

      // Recursively list subdirectories if requested
      if (options?.recursive && entry.isDirectory()) {
        const subFiles = await this.list(entryPath, options);
        files.push(...subFiles);
      }

      // Respect limit
      if (options?.limit && files.length >= options.limit) {
        break;
      }
    }

    return files;
  }

  // ============================================================
  // Path Operations
  // ============================================================

  /**
   * Get absolute filesystem path for a location
   */
  public path(location: string): string {
    return this.getAbsolutePath(location);
  }

  /**
   * Get the storage root directory
   */
  public getRoot(): string {
    return this.root;
  }

  // ============================================================
  // Utilities
  // ============================================================

  /**
   * Get absolute file path
   *
   * Routes through {@link resolveWithinRoot} so a location can never escape
   * the configured storage root via `..` traversal, an absolute path, or a
   * prefix breakout.
   */
  protected getAbsolutePath(location: string): string {
    const prefixedLocation = this.applyPrefix(location);
    const resolved = resolveWithinRoot(this.root, prefixedLocation);

    // The prefix is a containment boundary too: "../t2/x" under prefix "t1"
    // must not land in a sibling tenant's directory.
    const prefix = storageDriverContext.getPrefix() || this.options.prefix;

    if (prefix) {
      const prefixRoot = resolveWithinRoot(this.root, prefix.replace(/^[\\/]+|[\\/]+$/g, ""));
      resolveWithinRoot(prefixRoot, resolved);
    }

    return resolved;
  }

  /**
   * Convert various input types to Buffer
   */
  protected async toBuffer(file: Buffer | string | UploadedFile): Promise<Buffer> {
    if (Buffer.isBuffer(file)) {
      return file;
    }

    // A string is always content, never a source path
    if (typeof file === "string") {
      return Buffer.from(file);
    }

    return file.buffer();
  }

  /**
   * Calculate SHA-256 hash
   */
  protected calculateHash(buffer: Buffer): string {
    return crypto.createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
  }

  /**
   * Calculate SHA-256 hash of a file by streaming it (constant memory)
   */
  protected async hashFile(absolutePath: string): Promise<string> {
    const hasher = crypto.createHash("sha256");

    for await (const chunk of createReadStream(absolutePath)) {
      hasher.update(chunk);
    }

    return hasher.digest("hex");
  }

  /**
   * Guess MIME type from file extension
   */
  protected guessMimeType(location: string): string {
    return getMimeType(location);
  }
}
