const testsConfigurations = {
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
