export { DEFAULT_REDACT_KEY_SET, DEFAULT_REDACT_KEYS, normalizeRedactKey } from "./default-keys";
export { applyRedact, mergeRedact, resolveRedactKeys } from "./redact";
export { escapeLogValue, type EscapeLogValueOptions } from "./escape-log-value";
export { MASK_EMAILS_MAX_LENGTH, maskEmail, maskEmailsInText } from "./mask-email";
export { registerLogSecret, maskRegisteredLogSecrets } from "./registered-secrets";
