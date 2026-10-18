export type SecretStoreErrorCode =
  | "INVALID_NAME"
  | "INVALID_VALUE"
  | "INVALID_NAMESPACE"
  | "READ_ONLY"
  | "KEY_REQUIRED"
  | "UNAVAILABLE"
  | "UNSAFE_FILE"
  | "CORRUPT_FILE";

/** Safe to log: never carries names, values, paths, or vendor error causes. */
export class SecretStoreError extends Error {
  public constructor(public readonly code: SecretStoreErrorCode) {
    super(
      {
        INVALID_NAME: "Secret names must be valid Unicode strings of 1 to 256 UTF-16 code units.",
        INVALID_VALUE: "Secret values must be strings.",
        INVALID_NAMESPACE: "A nonempty secret store namespace is required.",
        READ_ONLY: "This secret is supplied by a read-only environment variable.",
        KEY_REQUIRED: "File secrets require encryption.key: exactly 64 hexadecimal characters.",
        UNAVAILABLE: "The selected secret backend is unavailable. No unsafe write was attempted.",
        UNSAFE_FILE: "Secret storage must use an owned, private directory and regular files.",
        CORRUPT_FILE:
          "A secret file could not be authenticated. Check the app key and restore a backup.",
      }[code],
    );
    this.name = "SecretStoreError";
  }
}
