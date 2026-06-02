import { beforeEach, describe, expect, it } from "vitest";
import type {
  QueryBuilderContract,
  RepositoryAdapterContract,
  RepositoryOptions,
} from "../../../src/repositories/contracts";
import { RepositoryManager } from "../../../src/repositories/repository.manager";

/**
 * Records every query-builder call so we can assert on the SHAPE of the query
 * the repository composes from its options — without a live database. Only the
 * methods `applyOptionsToQuery` reaches for are implemented; the rest throw if
 * touched, which keeps the fake honest.
 */
class RecordingQuery {
  public calls: Array<{ method: string; args: unknown[] }> = [];

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });

    return this;
  }

  public where(...args: unknown[]) {
    return this.record("where", args);
  }

  public orderBy(...args: unknown[]) {
    return this.record("orderBy", args);
  }

  public sortBy(...args: unknown[]) {
    return this.record("sortBy", args);
  }

  public random(...args: unknown[]) {
    return this.record("random", args);
  }

  public select(...args: unknown[]) {
    return this.record("select", args);
  }

  public deselect(...args: unknown[]) {
    return this.record("deselect", args);
  }

  public limit(...args: unknown[]) {
    return this.record("limit", args);
  }

  public applyFilters(...args: unknown[]) {
    return this.record("applyFilters", args);
  }

  /** Names of the methods invoked, in order. */
  public get methodNames(): string[] {
    return this.calls.map((call) => call.method);
  }

  /** The first recorded call to `method`, or undefined. */
  public callTo(method: string) {
    return this.calls.find((call) => call.method === method);
  }
}

/** Minimal adapter — only `query()` and `registerEvents()` are exercised. */
function makeAdapter(query: RecordingQuery): RepositoryAdapterContract<unknown> {
  return {
    query: () => query as unknown as QueryBuilderContract<unknown>,
    registerEvents: () => [],
    resolveRepositoryName: () => "widgets",
  } as unknown as RepositoryAdapterContract<unknown>;
}

/**
 * Test subclass that surfaces the protected query/cache helpers and lets each
 * test configure `filterBy`, `simpleSelectColumns`, and the repository name.
 */
class TestRepository extends RepositoryManager<unknown> {
  public constructor(
    adapter: RepositoryAdapterContract<unknown>,
    config: {
      filterBy?: Record<string, any>;
      simpleSelectColumns?: string[];
      name?: string;
    } = {},
  ) {
    super(adapter);

    if (config.filterBy) {
      this.filterBy = config.filterBy;
    }

    if (config.simpleSelectColumns) {
      this.simpleSelectColumns = config.simpleSelectColumns;
    }

    if (config.name) {
      this.name = config.name;
    }
  }

  public exposeApply(query: QueryBuilderContract<unknown>, options: RepositoryOptions) {
    return this.applyOptionsToQuery(query, options);
  }

  public exposePrepare(options?: RepositoryOptions) {
    return this.prepareOptions(options);
  }

  public exposeCacheKey(key: string | Record<string, any>, more?: Record<string, any>) {
    return this.cacheKey(key, more);
  }
}

let query: RecordingQuery;

beforeEach(() => {
  query = new RecordingQuery();
});

describe("RepositoryManager — applyOptionsToQuery select/order", () => {
  it("applies select and deselect", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      select: ["id", "name"],
      deselect: ["secret"],
    });

    expect(query.callTo("select")?.args).toEqual([["id", "name"]]);
    expect(query.callTo("deselect")?.args).toEqual([["secret"]]);
  });

  it("maps orderBy 'random' to a random() call", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      orderBy: "random",
    });

    expect(query.methodNames).toContain("random");
  });

  it("maps a [column, direction] tuple to orderBy()", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      orderBy: ["createdAt", "desc"],
    });

    expect(query.callTo("orderBy")?.args).toEqual(["createdAt", "desc"]);
  });

  it("maps an orderBy object to sortBy()", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      orderBy: { name: "asc", createdAt: "desc" },
    });

    expect(query.callTo("sortBy")?.args).toEqual([{ name: "asc", createdAt: "desc" }]);
  });

  it("applies simpleSelect only when simpleSelectColumns is configured", () => {
    const withColumns = new TestRepository(makeAdapter(query), {
      simpleSelectColumns: ["id", "title"],
    });

    withColumns.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      simpleSelect: true,
    });

    expect(query.callTo("select")?.args).toEqual([["id", "title"]]);
  });

  it("ignores simpleSelect when no simpleSelectColumns are configured", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      simpleSelect: true,
    });

    expect(query.methodNames).not.toContain("select");
  });
});

