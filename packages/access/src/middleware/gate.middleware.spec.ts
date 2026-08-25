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

import { gate, gateAll, gateAny } from "./gate.middleware";
import { makeCtx } from "./test-support/make-ctx";

function context(user?: unknown) {
  const forbidden = vi.fn();
  const { request, response } = makeCtx({ request: { user }, response: { forbidden } });

  return { request, response, forbidden };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gate", () => {
  it("passes through when the user holds the permission", async () => {
    can.mockResolvedValue(true);
    const { request, response, forbidden } = context({ id: 1 });

    await gate("orders.create")({ request, response });

    expect(forbidden).not.toHaveBeenCalled();
  });

  it("forbids when the user lacks the permission", async () => {
    can.mockResolvedValue(false);
    const { request, response, forbidden } = context({ id: 1 });

    await gate("orders.create")({ request, response });

    expect(forbidden).toHaveBeenCalled();
  });

  it("forbids (without a permission check) when there is no authenticated user", async () => {
    const { request, response, forbidden } = context(undefined);

    await gate("orders.create")({ request, response });

    expect(forbidden).toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
  });
});

describe("gateAny", () => {
  it("passes through when the user holds ANY of the permissions", async () => {
    canAny.mockResolvedValue(true);
    const { request, response, forbidden } = context({ id: 1 });

    await gateAny(["a", "b"])({ request, response });

    expect(forbidden).not.toHaveBeenCalled();
  });

  it("forbids when the user holds none of the permissions", async () => {
    canAny.mockResolvedValue(false);
    const { request, response, forbidden } = context({ id: 1 });

    await gateAny(["a", "b"])({ request, response });

    expect(forbidden).toHaveBeenCalled();
  });

  it("forbids (without a permission check) when there is no authenticated user", async () => {
    const { request, response, forbidden } = context(undefined);

    await gateAny(["a", "b"])({ request, response });

    expect(forbidden).toHaveBeenCalled();
    expect(canAny).not.toHaveBeenCalled();
  });
});

describe("gateAll", () => {
  it("passes through when the user holds ALL of the permissions", async () => {
    canAll.mockResolvedValue(true);
    const { request, response, forbidden } = context({ id: 1 });

    await gateAll(["a", "b"])({ request, response });

    expect(forbidden).not.toHaveBeenCalled();
  });

  it("forbids when the user is missing one of the permissions", async () => {
    canAll.mockResolvedValue(false);
    const { request, response, forbidden } = context({ id: 1 });

    await gateAll(["a", "b"])({ request, response });

    expect(forbidden).toHaveBeenCalled();
  });

  it("forbids (without a permission check) when there is no authenticated user", async () => {
    const { request, response, forbidden } = context(undefined);

    await gateAll(["a", "b"])({ request, response });

    expect(forbidden).toHaveBeenCalled();
    expect(canAll).not.toHaveBeenCalled();
  });
});
