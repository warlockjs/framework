import { beforeEach, describe, expect, it, vi } from "vitest";

const can = vi.fn();
const canAll = vi.fn();
const canAny = vi.fn();

vi.mock("../services/access", () => ({
  can: (...args: unknown[]) => can(...args),
  canAll: (...args: unknown[]) => canAll(...args),
  canAny: (...args: unknown[]) => canAny(...args),
}));

vi.mock("@warlock.js/core", () => ({
  t: (key: string) => key,
}));

import { requireAll, requireAny, requirePermission } from "./require-permission.middleware";

function context(user?: unknown) {
  const forbidden = vi.fn();

  return {
    request: { user } as never,
    response: { forbidden } as never,
    forbidden,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requirePermission", () => {
  it("passes through when the user holds the permission", async () => {
    can.mockResolvedValue(true);
    const { request, response, forbidden } = context({ id: 1 });

    await requirePermission("orders.create")(request, response);

    expect(forbidden).not.toHaveBeenCalled();
  });

  it("forbids when the user lacks the permission", async () => {
    can.mockResolvedValue(false);
    const { request, response, forbidden } = context({ id: 1 });

    await requirePermission("orders.create")(request, response);

    expect(forbidden).toHaveBeenCalled();
  });

  it("forbids (without a permission check) when there is no authenticated user", async () => {
    const { request, response, forbidden } = context(undefined);

    await requirePermission("orders.create")(request, response);

    expect(forbidden).toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
  });
});

describe("requireAny / requireAll", () => {
  it("any: passes when canAny is true", async () => {
    canAny.mockResolvedValue(true);
    const { request, response, forbidden } = context({ id: 1 });

    await requireAny(["a", "b"])(request, response);

    expect(forbidden).not.toHaveBeenCalled();
  });

  it("all: forbids when canAll is false", async () => {
    canAll.mockResolvedValue(false);
    const { request, response, forbidden } = context({ id: 1 });

    await requireAll(["a", "b"])(request, response);

    expect(forbidden).toHaveBeenCalled();
  });
});