describe("RepositoryManager — applyOptionsToQuery limit", () => {
  it("applies a limit only when pagination is disabled", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      limit: 25,
      paginate: false,
    });

    expect(query.callTo("limit")?.args).toEqual([25]);
  });

  it("does NOT apply a limit while pagination is on", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      limit: 25,
    });

    expect(query.methodNames).not.toContain("limit");
  });
});

describe("RepositoryManager — applyOptionsToQuery filters", () => {
  it("applies repository filters when filterBy is non-empty", () => {
    const repository = new TestRepository(makeAdapter(query), {
      filterBy: { status: "=" },
    });

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      status: "active",
    } as RepositoryOptions);

    const filterCall = query.callTo("applyFilters");

    expect(filterCall).toBeDefined();
    expect(filterCall?.args[0]).toEqual({ status: "=" });
    expect(filterCall?.args[2]).toMatchObject({
      dateFormat: "DD-MM-YYYY",
      dateTimeFormat: "DD-MM-YYYY HH:mm:ss",
    });
  });

  it("skips applyFilters when filterBy is empty", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {});

    expect(query.methodNames).not.toContain("applyFilters");
  });
});

describe("RepositoryManager — applyOptionsToQuery perform", () => {
  it("invokes a custom perform callback with the query and options", () => {
    const repository = new TestRepository(makeAdapter(query));

    let received: { query: unknown; options: RepositoryOptions } | undefined;

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      perform: (performQuery, options) => {
        received = { query: performQuery, options };
      },
    });

    expect(received?.query).toBe(query);
  });
});

describe("RepositoryManager — cursor pagination phase 1", () => {
  it("adds a WHERE and ORDER BY for a forward cursor", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      paginationMode: "cursor",
      cursor: 100,
      direction: "next",
    });

    expect(query.callTo("where")?.args).toEqual(["id", ">", 100]);
    expect(query.callTo("orderBy")?.args).toEqual(["id", "asc"]);
  });

  it("flips the operator and sort direction for a backward cursor", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      paginationMode: "cursor",
      cursor: 100,
      direction: "prev",
    });

    expect(query.callTo("where")?.args).toEqual(["id", "<", 100]);
    expect(query.callTo("orderBy")?.args).toEqual(["id", "desc"]);
  });

  it("honours a custom cursorColumn", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      paginationMode: "cursor",
      cursor: "abc",
      cursorColumn: "created_at",
    });

    expect(query.callTo("where")?.args).toEqual(["created_at", ">", "abc"]);
    expect(query.callTo("orderBy")?.args).toEqual(["created_at", "asc"]);
  });

  it("orders by the cursor column even with no cursor value", () => {
    const repository = new TestRepository(makeAdapter(query));

    repository.exposeApply(query as unknown as QueryBuilderContract<unknown>, {
      paginationMode: "cursor",
    });

    expect(query.methodNames).not.toContain("where");
    expect(query.callTo("orderBy")?.args).toEqual(["id", "asc"]);
  });
});

describe("RepositoryManager — prepareOptions", () => {
  it("returns an empty object when no options and no defaults are set", () => {
    const repository = new TestRepository(makeAdapter(query));

    expect(repository.exposePrepare()).toEqual({});
  });

  it("passes through caller options", () => {
    const repository = new TestRepository(makeAdapter(query));

    expect(repository.exposePrepare({ page: 2, limit: 10 })).toEqual({ page: 2, limit: 10 });
  });
});

describe("RepositoryManager — cacheKey", () => {
  it("namespaces by repository name and a string key", () => {
    const repository = new TestRepository(makeAdapter(query), { name: "widgets" });

    expect(repository.exposeCacheKey("count")).toBe("repositories.widgets.count");
  });

  it("serializes an object key as JSON", () => {
    const repository = new TestRepository(makeAdapter(query), { name: "widgets" });

    expect(repository.exposeCacheKey({ id: 1 })).toBe('repositories.widgets.{"id":1}');
  });

  it("appends serialized extra options", () => {
    const repository = new TestRepository(makeAdapter(query), { name: "widgets" });

    expect(repository.exposeCacheKey("list", { page: 2 })).toBe(
      'repositories.widgets.list.{"page":2}',
    );
  });
});
