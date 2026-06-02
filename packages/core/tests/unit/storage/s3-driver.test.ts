import { Readable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S3 / cloud driver tests with the AWS SDK fully MOCKED — no network, no real
 * bucket. We intercept `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, and
 * `@aws-sdk/s3-request-presigner` so we can assert the exact commands and
 * params the CloudDriver composes, and feed canned responses back.
 *
 * Source: core/src/storage/drivers/cloud-driver.ts + s3-driver.ts.
 *
 * Each command class records the input object it was constructed with onto a
 * shared `sentCommands` log keyed by command name; `client.send` resolves the
 * next queued response.
 */

const sentCommands: Array<{ name: string; input: any }> = [];
let sendResponses: any[] = [];

function makeCommand(name: string) {
  return class {
    public readonly input: any;
    public constructor(input: any) {
      this.input = input;
    }
  };
}

const sendMock = vi.fn(async (command: any) => {
  sentCommands.push({ name: command.constructor.name, input: command.input });
  return sendResponses.shift() ?? {};
});

vi.mock("@aws-sdk/client-s3", () => {
  // Each command name must match how cloud-driver destructures it.
  const commands: Record<string, any> = {};
  for (const name of [
    "PutObjectCommand",
    "GetObjectCommand",
    "DeleteObjectCommand",
    "DeleteObjectsCommand",
    "HeadObjectCommand",
    "ListObjectsV2Command",
    "CopyObjectCommand",
    "PutObjectAclCommand",
    "GetObjectAclCommand",
  ]) {
    const Cmd = makeCommand(name);
    Object.defineProperty(Cmd, "name", { value: name });
    commands[name] = Cmd;
  }

  class S3Client {
    public send = sendMock;
    public config: any;
    public constructor(config: any) {
      this.config = config;
    }
  }

  return { S3Client, ...commands };
});

vi.mock("@aws-sdk/lib-storage", () => {
  class Upload {
    private params: any;
    public constructor(opts: any) {
      this.params = opts.params;
    }
    public async done() {
      sentCommands.push({ name: "Upload", input: this.params });
      return { ETag: '"upload-etag"', VersionId: "v-up" };
    }
  }

  return { Upload };
});

vi.mock("@aws-sdk/s3-request-presigner", () => {
  return {
    getSignedUrl: vi.fn(async (_client: any, command: any, options: any) => {
      sentCommands.push({ name: `presign:${command.constructor.name}`, input: command.input });
      return `https://signed.example.com/${command.input.Key}?expires=${options?.expiresIn ?? 0}`;
    }),
  };
});

// Import AFTER mocks are registered. The module kicks off loadS3() at import,
// which resolves the mocked SDK and flips its internal `isModuleExists` flag.
import { S3Driver } from "../../../src/storage/drivers/s3-driver";

const baseOptions = {
  bucket: "my-bucket",
  region: "us-east-1",
  accessKeyId: "AKIA-test",
  secretAccessKey: "secret-test",
  // Disable backoff delays so retry-path tests run instantly.
  retry: { maxRetries: 2, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 },
};

function makeDriver(extra: Record<string, any> = {}) {
  return new S3Driver({ ...baseOptions, ...extra });
}

function lastCommand(name: string) {
  return [...sentCommands].reverse().find((command) => command.name === name);
}

