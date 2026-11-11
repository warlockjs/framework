import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { uploadLimitsCheck } from "./upload-limits.check";

const bootContext = {} as DoctorBootContext;
const MB = 1024 * 1024;

async function run() {
  return await uploadLimitsCheck.run(bootContext);
}

afterEach(() => {
  setConfig("http", undefined as unknown as never);
});

describe("doctor upload-limits check", () => {
  it("is ok when the caps are within bounds", async () => {
    setConfig("http", { fileUploadLimit: 10 * MB, multipart: { maxTotalSize: 25 * MB } } as never);

    const result = await run();

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("10 MB per file and 25 MB per request");
  });

  it("is ok when a huge fileUploadLimit is held to the default total cap", async () => {
    setConfig("http", { fileUploadLimit: 12 * 1024 * MB } as never);

    const result = await run();

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("held to the per-request cap");
  });

  it("warns when the total multipart cap is far above 100 MB, naming the setting", async () => {
    setConfig("http", { multipart: { maxTotalSize: 2 * 1024 * MB } } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("http.multipart.maxTotalSize is 2 GB");
    expect(result?.detail).not.toContain("http.fileUploadLimit");
  });

  it("names both settings when the per-file limit is also too large", async () => {
    setConfig("http", {
      fileUploadLimit: 12 * 1024 * MB,
      multipart: { maxTotalSize: 12 * 1024 * MB },
    } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("http.fileUploadLimit is 12 GB");
  });

  it("is silent when neither setting is present (the defaults apply)", async () => {
    setConfig("http", { port: 3000 } as never);

    expect(await run()).toBeUndefined();
  });

  it("is silent when there is no http config", async () => {
    expect(await run()).toBeUndefined();
  });
});
