import { describe, expect, it, vi } from "vitest";
import { S3Driver } from "./s3-driver";

const base = { bucket: "b", region: "us-east-1", accessKeyId: "k", secretAccessKey: "s" };

function makeDriver(send: (command: any) => Promise<any>, retry = { maxRetries: 0, initialDelayMs: 0 }) {
  const driver = new S3Driver({ ...base, retry });
  (driver as unknown as { client: unknown }).client = { send };

  return driver;
}

describe("CloudDriver retry and copy", () => {
  it("maxRetries: 0 still makes one attempt and rethrows the original error", async () => {
    const original = Object.assign(new Error("boom"), { name: "AccessDenied" });
    const send = vi.fn().mockRejectedValue(original);

    await expect(makeDriver(send).get("a.txt")).rejects.toBe(original);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("URL-encodes CopySource and keeps a public ACL on copy", async () => {
    const send = vi.fn().mockImplementation(async (command: any) => {
      if (command.constructor.name === "GetObjectAclCommand") {
        return { Grants: [{ Grantee: { URI: "http://acs.amazonaws.com/groups/global/AllUsers" }, Permission: "READ" }] };
      }

      return { ContentLength: 1, ETag: '"e"' };
    });

    await makeDriver(send).copy("my file+#.txt", "b.txt");

    const copy = send.mock.calls.map((call) => call[0]).find((c) => c.constructor.name === "CopyObjectCommand");
    expect(copy.input.CopySource).toBe("b/my%20file%2B%23.txt");
    expect(copy.input.ACL).toBe("public-read");
  });
});
