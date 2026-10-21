import fs from "node:fs/promises";
import path from "node:path";

/**
 * Write each shared translation table into the client `assets` directory under
 * its content-hashed name. Those names are served with the same immutable,
 * one-year cache headers as the bundle's own hashed files, which is safe
 * because a changed table has a changed name.
 */
export async function writeTranslationAssets(
  assetsDirectory: string,
  assets: readonly { readonly fileName: string; readonly body: string }[],
): Promise<void> {
  for (const asset of assets) {
    const file = path.join(assetsDirectory, asset.fileName);

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, asset.body, "utf8");
  }
}