beforeEach(() => {
  sentCommands.length = 0;
  sendResponses = [];
  sendMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("S3Driver — put", () => {
  it("sends a PutObjectCommand with the correct bucket / key / body", async () => {
    sendResponses = [{ ETag: '"abc"', VersionId: "v1" }];
    const driver = makeDriver();
    const body = Buffer.from("file-content");

    const data = await driver.put(body, "images/photo.jpg", { mimeType: "image/jpeg" });

    const put = lastCommand("PutObjectCommand")!;

    expect(put.input.Bucket).toBe("my-bucket");
    expect(put.input.Key).toBe("images/photo.jpg");
    expect(put.input.Body).toBe(body);
    expect(put.input.ContentType).toBe("image/jpeg");
    expect(data.etag).toBe('"abc"');
    expect(data.size).toBe(body.length);
    expect(data.bucket).toBe("my-bucket");
  });

  it("maps visibility=public to a public-read ACL", async () => {
    sendResponses = [{ ETag: '"x"' }];
    const driver = makeDriver();

    await driver.put(Buffer.from("p"), "f.bin", { visibility: "public" });

    expect(lastCommand("PutObjectCommand")!.input.ACL).toBe("public-read");
  });

  it("forwards metadata, cacheControl, and contentDisposition", async () => {
    sendResponses = [{ ETag: '"x"' }];
    const driver = makeDriver();

    await driver.put(Buffer.from("p"), "f.bin", {
      metadata: { owner: "alice" },
      cacheControl: "max-age=60",
      contentDisposition: "attachment",
    });

    const put = lastCommand("PutObjectCommand")!;

    expect(put.input.Metadata).toEqual({ owner: "alice" });
    expect(put.input.CacheControl).toBe("max-age=60");
    expect(put.input.ContentDisposition).toBe("attachment");
  });

  it("applies a configured key prefix", async () => {
    sendResponses = [{ ETag: '"x"' }];
    const driver = makeDriver({ prefix: "production/app" });

    await driver.put(Buffer.from("p"), "uploads/file.bin");

    expect(lastCommand("PutObjectCommand")!.input.Key).toBe("production/app/uploads/file.bin");
  });
});

describe("S3Driver — get", () => {
  it("returns a Buffer from the object body", async () => {
    const bytes = Buffer.from("downloaded");
    sendResponses = [
      {
        Body: {
          transformToByteArray: async () => new Uint8Array(bytes),
        },
      },
    ];
    const driver = makeDriver();

    const result = await driver.get("a/b.txt");

    expect(result.equals(bytes)).toBe(true);
    expect(lastCommand("GetObjectCommand")!.input.Key).toBe("a/b.txt");
  });

  it("throws when the body is empty", async () => {
    sendResponses = [{ Body: undefined }, { Body: undefined }];
    const driver = makeDriver();

    await expect(driver.get("missing.txt")).rejects.toThrow();
  });
});

describe("S3Driver — delete / deleteMany", () => {
  it("sends a DeleteObjectCommand and returns true", async () => {
    sendResponses = [{}];
    const driver = makeDriver();

    expect(await driver.delete("old.txt")).toBe(true);
    expect(lastCommand("DeleteObjectCommand")!.input.Key).toBe("old.txt");
  });

  it("batch deletes and maps Deleted + Errors", async () => {
    sendResponses = [
      {
        Deleted: [{ Key: "a.txt" }, { Key: "b.txt" }],
        Errors: [{ Key: "c.txt", Message: "AccessDenied" }],
      },
    ];
    const driver = makeDriver();

    const results = await driver.deleteMany(["a.txt", "b.txt", "c.txt"]);

    expect(results).toEqual([
      { location: "a.txt", deleted: true },
      { location: "b.txt", deleted: true },
      { location: "c.txt", deleted: false, error: "AccessDenied" },
    ]);

    const command = lastCommand("DeleteObjectsCommand")!;

    expect(command.input.Delete.Objects).toEqual([
      { Key: "a.txt" },
      { Key: "b.txt" },
      { Key: "c.txt" },
    ]);
  });

  it("short-circuits an empty deleteMany without calling send", async () => {
    const driver = makeDriver();

    expect(await driver.deleteMany([])).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("S3Driver — exists", () => {
  it("returns true when HeadObject succeeds", async () => {
    sendResponses = [{ ContentLength: 10 }];
    const driver = makeDriver();

    expect(await driver.exists("there.txt")).toBe(true);
    expect(lastCommand("HeadObjectCommand")!.input.Key).toBe("there.txt");
  });

  it("returns false when HeadObject throws", async () => {
    sendMock.mockRejectedValueOnce(new Error("NotFound"));
    const driver = makeDriver();

    expect(await driver.exists("nope.txt")).toBe(false);
  });
});

describe("S3Driver — metadata", () => {
  it("maps HeadObject output to StorageFileInfo", async () => {
    const modified = new Date("2024-01-01T00:00:00Z");
    sendResponses = [
      {
        ContentLength: 123,
        LastModified: modified,
        ContentType: "text/plain",
        ETag: '"etag-1"',
        StorageClass: "STANDARD",
      },
    ];
    const driver = makeDriver();

    const info = await driver.metadata("dir/file.txt");

    expect(info).toMatchObject({
      path: "dir/file.txt",
      name: "file.txt",
      size: 123,
      isDirectory: false,
      mimeType: "text/plain",
      etag: '"etag-1"',
      storageClass: "STANDARD",
      lastModified: modified,
    });
  });
});

describe("S3Driver — copy / move", () => {
  it("copy issues CopyObject + HeadObject with the right CopySource", async () => {
    sendResponses = [
      { CopyObjectResult: { ETag: '"copied"' }, VersionId: "v2" },
      { ContentLength: 50, ContentType: "image/png", ETag: '"copied"' },
    ];
    const driver = makeDriver();

    const data = await driver.copy("src/a.png", "dst/b.png");

    const copy = lastCommand("CopyObjectCommand")!;

    expect(copy.input.CopySource).toBe("my-bucket/src/a.png");
    expect(copy.input.Key).toBe("dst/b.png");
    expect(data.path).toBe("dst/b.png");
    expect(data.size).toBe(50);
  });

  it("move copies then deletes the source", async () => {
    sendResponses = [
      { CopyObjectResult: { ETag: '"m"' } },
      { ContentLength: 5, ETag: '"m"' },
      {}, // delete
    ];
    const driver = makeDriver();

    await driver.move("from.txt", "to.txt");

    expect(lastCommand("CopyObjectCommand")).toBeDefined();
    expect(lastCommand("DeleteObjectCommand")!.input.Key).toBe("from.txt");
  });
});

describe("S3Driver — list", () => {
  it("maps Contents and CommonPrefixes into file infos", async () => {
    sendResponses = [
      {
        Contents: [
          { Key: "dir/a.txt", Size: 10, ETag: '"a"', StorageClass: "STANDARD" },
          { Key: "dir/b.txt", Size: 20 },
        ],
        CommonPrefixes: [{ Prefix: "dir/sub/" }],
      },
    ];
    const driver = makeDriver();

    const files = await driver.list("dir");

    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({ path: "dir/a.txt", size: 10, isDirectory: false });
    expect(files[2]).toMatchObject({ path: "dir/sub/", isDirectory: true });
  });
});

describe("S3Driver — presigned URLs", () => {
  it("getPresignedUrl signs a GetObjectCommand", async () => {
    const driver = makeDriver();

    const url = await driver.getPresignedUrl("private/doc.pdf", { expiresIn: 120 });

    expect(url).toContain("private/doc.pdf");
    expect(url).toContain("expires=120");
    expect(lastCommand("presign:GetObjectCommand")).toBeDefined();
  });

  it("getPresignedUploadUrl signs a PutObjectCommand", async () => {
    const driver = makeDriver();

    await driver.getPresignedUploadUrl("uploads/x.pdf", { contentType: "application/pdf" });

    const command = lastCommand("presign:PutObjectCommand")!;

    expect(command.input.Key).toBe("uploads/x.pdf");
    expect(command.input.ContentType).toBe("application/pdf");
  });

  it("temporaryUrl delegates to a presigned GET", async () => {
    const driver = makeDriver();

    const url = await driver.temporaryUrl("f.txt", 300);

    expect(url).toContain("expires=300");
  });
});

describe("S3Driver — visibility", () => {
  it("setVisibility=private sends a private ACL", async () => {
    sendResponses = [{}];
    const driver = makeDriver();

    await driver.setVisibility("f.txt", "private");

    expect(lastCommand("PutObjectAclCommand")!.input.ACL).toBe("private");
  });

  it("getVisibility returns public when an AllUsers READ grant exists", async () => {
    sendResponses = [
      {
        Grants: [
          {
            Grantee: { URI: "http://acs.amazonaws.com/groups/global/AllUsers" },
            Permission: "READ",
          },
        ],
      },
    ];
    const driver = makeDriver();

    expect(await driver.getVisibility("f.txt")).toBe("public");
  });

  it("getVisibility returns private without a public grant", async () => {
    sendResponses = [{ Grants: [] }];
    const driver = makeDriver();

    expect(await driver.getVisibility("f.txt")).toBe("private");
  });
});

describe("S3Driver — url formatting", () => {
  it("builds the default amazonaws.com URL", () => {
    const driver = makeDriver();

    expect(driver.url("images/x.png")).toBe(
      "https://my-bucket.s3.us-east-1.amazonaws.com/images/x.png",
    );
  });

  it("uses a configured urlPrefix (e.g. CDN domain)", () => {
    const driver = makeDriver({ urlPrefix: "https://cdn.example.com" });

    expect(driver.url("images/x.png")).toBe(
      "https://my-bucket.s3.us-east-1.amazonaws.com/https://cdn.example.com/images/x.png",
    );
  });
});

describe("S3Driver — putStream (multipart)", () => {
  it("uploads via lib-storage Upload and re-reads metadata", async () => {
    // putStream: Upload.done() -> then metadata() HeadObject.
    sendResponses = [{ ContentLength: 8, ETag: '"stream-etag"', ContentType: "text/plain" }];
    const driver = makeDriver();
    const stream = Readable.from([Buffer.from("12345678")]);

    const data = await driver.putStream(stream, "big/file.txt");

    expect(data.size).toBe(8);
    expect(sentCommands.some((command) => command.name === "Upload")).toBe(true);
  });
});

describe("S3Driver — retry behavior", () => {
  it("retries a retryable 5xx error then succeeds", async () => {
    const retryable: any = new Error("ServerError");
    retryable.$metadata = { httpStatusCode: 503 };

    sendMock.mockRejectedValueOnce(retryable);
    sendResponses = [{ ETag: '"after-retry"' }];

    const driver = makeDriver();

    const data = await driver.put(Buffer.from("x"), "f.bin");

    expect(data.etag).toBe('"after-retry"');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-retryable 4xx error", async () => {
    const clientError: any = new Error("Forbidden");
    clientError.$metadata = { httpStatusCode: 403 };

    sendMock.mockRejectedValue(clientError);
    const driver = makeDriver();

    await expect(driver.put(Buffer.from("x"), "f.bin")).rejects.toThrow("Forbidden");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("S3Driver — accessors", () => {
  it("exposes bucket and region", () => {
    const driver = makeDriver();

    expect(driver.getBucket()).toBe("my-bucket");
    expect(driver.getRegion()).toBe("us-east-1");
  });
});
