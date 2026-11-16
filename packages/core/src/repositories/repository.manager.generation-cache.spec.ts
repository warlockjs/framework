import { describe, expect, it, vi } from "vitest";
import { RepositoryManager } from "./repository.manager";

class NotesRepository extends RepositoryManager<any> {}

function makeRepo(mode: "namespace" | "generation") {
  const store = new Map<string, any>();
  const ttls = new Map<string, unknown>();
  const driver = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: any, options?: any) => {
      store.set(key, value);
      ttls.set(key, options?.ttl);
    }),
    removeNamespace: vi.fn(async (namespace: string) => {
      for (const key of [...store.keys()]) if (key.startsWith(namespace)) store.delete(key);
    }),
  };

  const repo: any = Object.create(NotesRepository.prototype);
  repo.isCacheable = true;
  repo.cacheDriver = driver;
  repo.cacheInvalidation = mode;
  repo.cacheGenerationTtl = "1d";
  repo.getName = () => "notes";
  Object.defineProperty(repo, "adapter", {
    value: { serializeModel: (model: any) => model, deserializeModel: (model: any) => model },
  });

  return { repo, driver, store, ttls };
}

describe("repository cache invalidation", () => {
  it("namespace mode keeps the plain keys and removes the namespace", async () => {
    const { repo, driver, store } = makeRepo("namespace");

    await repo.cacheModel({ id: 1 });
    expect(store.has("repositories.notes.id.1")).toBe(true);

    await repo.clearCache();
    expect(driver.removeNamespace).toHaveBeenCalledWith("repositories.notes");
    expect(store.size).toBe(0);
  });

  it("generation mode invalidates with one write and no namespace scan", async () => {
    const { repo, driver, store, ttls } = makeRepo("generation");

    await repo.cacheModel({ id: 1 });
    const [entryKey] = [...store.keys()].filter((key) => key.includes(".id.1"));
    expect(entryKey).toMatch(/^repositories\.notes\.g-[^.]+\.id\.1$/);
    expect(ttls.get(entryKey!)).toBe("1d");

    const before = await repo.versionedKey("repositories.notes.id.1");
    await repo.clearCache();
    const after = await repo.versionedKey("repositories.notes.id.1");

    expect(after).not.toBe(before);
    expect(driver.removeNamespace).not.toHaveBeenCalled();
    await expect(driver.get(after)).resolves.toBeNull();
  });

  it("generation mode clears one model with a scoped namespace removal", async () => {
    const { repo, driver } = makeRepo("generation");

    await repo.clearModelCache({ id: 7 });

    expect(driver.removeNamespace).toHaveBeenCalledTimes(1);
    expect(driver.removeNamespace.mock.calls[0]?.[0]).toMatch(/\.id\.7$/);
  });
});
