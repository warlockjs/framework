import { describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";
import type { RequestUser } from "../../../src/http/types";

/**
 * `request.user` (design/core-asks-v5.md ask #2) is declared on core's
 * `Request` with an empty, augmentable `RequestUser` interface — apps narrow
 * it via module augmentation instead of the v4 `GuardedRequest` intersection
 * type (`create-warlock/.../guarded.request.ts` —
 * `Request<T> & { user: User }`, hand-declared per app).
 *
 * This is the POSITIVE TWIN named in canon eed20184 / the request-index-
 * signature-removal ruling: a property declared via module augmentation
 * MUST compile. Its counterpart — `request.notAThing` must FAIL to compile —
 * is a release-gate negative test that only makes sense once `request.ts:101`
 * (`[key: string]: any`) is removed in a later slice (step (c) of the
 * sequencing); that index signature is still present today, by design of
 * this task, so the negative test does not belong here yet.
 *
 * `RequestUser` is a single GLOBAL ambient interface — this workspace's
 * shared `tsconfig.typecheck.json` reaches `@warlock.js/access` too (its
 * connector is dynamically imported from
 * `core/src/connectors/access-connector.ts`), and
 * `access/src/middleware/gate.middleware.ts` augments the very same
 * `RequestUser` with `extends Auth<ModelSchema>` (eed20184 step (b) —
 * `implementation/2026-08-20-A2b-user-sweep.md`). In THIS combined
 * type-check program, `RequestUser` is therefore the merge of both: this
 * test's `{ id, email }` AND `Auth<ModelSchema>`'s 70+ members. `Model`
 * (`@warlock.js/cascade`) has private fields, so it's nominally typed — no
 * object literal can ever satisfy it, real `Auth` instance or not — hence
 * the `as unknown as RequestUser` cast below: it exists to route around a
 * program-composition artifact of this shared config, not to weaken the
 * assertion. A real deployed app compiles against exactly ONE `RequestUser`
 * augmentation (its own), never both of these at once.
 */
declare module "@warlock.js/core" {
  interface RequestUser {
    id: string;
    email: string;
  }
}

describe("Request — user (module augmentation)", () => {
  it("accepts an app-declared RequestUser shape and reads it back", () => {
    const request = new Request();

    request.user = { id: "u_1", email: "sam@example.com" } as unknown as RequestUser;

    expect(request.user.id).toBe("u_1");
    expect(request.user.email).toBe("sam@example.com");
  });

  it("starts undefined on a fresh request", () => {
    const request = new Request();

    expect(request.user).toBeUndefined();
  });

  /*
    REMOVED 2026-08-24 — there was a third case here asserting
    `request.clearCurrentUser()` resets `user` to undefined.

    @Hasan removed `clearCurrentUser` deliberately: the `Request` class carries
    no BEHAVIOUR about `user`. `user` is a property an app's auth middleware
    writes and the app's own augmentation types; clearing it is the caller's
    business, not a method the framework owes them. The test outlived the API,
    which is the ordinary way a red-first test goes stale — it was asserting a
    shape we chose not to build.

    Deleted rather than skipped: a skipped test is a claim nobody checks.
  */
});
