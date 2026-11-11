import { describe, expect, it, vi } from "vitest";
import { generateModelId } from "../../../src/model/generate-model-id";
import { Model } from "../../../src/model/model";
import { createMockDataSource, createMockDriver } from "../../utils/test-helpers";

/** An id counter that hands out ascending ids, like the MongoDB generator. */
function counter() {
  let last = 0;

  return {
    generateNextId: vi.fn(async ({ incrementIdBy = 1 }: { incrementIdBy?: number }) => {
      last += incrementIdBy;
      return last;
    }),
    generateNextIds: vi.fn(
      async ({ count, incrementIdBy = 1 }: { count: number; incrementIdBy?: number }) => {
        const ids: number[] = [];

        for (let index = 0; index < count; index += 1) {
          last += incrementIdBy;
          ids.push(last);
        }

        return ids;
      },
    ),
  };
}

function modelWith(idGenerator: ReturnType<typeof counter>, blockSize?: number) {
  class PageView extends Model {
    public static table = "page_views";
    public static idReservationBlockSize = blockSize;
  }

  vi.spyOn(PageView, "getDataSource").mockReturnValue(
    createMockDataSource({ driver: createMockDriver(), idGenerator }),
  );

  return PageView;
}

describe("idReservationBlockSize", () => {
  it("asks the counter once per id by default", async () => {
    const idGenerator = counter();
    const PageView = modelWith(idGenerator);

    for (let index = 0; index < 3; index += 1) {
      await generateModelId(PageView);
    }

    expect(idGenerator.generateNextId).toHaveBeenCalledTimes(3);
    expect(idGenerator.generateNextIds).not.toHaveBeenCalled();
  });

  it("reserves a block per round-trip and hands out unique ascending ids", async () => {
    const idGenerator = counter();
    const PageView = modelWith(idGenerator, 100);
    const ids: number[] = [];

    for (let index = 0; index < 250; index += 1) {
      ids.push((await generateModelId(PageView)) as number);
    }

    expect(idGenerator.generateNextIds).toHaveBeenCalledTimes(3);
    expect(idGenerator.generateNextId).not.toHaveBeenCalled();
    expect(new Set(ids).size).toBe(250);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("shares one refill between concurrent inserts", async () => {
    const idGenerator = counter();
    const PageView = modelWith(idGenerator, 100);

    const ids = await Promise.all(Array.from({ length: 150 }, () => generateModelId(PageView)));

    expect(idGenerator.generateNextIds).toHaveBeenCalledTimes(2);
    expect(new Set(ids).size).toBe(150);
  });

  it("keeps per-id generation for random sequences", async () => {
    const idGenerator = counter();
    const PageView = modelWith(idGenerator, 100);
    (PageView as unknown as { randomIncrement: boolean }).randomIncrement = true;

    await generateModelId(PageView);

    expect(idGenerator.generateNextId).toHaveBeenCalledTimes(1);
    expect(idGenerator.generateNextIds).not.toHaveBeenCalled();
  });
});
