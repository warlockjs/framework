import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseTransactionContext } from "../../../src/context/database-transaction-context";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import { cleanupModelsRegistery, registerModelInRegistry } from "../../../src/model/register-model";
import { RelationLoader } from "../../../src/relations/relation-loader";
import type { RelationDefinition } from "../../../src/relations/types";
import { createMockDriver } from "../../utils/test-helpers";

/**
 * Sibling relations (`with("posts", "profile", "team")`) load concurrently,
 * yet the result is the one a one-after-another load gives: same attach
 * order, same error, and strictly sequential inside a transaction.
 */

class Post extends Model {
  public static table = "posts";
}

class Profile extends Model {
  public static table = "profiles";
}

class Team extends Model {
  public static table = "teams";
}

class Author extends Model {
  public static table = "authors";
  public static relations: Record<string, RelationDefinition> = {
    posts: { type: "hasMany", model: "Post" },
    profile: { type: "hasOne", model: "Profile" },
    team: { type: "belongsTo", model: "Team", foreignKey: "teamId" },
  };
}

let inFlight = 0;
let maxInFlight = 0;

/** A fake query whose `get()` resolves after `delay` ms (or rejects). */
function delayedQuery(delay: number, error?: Error) {
  const query: Record<string, unknown> = {};

  for (const method of ["whereIn", "where", "select", "orderBy", "limit", "whereNotNull"]) {
    query[method] = vi.fn(() => query);
  }

  query.get = vi.fn(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);

    await new Promise((resolve) => setTimeout(resolve, delay));

    inFlight -= 1;

    if (error) {
      throw error;
    }

    return [];
  });

  return query;
}

function authors() {
  return [new Author({ id: 1, teamId: 5 }), new Author({ id: 2, teamId: 6 })];
}

describe("RelationLoader — sibling relations", () => {
  beforeAll(() => {
    dataSourceRegistry.register({ name: "test", driver: createMockDriver(), isDefault: true });
    registerModelInRegistry("Post", Post);
    registerModelInRegistry("Profile", Profile);
    registerModelInRegistry("Team", Team);
    registerModelInRegistry("Author", Author);
  });

  afterAll(() => {
    dataSourceRegistry.clear();
    cleanupModelsRegistery();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    inFlight = 0;
    maxInFlight = 0;
  });

  it("runs sibling queries concurrently and attaches them in the requested order", async () => {
    // The first relation asked for finishes last.
    vi.spyOn(Post, "query").mockReturnValue(delayedQuery(30) as never);
    vi.spyOn(Profile, "query").mockReturnValue(delayedQuery(10) as never);
    vi.spyOn(Team, "query").mockReturnValue(delayedQuery(0) as never);

    const models = authors();

    await new RelationLoader(models, Author).load(["posts", "profile", "team"]);

    expect(maxInFlight).toBe(3);

    for (const model of models) {
      expect(Array.from(model.loadedRelations.keys())).toEqual(["posts", "profile", "team"]);

      const ownKeys = Object.keys(model);
      expect(ownKeys.slice(-3)).toEqual(["posts", "profile", "team"]);
      expect((model as unknown as { posts: unknown }).posts).toEqual([]);
      expect((model as unknown as { profile: unknown }).profile).toBeNull();
    }
  });

  it("keeps a relation loaded earlier in its place", async () => {
    vi.spyOn(Post, "query").mockReturnValue(delayedQuery(20) as never);
    vi.spyOn(Profile, "query").mockReturnValue(delayedQuery(0) as never);
    vi.spyOn(Team, "query").mockReturnValue(delayedQuery(0) as never);

    const models = authors();
    await new RelationLoader(models, Author).load(["team"]);
    await new RelationLoader(models, Author).load(["posts", "team", "profile"]);

    expect(Array.from(models[0]!.loadedRelations.keys())).toEqual(["team", "posts", "profile"]);
  });

  it("reports the first failing relation in the requested order", async () => {
    vi.spyOn(Post, "query").mockReturnValue(delayedQuery(30, new Error("posts failed")) as never);
    vi.spyOn(Profile, "query").mockReturnValue(
      delayedQuery(0, new Error("profile failed")) as never,
    );
    vi.spyOn(Team, "query").mockReturnValue(delayedQuery(0) as never);

    await expect(
      new RelationLoader(authors(), Author).load(["posts", "profile", "team"]),
    ).rejects.toThrow("posts failed");
  });

  it("loads one relation at a time inside a transaction", async () => {
    vi.spyOn(databaseTransactionContext, "hasActiveTransaction").mockReturnValue(true);
    vi.spyOn(Post, "query").mockReturnValue(delayedQuery(5) as never);
    vi.spyOn(Profile, "query").mockReturnValue(delayedQuery(5) as never);
    vi.spyOn(Team, "query").mockReturnValue(delayedQuery(5) as never);

    await new RelationLoader(authors(), Author).load(["posts", "profile", "team"]);

    expect(maxInFlight).toBe(1);
  });
});
