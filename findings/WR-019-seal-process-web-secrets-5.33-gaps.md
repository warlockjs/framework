# WR-019: Five small 5.33 gaps found during Bureau's final validation (target 5.34)

Date: 2026-10-19 · Packages: @warlock.js/seal, process, web, core 5.33.0 · From: Bureau final validation on `integrate/part-b`

Items 1–3 were reproduced against the installed 5.33.0 packages with a standalone script. Items 4–5 come from the
fix agent's work and are not reproduced on their own.

1. **Seal: `v.object()` accepts arrays.** `v.object({}).allowUnknown().validate(["x"])` returns
   `{ isValid: true, data: { "0": "x" } }`. A JSON body or a stored record that is an array passes as an object.
   Bureau's collaboration responses now refuse arrays by hand.
   - **Request:** `v.object()` refuses arrays (and other non-plain objects) by default.
2. **Seal: two-argument `v.record()` fails late.** `v.record(keyValidator, valueValidator)` is the common style in
   other libraries. In Seal it takes only a value validator, so `v.record(v.string(), v.number()).validate({ a: "x" })`
   throws `TypeError: Cannot read properties of undefined (reading 'configurations')` at validation time, not at
   definition. Bureau's connector schemas had this, and every stored connection object was refused at runtime.
   - **Request:** throw a clear error when the schema is defined. Optionally, accept a key validator as an optional
     first argument.
3. **@warlock.js/process: `supervisor(null)` crashes.** It throws
   `TypeError: Cannot read properties of null (reading 'owner')`.
   - **Request:** a configuration error naming the missing option.
   - Also, on darwin and win32 the guardian passes `WARLOCK_PROCESS_TOKEN` through to the child. On Linux that is
     intended, because ownership is read from `/proc/<pid>/environ`. Please check that the non-Linux paths should
     forward it.
4. **@warlock.js/web refresh can't tell user refreshes from background ones.** A refresh the user triggers and a
   background revalidation look the same, so app draft guards that skip background refreshes also swallow the user's.
   The sealed `shared` payload also goes stale after a client-side shell switch.
   - **Request:** a `reason`/`source` on the refresh event, plus re-sealing `shared` on shell navigation.
5. **Core `secrets`: no in-memory backend for production-build test runs.** `secretsFake` covers vitest, but browser
   flows run against the built app, where only the OS keychain or file backends exist. Bureau loads a keychain fixture
   through a Node resolve hook.
   - **Request:** a configurable `memory` backend, for example `SECRETS_DRIVER=memory`, refused when
     `NODE_ENV=production` unless explicitly allowed.
