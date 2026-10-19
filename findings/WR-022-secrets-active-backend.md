# WR-022: expose the active core secrets backend

Date: 2026-10-19 · Package: @warlock.js/core 5.34.0 · From: Bureau U6

Bureau uses core secrets and retains exact-entry legacy keychain read-through/removal. With the new memory driver it can suppress legacy imports using resolved secrets.driver. Under auto, configuration cannot reveal whether core selected the OS keychain or its encrypted-file fallback: selection and the memoized keyring probe are private. Probing independently would duplicate native imports and could disagree with core.

Request: a public asynchronous `secrets.backend()` (and equivalent on SecretStore) returning `"keychain" | "file" | "memory"` for the active store, without credential material. It should respect resolved configuration, reuse native selection rather than duplicate its probe, and define how environment overrides and injected test backends are reported. An equivalent typed read-only backend-info API would also work.

Until available, Bureau skips legacy access for memory and keeps its existing soft fallback when auto cannot reach an OS password store. It cannot promise zero legacy imports under encrypted-file fallback. No framework source changed and no checks executed for this finding.
