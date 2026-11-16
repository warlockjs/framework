import { describe, expect, it } from "vitest";
import { codeFile, facts, feature, written } from "../../tests/support/written-model";
import { resolveOwnership } from "./index";

describe("resolveOwnership", () => {
  it("gives a file to the feature whose folder holds it", () => {
    const ownership = resolveOwnership(
      written({ features: [feature({ id: "catalog", folders: ["src/app/catalog/"] })] }),
      facts([codeFile("src/app/catalog/a.service.ts"), codeFile("src/app/orders/b.service.ts")]),
    );

    expect(ownership.files["src/app/catalog/a.service.ts"]).toEqual({
      file: "src/app/catalog/a.service.ts",
      owner: "catalog",
      via: "folder",
      folder: "src/app/catalog",
      conflicts: [],
      borrowedBy: [],
    });
    expect(ownership.files["src/app/orders/b.service.ts"]?.owner).toBeNull();
    expect(ownership.features.catalog).toEqual({ own: ["src/app/catalog/a.service.ts"], borrowed: [] });
  });

  it("prefers the deepest folder", () => {
    const ownership = resolveOwnership(
      written({
        features: [
          feature({ id: "web", folders: ["src/web"] }),
          feature({ id: "catalog", folders: ["src/web/$sites/client/products"] }),
        ],
      }),
      facts([codeFile("src/web/$sites/client/products/show.page.tsx"), codeFile("src/web/$sites/client/home.page.tsx")]),
    );

    expect(ownership.files["src/web/$sites/client/products/show.page.tsx"]?.owner).toBe("catalog");
    expect(ownership.files["src/web/$sites/client/home.page.tsx"]?.owner).toBe("web");
  });

  it("lets a @feature tag win over the folders", () => {
    const ownership = resolveOwnership(
      written({
        features: [feature({ id: "auth", folders: ["src/app/auth"] }), feature({ id: "shared", folders: ["src/app/shared"] })],
      }),
      facts([codeFile("src/app/shared/jobs/delete.job.ts", [], { tags: { feature: ["auth"] } })]),
    );

    expect(ownership.files["src/app/shared/jobs/delete.job.ts"]).toMatchObject({ owner: "auth", via: "tag", folder: null });
    expect(ownership.features.auth?.own).toEqual(["src/app/shared/jobs/delete.job.ts"]);
    expect(ownership.features.shared?.own).toEqual([]);
  });

  it("reports two different tags as a conflict with no owner", () => {
    const ownership = resolveOwnership(
      written({ features: [feature({ id: "auth" }), feature({ id: "orders" })] }),
      facts([codeFile("src/app/shared/x.ts", [], { tags: { feature: ["orders", "auth"] } })]),
    );

    expect(ownership.files["src/app/shared/x.ts"]).toMatchObject({
      owner: null,
      via: null,
      conflicts: [
        { feature: "auth", via: "tag" },
        { feature: "orders", via: "tag" },
      ],
    });
  });

  it("reports the same folder listed by two features as a conflict", () => {
    const ownership = resolveOwnership(
      written({
        features: [feature({ id: "a", folders: ["src/app/shop"] }), feature({ id: "b", folders: ["src/app/shop"] })],
      }),
      facts([codeFile("src/app/shop/x.ts")]),
    );

    expect(ownership.files["src/app/shop/x.ts"]).toMatchObject({
      owner: null,
      conflicts: [
        { feature: "a", via: "folder" },
        { feature: "b", via: "folder" },
      ],
    });
    expect(ownership.features.a?.own).toEqual([]);
  });

  it("ignores a tag that names no feature, so the folder decides", () => {
    const ownership = resolveOwnership(
      written({ features: [feature({ id: "catalog", folders: ["src/app/catalog"] })] }),
      facts([codeFile("src/app/catalog/x.ts", [], { tags: { feature: ["nope"] } })]),
    );

    expect(ownership.files["src/app/catalog/x.ts"]).toMatchObject({ owner: "catalog", via: "folder" });
  });

  it("records borrowers from direct imports of own files, never from specs", () => {
    const ownership = resolveOwnership(
      written({
        features: [feature({ id: "catalog", folders: ["src/app/catalog"] }), feature({ id: "orders", folders: ["src/app/orders"] })],
      }),
      facts([
        codeFile("src/app/catalog/repo.ts", ["src/app/shared/money.ts"]),
        codeFile("src/app/orders/service.ts", ["src/app/catalog/repo.ts", "src/app/orders/model.ts"]),
        codeFile("src/app/orders/model.ts"),
        codeFile("src/app/orders/tests/x.test.ts", ["src/app/shared/money.ts"], { type: "spec" }),
        codeFile("src/app/shared/money.ts"),
      ]),
    );

    expect(ownership.files["src/app/catalog/repo.ts"]?.borrowedBy).toEqual(["orders"]);
    expect(ownership.files["src/app/shared/money.ts"]?.borrowedBy).toEqual(["catalog"]);
    expect(ownership.features.orders).toEqual({
      own: ["src/app/orders/model.ts", "src/app/orders/service.ts"],
      borrowed: ["src/app/catalog/repo.ts"],
    });
    expect(ownership.files["src/app/orders/tests/x.test.ts"]?.owner).toBe("orders");
  });

  it("gives every file no owner when nothing is written", () => {
    const ownership = resolveOwnership(written(), facts([codeFile("src/app/x.ts")]));

    expect(ownership.files["src/app/x.ts"]?.owner).toBeNull();
    expect(ownership.features).toEqual({});
  });
});
