import { describe, expect, it } from "vitest";
import { RepositoryManager } from "./repository.manager";

describe("RepositoryManager.listCached with callback filters", () => {
  it("does not serve one callback filter's cached result to another", async () => {
    const store = new Map<string, any>();
    const perform = (label: string) => {
      const fn = function perform() {
        return label;
      };
      return fn;
    };

    const fake: any = Object.create(RepositoryManager.prototype);
    fake.isCacheable = true;
    fake.cacheDriver = {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: any) => void store.set(key, value),
    };
    fake.getName = () => "posts";
    fake.prepareOptions = (options: any) => ({ ...options });
    fake.cache = async (key: string, value: any) => void store.set(key, value);
    // `adapter` is a getter-only accessor on the prototype, so shadow it.
    Object.defineProperty(fake, "adapter", {
      value: { serializeModel: (m: any) => m, deserializeModel: (m: any) => m },
    });
    fake._listImpl = async (options: any) => ({
      data: [options.perform()],
      pagination: {},
    });

    const first = await RepositoryManager.prototype.listCached.call(fake, {
      perform: perform("org-1"),
    } as any);
    const second = await RepositoryManager.prototype.listCached.call(fake, {
      perform: perform("org-2"),
    } as any);

    expect(first.data).toEqual(["org-1"]);
    expect(second.data).toEqual(["org-2"]);
  });
});
