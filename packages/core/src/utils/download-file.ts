import { http } from "@mongez/http";
import crypto from "crypto";
import { writeFile } from "fs/promises";
import path from "path";

export async function downloadFileFromUrl(
  fileUrl: string,
  outputLocationPath: string,
  fileName?: string,
): Promise<void> {
  const fileExtension = (fileName || fileUrl).split(".").pop();
  fileName ??= crypto.randomBytes(16).toString("hex");
  const filePath = path.join(outputLocationPath, `${fileName}.${fileExtension}`);

  const { data, error } = await http.get<ArrayBuffer>(fileUrl, {
    responseType: "arrayBuffer",
  });

  if (error || !data) {
    throw new Error(`Failed to download file from "${fileUrl}": ${error?.message ?? "Unknown error"}`);
  }

  await writeFile(filePath, Buffer.from(data));
}
