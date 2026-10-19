import { mkdir, open } from "node:fs/promises";
import path from "node:path";

/** `file` flushes file bytes; `full` also flushes directory entries (POSIX). */
export type WriteDurability = "file" | "full";

export function assertDurability(durability: WriteDurability): void {
  if (durability === "full" && process.platform === "win32") {
    throw new Error(
      'Full directory durability is unavailable on Windows; explicitly select "file"',
    );
  }
}

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function ensureDurableDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  // Include existing ancestors: they may have been created by a previous
  // interrupted attempt whose directory fsync failed. Visibility is not durability.
  let current = path.resolve(directory);
  for (;;) {
    await syncDirectory(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
