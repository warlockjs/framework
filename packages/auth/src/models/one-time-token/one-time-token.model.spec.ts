import { beforeEach, describe, expect, it, vi } from "vitest";

const modelQuery = vi.fn();

vi.mock("@warlock.js/cascade", () => ({
  Model: class {
    public static query = (...args: unknown[]) => modelQuery(...args);
  },
}));

vi.mock("@warlock.js/seal", () => {
  const chained = () => {
    const proxy: Record<string, unknown> = {};
    const handler = () => proxy;

    for (const method of ["required", "optional", "default", "defaultNow"]) {
      proxy[method] = handler;
    }

    return proxy;
  };

  return {
    v: { object: chained, string: chained, scalar: chained, date: chained, int: chained },
  };
});

import { OneTimeToken } from "./one-time-token.model";

type QueryStub = {
  where: ReturnType<typeof vi.fn>;
  whereNotNull: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};

function buildQueryStub(deleted: number): QueryStub {
  const builder = {} as QueryStub;

  builder.where = vi.fn(() => builder);
  builder.whereNotNull = vi.fn(() => builder);
  builder.delete = vi.fn().mockResolvedValue(deleted);
  builder.get = vi.fn(() => {
    throw new Error("purgeSpent must not load rows");
  });

  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OneTimeToken.purgeSpent", () => {
  it("deletes expired and consumed rows with set-based deletes, never loading them", async () => {
    const expired = buildQueryStub(3);
    const consumed = buildQueryStub(2);
    modelQuery.mockReturnValueOnce(expired).mockReturnValueOnce(consumed);

    expect(await OneTimeToken.purgeSpent()).toBe(5);

    expect(expired.where).toHaveBeenCalledWith("expires_at", "<", expect.any(Date));
    expect(consumed.whereNotNull).toHaveBeenCalledWith("consumed_at");
    expect(expired.delete).toHaveBeenCalledOnce();
    expect(consumed.delete).toHaveBeenCalledOnce();
    expect(expired.get).not.toHaveBeenCalled();
    expect(consumed.get).not.toHaveBeenCalled();
  });
});
