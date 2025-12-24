import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectAclCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import type { Readable } from "stream";
import type {
  CloudStorageDriverContract,
  CloudStorageDriverOptions,
  CloudStorageFileData,
  DeleteManyResult,
  FileVisibility,
  ListOptions,
  PresignedOptions,
  PresignedUploadOptions,
  PutOptions,
  StorageFileInfo,
} from "../types";
import { getMimeType } from "../utils/mime";

/**
 * Base abstract class for all S3-compatible cloud storage drivers
 *
 * This class contains all shared logic for S3-compatible storage services
 * including AWS S3, Cloudflare R2, DigitalOcean Spaces, and others.
 *
 * Subclasses must implement:
 * - `name`: Driver identifier (e.g., "s3", "r2", "spaces")
 * - `url()`: Returns the public URL for a file (provider-specific format)
 */
export abstract class CloudDriver<
  TOptions extends CloudStorageDriverOptions = CloudStorageDriverOptions,
> implements CloudStorageDriverContract
{
  /**
   * S3-compatible client
   */
  protected client: S3Client;

  public constructor(protected options: TOptions) {
    this.client = new S3Client({
      region: this.options.region,
      credentials: {
        accessKeyId: this.options.accessKeyId,
        secretAccessKey: this.options.secretAccessKey,
      },
      ...(this.getEndpoint() && { endpoint: this.getEndpoint() }),
    });
  }

  /**
   * Driver name identifier
   */
  public abstract readonly name: string;

  /**
   * Get public URL for file
   * Must be implemented by subclasses with provider-specific format
   */
  public abstract url(location: string): string;

  /**
   * Get endpoint URL
   * Can be overridden by subclasses for provider-specific endpoints
   */
  protected getEndpoint(): string | undefined {
    return this.options.endpoint;
  }

  // ============================================================
  // Core File Operations
  // ============================================================

  /**
   * Put file to cloud storage
   */
  public async put(
    file: Buffer,
    location: string,
    options?: PutOptions,
  ): Promise<CloudStorageFileData> {
    const hash = this.calculateHash(file);
    const mimeType = options?.mimeType || this.guessMimeType(location);

    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: location,
      Body: file,
      ContentType: mimeType,
      CacheControl: options?.cacheControl,
      ContentDisposition: options?.contentDisposition,
      Metadata: options?.metadata,
      ACL: options?.visibility === "public" ? "public-read" : undefined,
    });

    const result = await this.client.send(command);

    return {
      path: location,
      url: this.url(location),
      size: file.length,
      hash,
      mimeType,
      driver: this.name,
      bucket: this.options.bucket,
      region: this.options.region,
      etag: result.ETag,
      versionId: result.VersionId,
    };
  }

  /**
   * Put file from a readable stream (for large files)
   * Uses S3 multipart upload for efficient streaming
   */
  public async putStream(
    stream: Readable,
    location: string,
    options?: PutOptions,
  ): Promise<CloudStorageFileData> {
    const mimeType = options?.mimeType || this.guessMimeType(location);

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.options.bucket,
        Key: location,
        Body: stream,
        ContentType: mimeType,
        CacheControl: options?.cacheControl,
        ContentDisposition: options?.contentDisposition,
        Metadata: options?.metadata,
        ACL: options?.visibility === "public" ? "public-read" : undefined,
      },
    });

    const result = await upload.done();

    // Get file info for size and hash
    const info = await this.getInfo(location);

    return {
      path: location,
      url: this.url(location),
      size: info.size,
      hash: info.etag?.replace(/"/g, "") || "",
      mimeType,
      driver: this.name,
      bucket: this.options.bucket,
      region: this.options.region,
      etag: result.ETag,
      versionId: result.VersionId,
    };
  }

  /**
   * Get file contents as Buffer
   */
  public async get(location: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: location,
    });

    const result = await this.client.send(command);

    if (!result.Body) {
      throw new Error(`File not found: ${location}`);
    }

    return Buffer.from(await result.Body.transformToByteArray());
  }

  /**
   * Get file as a readable stream (for large files)
   */
  public async getStream(location: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: location,
    });

    const result = await this.client.send(command);

    if (!result.Body) {
      throw new Error(`File not found: ${location}`);
    }

    return result.Body as Readable;
  }

  /**
   * Delete a file
   */
  public async delete(location: string): Promise<boolean> {
    const command = new DeleteObjectCommand({
      Bucket: this.options.bucket,
      Key: location,
    });

    await this.client.send(command);
    return true;
  }

  /**
   * Delete multiple files at once (uses batch delete for efficiency)
   */
  public async deleteMany(locations: string[]): Promise<DeleteManyResult[]> {
    if (locations.length === 0) {
      return [];
    }

    const command = new DeleteObjectsCommand({
      Bucket: this.options.bucket,
      Delete: {
        Objects: locations.map((Key) => ({ Key })),
        Quiet: false,
      },
    });

    const result = await this.client.send(command);
    const results: DeleteManyResult[] = [];

    // Process successful deletes
    for (const deleted of result.Deleted || []) {
      if (deleted.Key) {
        results.push({ location: deleted.Key, deleted: true });
      }
    }

    // Process errors
    for (const error of result.Errors || []) {
      if (error.Key) {
        results.push({
          location: error.Key,
          deleted: false,
          error: error.Message || "Unknown error",
        });
      }
    }

    return results;
  }

  /**
   * Check if file exists
   */
  public async exists(location: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.options.bucket,
        Key: location,
      });

      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================
  // URL Operations
  // ============================================================

  /**
   * Get a temporary presigned URL (alias for getPresignedUrl)
   */
  public async temporaryUrl(location: string, expiresIn = 3600): Promise<string> {
    return this.getPresignedUrl(location, { expiresIn });
  }

  /**
   * Get presigned URL for downloading
   */
  public async getPresignedUrl(location: string, options?: PresignedOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: location,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options?.expiresIn || 3600,
    });
  }

  /**
   * Get presigned URL for uploading
   */
  public async getPresignedUploadUrl(
    location: string,
    options?: PresignedUploadOptions,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: location,
      ContentType: options?.contentType,
      Metadata: options?.metadata,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options?.expiresIn || 3600,
    });
  }

  // ============================================================
  // Metadata Operations
  // ============================================================

  /**
   * Get file info/metadata without downloading
   */
  public async getInfo(location: string): Promise<StorageFileInfo> {
    const command = new HeadObjectCommand({
      Bucket: this.options.bucket,
      Key: location,
    });

    const result = await this.client.send(command);
    const name = location.split("/").pop() || "";

    return {
      path: location,
      name,
      size: result.ContentLength || 0,
      isDirectory: false,
      lastModified: result.LastModified,
      mimeType: result.ContentType || this.guessMimeType(location),
      etag: result.ETag,
      storageClass: result.StorageClass,
    };
  }

  /**
   * Get file size in bytes (shortcut for getInfo().size)
   */
  public async size(location: string): Promise<number> {
    const info = await this.getInfo(location);
    return info.size;
  }

  // ============================================================
  // File Operations
  // ============================================================

  /**
   * Copy file to a new location
   */
  public async copy(from: string, to: string): Promise<CloudStorageFileData> {
    const command = new CopyObjectCommand({
      Bucket: this.options.bucket,
      CopySource: `${this.options.bucket}/${from}`,
      Key: to,
    });

    const result = await this.client.send(command);

    // Get file metadata
    const headCommand = new HeadObjectCommand({
      Bucket: this.options.bucket,
      Key: to,
    });
    const headResult = await this.client.send(headCommand);

    return {
      path: to,
      url: this.url(to),
      size: headResult.ContentLength || 0,
      hash: headResult.ETag?.replace(/"/g, "") || "",
      mimeType: headResult.ContentType || this.guessMimeType(to),
      driver: this.name,
      bucket: this.options.bucket,
      region: this.options.region,
      etag: result.CopyObjectResult?.ETag,
      versionId: result.VersionId,
    };
  }

  /**
   * Move file to a new location
   */
  public async move(from: string, to: string): Promise<CloudStorageFileData> {
    const file = await this.copy(from, to);
    await this.delete(from);
    return file;
  }

  /**
   * List files in a directory
   */
  public async list(directory: string, options?: ListOptions): Promise<StorageFileInfo[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.options.bucket,
      Prefix: directory,
      MaxKeys: options?.limit,
      ContinuationToken: options?.cursor,
      Delimiter: options?.recursive ? undefined : "/",
    });

    const result = await this.client.send(command);
    const files: StorageFileInfo[] = [];

    // Add files
    for (const object of result.Contents || []) {
      if (!object.Key) continue;

      files.push({
        path: object.Key,
        name: object.Key.split("/").pop() || "",
        size: object.Size || 0,
        isDirectory: false,
        lastModified: object.LastModified,
        etag: object.ETag,
        storageClass: object.StorageClass,
      });
    }

    // Add directories
    for (const prefix of result.CommonPrefixes || []) {
      if (!prefix.Prefix) continue;

      files.push({
        path: prefix.Prefix,
        name: prefix.Prefix.split("/").filter(Boolean).pop() || "",
        size: 0,
        isDirectory: true,
      });
    }

    return files;
  }

  // ============================================================
  // Cloud-Specific Operations
  // ============================================================

  /**
   * Get bucket name
   */
  public getBucket(): string {
    return this.options.bucket;
  }

  /**
   * Get region
   */
  public getRegion(): string {
    return this.options.region;
  }

  /**
   * Set storage class (e.g., STANDARD, GLACIER, etc.)
   */
  public async setStorageClass(location: string, storageClass: string): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.options.bucket,
      CopySource: `${this.options.bucket}/${location}`,
      Key: location,
      StorageClass: storageClass as any,
      MetadataDirective: "COPY",
    });

    await this.client.send(command);
  }

  /**
   * Set file visibility (public or private)
   */
  public async setVisibility(location: string, visibility: FileVisibility): Promise<void> {
    const command = new PutObjectAclCommand({
      Bucket: this.options.bucket,
      Key: location,
      ACL: visibility === "public" ? "public-read" : "private",
    });

    await this.client.send(command);
  }

  /**
   * Get file visibility
   */
  public async getVisibility(location: string): Promise<FileVisibility> {
    const command = new GetObjectAclCommand({
      Bucket: this.options.bucket,
      Key: location,
    });

    const result = await this.client.send(command);

    // Check if any grant allows public read
    const hasPublicRead = result.Grants?.some(
      (grant) =>
        grant.Grantee?.URI === "http://acs.amazonaws.com/groups/global/AllUsers" &&
        grant.Permission === "READ",
    );

    return hasPublicRead ? "public" : "private";
  }

  // ============================================================
  // Utilities
  // ============================================================

  /**
   * Calculate SHA-256 hash
   */
  protected calculateHash(buffer: Buffer): string {
    return crypto.createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
  }

  /**
   * Guess MIME type from file extension
   */
  protected guessMimeType(location: string): string {
    return getMimeType(location);
  }
}
