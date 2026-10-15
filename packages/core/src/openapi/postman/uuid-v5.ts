import { createHash } from "node:crypto";

/**
 * Namespace of every id the Postman converter derives. Fixed forever: changing it would
 * change the `_postman_id` of every collection already imported.
 */
export const POSTMAN_ID_NAMESPACE = "8f1c2b64-3d7a-4c59-9a0e-5b6d1e47c2a3";

/**
 * RFC 4122 version 5 (SHA-1, name based) UUID, so the same name always yields the same id.
 */
export function uuidV5(name: string, namespace: string = POSTMAN_ID_NAMESPACE): string {
  const digest = createHash("sha1")
    .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
    .update(name, "utf8")
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

  const hex = bytes.toString("hex");

  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}
