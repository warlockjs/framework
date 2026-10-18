# WR-008: secret store — OS keychain with fallback, prepared automatically (recommended for 5.33)

Date: 2026-10-19 · Package: new @warlock.js/secrets (or in core) · From: Bureau

**Today:** Bureau built its own keychain store on `@napi-rs/keyring` (Windows Credential Manager, macOS Keychain,
Linux Secret Service). It needed a manual "prepare secure key storage" step that the owner couldn't find on Windows.

**Request:**
- `secrets.get/set/remove/has(name)`, scoped per app instance.
- Backends: OS keychain first, then environment variables, then an owner-only file. The keychain library is an
  optional peer.
- Prepared lazily on first use, with no setup step or restart.
- Values are never logged; logger redaction is built in.
- A test backend is included.
