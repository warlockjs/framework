import { DataSource, dataSourceRegistry, Model, PostgresDriver } from "@warlock.js/cascade";
import { v } from "@warlock.js/seal";
import { beforeEach, describe, expect, it } from "vitest";
import { RepositoryManager } from "./repository.manager";

class Product extends Model<any> {
  public static table = "products";
  public static schema = v.object({
    name: v.object({ en: v.string(), ar: v.string() }),
    tags: v.array(v.string()).default([]),
  });
}

describe("RepositoryManager.listCached on a SQL driver", () => {
  beforeEach(() => {
    dataSourceRegistry.clear();
    dataSourceRegistry.register(
      new DataSource({
        name: "cached-products",
        driver: new PostgresDriver({ database: "test" }) as never,
        isDefault: true,
      }),
    );
  });

  it("serves the same object and array values on a cache hit as on a miss", async () => {
    const store = new Map<string, any>();
    let reads = 0;

    const fake: any = Object.create(RepositoryManager.prototype);
    fake.isCacheable = true;
    fake.cacheDriver = {
      get: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)) : undefined),
      set: async (key: string, value: any) => void store.set(key, JSON.stringify(value)),
    };
    fake.getName = () => "products";
    fake.prepareOptions = (options: any) => ({ ...options });
    fake.cache = async (key: string, value: any) => void store.set(key, JSON.stringify(value));
    Object.defineProperty(fake, "adapter", {
      value: {
        serializeModel: (model: Product) => model.toSnapshot(),
        deserializeModel: (snapshot: any) => Product.fromSnapshot(snapshot),
      },
    });
    fake._listImpl = async () => {
      reads++;

      return {
        data: [
          Product.hydrate({
            id: 1,
            name: { en: "Tea", ar: "tea-ar" },
            tags: ["hot", "drink"],
          }),
        ],
        pagination: {},
      };
    };

    const miss = await RepositoryManager.prototype.listCached.call(fake, { limit: 1 } as any);
    const hit = await RepositoryManager.prototype.listCached.call(fake, { limit: 1 } as any);

    expect(reads).toBe(1);
    expect(typeof hit.data[0].get("name")).toBe("object");
    expect(hit.data[0].get("name")).toEqual(miss.data[0].get("name"));
    expect(hit.data[0].get("tags")).toEqual(["hot", "drink"]);
    expect(hit.data[0].data).toEqual(miss.data[0].data);
  });
});
