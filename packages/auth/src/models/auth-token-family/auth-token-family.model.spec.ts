import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTokenFamily } from "./auth-token-family.model";

function buildFamily(revokedAt?: Date): AuthTokenFamily {
  const family = Object.create(AuthTokenFamily.prototype) as AuthTokenFamily;

  Object.defineProperty(family, "get", {
    value: (key: string) => (key === "revoked_at" ? revokedAt : undefined),
  });

  return family;
}

describe("AuthTokenFamily", () => {
  afterEach(() => vi.restoreAllMocks());

  it("treats a stamped family as revoked", () => {
    expect(buildFamily(new Date()).isRevoked).toBe(true);
    expect(buildFamily().isRevoked).toBe(false);
  });

  it("uses a native upsert to bootstrap an existing family without a duplicate insert", async () => {
    const atomic = vi.spyOn(AuthTokenFamily, "atomic").mockResolvedValue(1);
    const family = Object.create(AuthTokenFamily.prototype) as AuthTokenFamily;
    Object.defineProperty(family, "get", {
      value: (key: string) => ({ user_id: 1, user_type: "user" })[key],
    });
    vi.spyOn(AuthTokenFamily, "findByFamilyId")
      .mockResolvedValueOnce(null)
      .mockResolvedValue(family);

    await expect(
      AuthTokenFamily.ensure({ id: 1, userType: "user" } as never, "legacy-family"),
    ).resolves.toBe(family);

    expect(atomic).toHaveBeenCalledWith(
      { family_id: "legacy-family" },
      { $setOnInsert: { user_id: 1, user_type: "user", revision: 0 } },
      { upsert: true },
    );
  });

  it("returns the existing family when ensured twice without another upsert", async () => {
    const atomic = vi.spyOn(AuthTokenFamily, "atomic").mockResolvedValue(1);
    const family = Object.create(AuthTokenFamily.prototype) as AuthTokenFamily;
    Object.defineProperty(family, "get", {
      value: (key: string) => ({ user_id: 1, user_type: "user" })[key],
    });
    vi.spyOn(AuthTokenFamily, "findByFamilyId")
      .mockResolvedValueOnce(null)
      .mockResolvedValue(family);

    await expect(
      AuthTokenFamily.ensure({ id: 1, userType: "user" } as never, "family"),
    ).resolves.toBe(family);
    await expect(
      AuthTokenFamily.ensure({ id: 1, userType: "user" } as never, "family"),
    ).resolves.toBe(family);

    expect(atomic).toHaveBeenCalledTimes(1);
  });

  it("rejects a family identifier already owned by a different user", async () => {
    vi.spyOn(AuthTokenFamily, "atomic").mockResolvedValue(0);
    const family = Object.create(AuthTokenFamily.prototype) as AuthTokenFamily;
    Object.defineProperty(family, "get", {
      value: (key: string) => ({ user_id: 2, user_type: "user" })[key],
    });
    vi.spyOn(AuthTokenFamily, "findByFamilyId").mockResolvedValue(family);

    await expect(
      AuthTokenFamily.ensure({ id: 1, userType: "user" } as never, "family"),
    ).rejects.toThrow("Token family belongs to a different user");
  });
});

describe("AuthTokenFamily bulk helpers", () => {
  afterEach(() => vi.restoreAllMocks());

  const row = (familyId: string, userId = 1) =>
    ({
      get: (key: string) => ({ family_id: familyId, user_id: userId, user_type: "user" })[key],
    }) as never;

  it("ensureMany inserts only the missing lineages, in one call", async () => {
    vi.spyOn(AuthTokenFamily, "query").mockReturnValue({
      whereIn: () => ({ get: async () => [row("a")] }),
    } as never);
    const createMany = vi.spyOn(AuthTokenFamily, "createMany").mockResolvedValue([] as never);

    await AuthTokenFamily.ensureMany({ id: 1, userType: "user" } as never, ["a", "b", "c"]);

    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledWith([
      { family_id: "b", user_id: 1, user_type: "user", revision: 0 },
      { family_id: "c", user_id: 1, user_type: "user", revision: 0 },
    ]);
  });

  it("ensureMany refuses a lineage owned by another user", async () => {
    vi.spyOn(AuthTokenFamily, "query").mockReturnValue({
      whereIn: () => ({ get: async () => [row("a", 2)] }),
    } as never);

    await expect(
      AuthTokenFamily.ensureMany({ id: 1, userType: "user" } as never, ["a"]),
    ).rejects.toThrow("Token family belongs to a different user");
  });

  it("ensureMany falls back to ensure() per lineage when the bulk insert races", async () => {
    vi.spyOn(AuthTokenFamily, "query").mockReturnValue({
      whereIn: () => ({ get: async () => [] }),
    } as never);
    vi.spyOn(AuthTokenFamily, "createMany").mockRejectedValue(new Error("duplicate key"));
    const ensure = vi.spyOn(AuthTokenFamily, "ensure").mockResolvedValue({} as never);

    await AuthTokenFamily.ensureMany({ id: 1, userType: "user" } as never, ["a", "b"]);

    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it("revokeAllFor advances the revision and stamps the marker in one update", async () => {
    const atomic = vi.spyOn(AuthTokenFamily, "atomic").mockResolvedValue(2);

    await expect(AuthTokenFamily.revokeAllFor({ id: 1, userType: "user" } as never)).resolves.toBe(
      2,
    );

    expect(atomic).toHaveBeenCalledOnce();
    expect(atomic).toHaveBeenCalledWith(
      { user_id: 1, user_type: "user", revoked_at: null },
      { $inc: { revision: 1 }, $set: { revoked_at: expect.any(Date) } },
    );
  });
});
