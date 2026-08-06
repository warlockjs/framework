import { describe, expect, it } from "vitest";
import { DatabaseDirtyTracker } from "../../src/database-dirty-tracker";

/**
 * Regression cover for the merge bug reported from TeamsUp on 2026-08-06
 * (`plans/2026-08-06-cascade-dirty-tracker-date-merge-bug.md`).
 *
 * `mergeIntoRaw` treated anything with `typeof value === "object"` as a
 * mergeable container. A `Date` passes that test and has **no own enumerable
 * properties**, so merging a `Date` over a column that already held a `Date`
 * recursed into it, copied nothing, and left the old value in the snapshot.
 * The column never went dirty, and `save()` returned
 * `{ success: true, modifiedCount: 0 }` without issuing an UPDATE.
 *
 * The asymmetry is what made it look like a test artifact: writing into an
 * EMPTY column worked (the guard's `target[key]` was falsy), only an overwrite
 * failed. Every case below therefore starts from an already-populated column.
 */

const EARLIER = new Date("2026-08-06T10:00:00.000Z");
const LATER = new Date("2026-08-06T15:00:00.000Z");

describe("DatabaseDirtyTracker — merging non-plain object values", () => {
  describe("Date over Date", () => {
    it("marks the column dirty when a Date replaces a different Date", () => {
      const tracker = new DatabaseDirtyTracker({ id: 1, lastOutboundAt: EARLIER });

      tracker.mergeChanges({ lastOutboundAt: LATER });

      expect(tracker.getDirtyColumns()).toEqual(["lastOutboundAt"]);
      expect(tracker.hasChanges()).toBe(true);
    });

    it("carries the NEW date value, not the old one", () => {
      const tracker = new DatabaseDirtyTracker({ id: 1, lastOutboundAt: EARLIER });

      tracker.mergeChanges({ lastOutboundAt: LATER });

      const { lastOutboundAt } = tracker.getDirtyColumnsWithValues();

      expect(new Date(lastOutboundAt.newValue as Date).getTime()).toBe(LATER.getTime());
      expect(new Date(lastOutboundAt.oldValue as Date).getTime()).toBe(EARLIER.getTime());
    });

    it("still works for the first write into an empty column", () => {
      // This path always worked — kept so a future change can't fix the
      // overwrite case by breaking the one that was fine.
      const tracker = new DatabaseDirtyTracker({ id: 1, lastOutboundAt: null });

      tracker.mergeChanges({ lastOutboundAt: LATER });

      expect(tracker.getDirtyColumns()).toEqual(["lastOutboundAt"]);
    });

    it("reports no change when the same instant is written again", () => {
      const tracker = new DatabaseDirtyTracker({ id: 1, lastOutboundAt: EARLIER });

      tracker.mergeChanges({ lastOutboundAt: new Date(EARLIER.getTime()) });

      expect(tracker.hasChanges()).toBe(false);
    });
  });

  describe("other class instances with no own enumerable properties", () => {
    it("replaces a Map rather than recursing into it", () => {
      const tracker = new DatabaseDirtyTracker({ id: 1, tags: new Map([["a", 1]]) });

      tracker.mergeChanges({ tags: new Map([["b", 2]]) });

      expect(tracker.hasChanges()).toBe(true);
    });

    it("replaces a Set rather than recursing into it", () => {
      const tracker = new DatabaseDirtyTracker({ id: 1, seen: new Set([1]) });

      tracker.mergeChanges({ seen: new Set([1, 2]) });

      expect(tracker.hasChanges()).toBe(true);
    });

    it("replaces a RegExp rather than recursing into it", () => {
      const tracker = new DatabaseDirtyTracker({ id: 1, pattern: /^a$/ });

      tracker.mergeChanges({ pattern: /^b$/ });

      expect(tracker.hasChanges()).toBe(true);
    });
  });

  describe("plain objects still deep-merge", () => {
    it("changes only the touched key, leaving siblings untouched", () => {
      const tracker = new DatabaseDirtyTracker({
        id: 1,
        profile: { age: 25, city: "Cairo" },
      });

      tracker.mergeChanges({ profile: { age: 26 } });

      // The whole point of the recursion: `city` is neither changed nor
      // reported. A replace-instead-of-merge regression would surface it here.
      expect(tracker.getDirtyColumns()).toEqual(["profile.age"]);
      expect(tracker.getDirtyColumnsWithValues()["profile.age"].newValue).toBe(26);
      expect(tracker.isDirty("profile.city")).toBe(false);
    });

    it("replaces an array instead of merging it", () => {
      const tracker = new DatabaseDirtyTracker({ id: 1, roles: ["admin", "editor"] });

      tracker.mergeChanges({ roles: ["viewer"] });

      expect(tracker.hasChanges()).toBe(true);
    });

    it("moves a Date nested inside a plain object without disturbing siblings", () => {
      const tracker = new DatabaseDirtyTracker({
        id: 1,
        meta: { seenAt: EARLIER, source: "web" },
      });

      tracker.mergeChanges({ meta: { seenAt: LATER } });

      // The nested Date is the one that moved — and `source` is untouched,
      // proving the plain-object parent still deep-merged.
      expect(tracker.getDirtyColumns()).toEqual(["meta.seenAt"]);
      expect(tracker.isDirty("meta.source")).toBe(false);
      expect(
        new Date(tracker.getDirtyColumnsWithValues()["meta.seenAt"].newValue as Date).getTime(),
      ).toBe(LATER.getTime());
    });
  });
});
