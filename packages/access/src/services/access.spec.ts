import { beforeEach, describe, expect, it, vi } from "vitest";

const check = vi.fn();
const rolesFor = vi.fn();
const flush = vi.fn();

vi.mock("./engine", () => ({
  check: (...args: unknown[]) => check(...args),
  rolesFor: (...args: unknown[]) => rolesFor(...args),
  flush: (...args: unknown[]) => flush(...args),
}));

vi.mock("@warlock.js/core", () => ({
  t: (key: string) => key,
  ForbiddenError: class ForbiddenError extends Error {
    public constructor(
      message: string,
      public payload?: unknown,
    ) {
      super(message);
    }
  },
}));

import { ForbiddenError } from "@warlock.js/core";
import { AccessErrorCodes } from "../utils/access-error-codes";
import {
  authorize,
  authorizeAll,
  authorizeAny,
  can,
  canAll,
  canAny,
  cannot,
  hasAllRoles,
  hasAnyRole,
  hasRole,
} from "./access";

const user = { id: 1, userType: "user" } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("can / cannot", () => {
  it("can delegates to check", async () => {
    check.mockResolvedValue(true);

    expect(await can(user, "orders.update")).toBe(true);
    expect(check).toHaveBeenCalledWith(user, "orders.update", undefined);
  });

  it("cannot is the inverse of can", async () => {
    check.mockResolvedValue(false);

    expect(await cannot(user, "orders.update")).toBe(true);
  });
});

describe("canAll", () => {
  it("is true only when every permission passes", async () => {
    check.mockResolvedValue(true);

    expect(await canAll(user, ["a", "b"])).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("short-circuits on the first miss", async () => {
    check.mockResolvedValueOnce(false);

    expect(await canAll(user, ["a", "b"])).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("canAny", () => {
  it("is true when any passes, short-circuiting", async () => {
    check.mockResolvedValueOnce(true);

    expect(await canAny(user, ["a", "b"])).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("is false when none pass", async () => {
    check.mockResolvedValue(false);

    expect(await canAny(user, ["a", "b"])).toBe(false);
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("authorize variants", () => {
  it("authorize throws ForbiddenError carrying the wire code on deny", async () => {
    check.mockResolvedValue(false);

    await expect(authorize(user, "orders.update")).rejects.toMatchObject({
      payload: { errorCode: AccessErrorCodes.Forbidden },
    });
  });

  it("authorize resolves when allowed", async () => {
    check.mockResolvedValue(true);

    await expect(authorize(user, "orders.update")).resolves.toBeUndefined();
  });

  it("authorizeAll throws when one permission is missing", async () => {
    check.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(authorizeAll(user, ["a", "b"])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("authorizeAny throws when none pass", async () => {
    check.mockResolvedValue(false);

    await expect(authorizeAny(user, ["a", "b"])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("authorizeAll resolves when every permission passes", async () => {
    check.mockResolvedValue(true);

    await expect(authorizeAll(user, ["a", "b"])).resolves.toBeUndefined();
  });

  it("authorizeAny resolves when at least one permission passes", async () => {
    check.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(authorizeAny(user, ["a", "b"])).resolves.toBeUndefined();
  });
});

describe("role checks", () => {
  beforeEach(() => {
    rolesFor.mockResolvedValue(["editor", "viewer"]);
  });

  it("hasRole reflects membership", async () => {
    expect(await hasRole(user, "editor")).toBe(true);
    expect(await hasRole(user, "admin")).toBe(false);
  });

  it("hasAnyRole", async () => {
    expect(await hasAnyRole(user, ["admin", "editor"])).toBe(true);
    expect(await hasAnyRole(user, ["admin"])).toBe(false);
  });

  it("hasAllRoles", async () => {
    expect(await hasAllRoles(user, ["editor", "viewer"])).toBe(true);
    expect(await hasAllRoles(user, ["editor", "admin"])).toBe(false);
  });
});
