import fs from "node:fs/promises";

/**
 * Read at most the first `length` bytes of a file
 */
export async function readFileHead(absolutePath: string, length: number): Promise<Buffer> {
  const handle = await fs.open(absolutePath, "r");

  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);

    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
