import { describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";

class Plain extends Model {
  static table = "plain";
}

class Explicit extends Model {
  static table = "explicit";
  static strictMode = "allow" as const;
}

describe("B3: data-source defaults apply over base Model initialisers", () => {
  it("applies defaults when the subclass set nothing", () => {
    Plain.applyModelDefaults({ strictMode: "fail", deletedAtColumn: "deleted_at", autoGenerateId: false });

    expect(Plain.strictMode).toBe("fail");
    expect(Plain.deletedAtColumn).toBe("deleted_at");
    expect(Plain.autoGenerateId).toBe(false);
  });

  it("keeps a value the subclass set explicitly", () => {
    Explicit.applyModelDefaults({ strictMode: "fail" });

    expect(Explicit.strictMode).toBe("allow");
  });
});
