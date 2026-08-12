/**
 * Warlock.js Test Utilities
 *
 * Core testing infrastructure for Warlock.js v4
 */
export * from "./start-http-development-server";
export * from "./test-helpers";
export * from "./vitest-setup";

// `./test-server-port-channel` is deliberately NOT re-exported. It is the
// internal channel `startHttpTestServer` uses to hand the resolved port to the
// worker processes that later call `testGet` and friends — `publishTestServerPort`,
// `withdrawTestServerPort` and `TEST_SERVER_PORT_ENV_KEY` are plumbing, not API.
//
// It mattered enough to decide rather than leave: 4.13.0 gives these symbols a
// small, readable home at `@warlock.js/core/tests`, and an undocumented export
// on a named subpath reads as intentional API. Removing one after people find it
// is a breaking change; the cost of deciding was lowest before it shipped.
//
// Nothing outside `src/tests/` uses them, and the unit test that does reaches
// the module by path rather than through this barrel.
//
// ⚠ "Internal" here means the SYMBOLS, not the channel. The env var's NAME —
// `WARLOCK_TEST_SERVER_PORT` — is documented in `skills/test-http` and in
// `llms.txt`, so someone can set it by hand. That is a weaker contract than an
// export, but it is still a contract: renaming the variable is a user-visible
// change even though nothing exports it.
