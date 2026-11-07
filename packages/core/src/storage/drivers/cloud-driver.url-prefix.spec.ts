import { afterEach, describe, expect, it, vi } from "vitest";
import { storageDriverContext } from "../context/storage-driver-context";
import { DOSpacesDriver } from "./do-spaces-driver";
import { R2Driver } from "./r2-driver";
import { S3Driver } from "./s3-driver";

const base = {
  bucket: "b",
  region: "us-east-1",
  accessKeyId: "k",
  secretAccessKey: "s",
};

const r2 = (extra: Record<string, unknown>) =>
  new R2Driver({ ...base, accountId: "acc", ...extra } as never);
const s3 = (extra: Record<string, unknown>) => new S3Driver({ ...base, ...extra });
const spaces = (extra: Record<string, unknown>) => new DOSpacesDriver({ ...base, ...extra });

afterEach(() => vi.restoreAllMocks());

describe("cloud driver url() and the disk prefix", () => {
  it("applies the prefix once with publicDomain", () => {
    const driver = r2({ publicDomain: "https://cdn.test/", prefix: "acme" });

    expect(driver.url("photos/x.jpg")).toBe("https://cdn.test/acme/photos/x.jpg");
    expect(driver.url("acme/photos/x.jpg")).toBe("https://cdn.test/acme/photos/x.jpg");
  });

  it("applies the prefix to the R2 default host", () => {
    expect(r2({ prefix: "acme" }).url("x.jpg")).toBe("https://pub-acc.r2.dev/acme/x.jpg");
    expect(r2({}).url("x.jpg")).toBe("https://pub-acc.r2.dev/x.jpg");
  });

  it("adds the prefix after a urlPrefix that does not end with it", () => {
    expect(r2({ urlPrefix: "https://cdn.test", prefix: "acme" }).url("x.jpg")).toBe(
      "https://cdn.test/acme/x.jpg",
    );
  });

  it("leaves a urlPrefix that already ends with the prefix unchanged", () => {
    const urlPrefix = "https://cdn.test/acme/";

    expect(r2({ urlPrefix, prefix: "acme" }).url("x.jpg")).toBe("https://cdn.test/acme/x.jpg");
    expect(s3({ urlPrefix, prefix: "acme" }).url("x.jpg")).toBe("https://cdn.test/acme/x.jpg");
    expect(spaces({ urlPrefix, prefix: "acme" }).url("x.jpg")).toBe("https://cdn.test/acme/x.jpg");
    // put() results pass the already-prefixed key.
    expect(r2({ urlPrefix, prefix: "acme" }).url("acme/x.jpg")).toBe("https://cdn.test/acme/x.jpg");
  });

  it("covers S3 and DigitalOcean Spaces default hosts and urlPrefix", () => {
    expect(s3({ prefix: "acme" }).url("x.jpg")).toBe(
      "https://b.s3.us-east-1.amazonaws.com/acme/x.jpg",
    );
    expect(s3({ prefix: "acme", urlPrefix: "https://cdn.test" }).url("acme/x.jpg")).toBe(
      "https://cdn.test/acme/x.jpg",
    );
    expect(spaces({ prefix: "acme" }).url("x.jpg")).toBe(
      "https://b.us-east-1.cdn.digitaloceanspaces.com/acme/x.jpg",
    );
    expect(spaces({ prefix: "acme", urlPrefix: "https://cdn.test" }).url("x.jpg")).toBe(
      "https://cdn.test/acme/x.jpg",
    );
  });

  it("lets the context prefix win over the disk prefix", () => {
    vi.spyOn(storageDriverContext, "getPrefix").mockReturnValue("tenant-1");

    expect(r2({ publicDomain: "https://cdn.test", prefix: "acme" }).url("x.jpg")).toBe(
      "https://cdn.test/tenant-1/x.jpg",
    );
  });
});
