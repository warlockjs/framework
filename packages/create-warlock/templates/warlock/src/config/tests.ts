// The framework boots once per Vitest worker and every test file starts from a reset state
// (the default since 5.38): the database is truncated, the fakes, the request context and the
// route table are restored. Each worker uses its own database, see src/config/database.ts.
//
// WARLOCK_TEST_LIFETIME=file boots the framework once per test file instead (slower, with
// isolated module state). A spec that changes global configuration the reset does not undo
// opts out for its file with `setupTest({ importModule, lifetime: "file" })`.
const workerLifetime = process.env.WARLOCK_TEST_LIFETIME !== "file";

const testsConfigurations = {
  lifetime: workerLifetime ? "worker" : "file",
  resetDatabase: workerLifetime,
  // WARLOCK_TEST_PROFILE=1 prints the boot phases and the slowest files of a run.
  profileSetup: process.env.WARLOCK_TEST_PROFILE === "1",

  // In tests, mail, queue, cache, storage, clock and ids are faked by default:
  // nothing is delivered, pushed to Redis or uploaded, and assertions such as
  // mailFake.assertSent(...) work (see @warlock.js/core/tests).
  //
  // Opt out of every fake, keeping the real drivers:
  // fakes: false,
  //
  // ...or of one, e.g. keep the configured cache driver:
  // fakes: { cache: false },
};

export default testsConfigurations;
