import { v } from "@warlock.js/seal";
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import { dataSourceRegistry } from "../../../src/data-source/data-source-registry";
import { Model } from "../../../src/model/model";
import type { ModelData, ModelDataSnapshot } from "../../../src/model/model.types";
import { createMockDriver } from "../../utils/test-helpers";

const postSchema = v.object({
  title: v.string().required(),
  summary: v.string().optional(),
  views: v.int().default(0),
  rating: v.float().required(),
  published: v.boolean().required(),
  publishedAt: v.date().nullable(),
  createdOn: v.date().required(),
  tags: v.array(v.string()).required(),
  meta: v.object({ seoTitle: v.string().optional() }).required(),
  authorId: v.int().required().internal(),
});

type PostSchema = ModelData<typeof postSchema>;

class Post extends Model<PostSchema> {
  public static table = "typed_posts";
  public static schema = postSchema;
  public static hidden = ["rating"];
}

class LooseThing extends Model {
  public static table = "loose_things";
}

beforeAll(() => {
  dataSourceRegistry.register({ name: "test", driver: createMockDriver(), isDefault: true });
});

afterAll(() => {
  dataSourceRegistry.clear();
});

describe("Model get() and set() are typed from the schema", () => {
  let post: Post;

  beforeAll(() => {
    post = new Post({ title: "Hello", views: 3, authorId: 1 });
  });

  it("infers each cast", () => {
    expectTypeOf(post.get("title")).toEqualTypeOf<string>();
    expectTypeOf(post.get("views")).toEqualTypeOf<number>();
    expectTypeOf(post.get("rating")).toEqualTypeOf<number>();
    expectTypeOf(post.get("published")).toEqualTypeOf<boolean>();
    expectTypeOf(post.get("createdOn")).toEqualTypeOf<Date>();
    expectTypeOf(post.get("tags")).toEqualTypeOf<string[]>();
    expectTypeOf(post.get("meta")).toEqualTypeOf<{ seoTitle?: string }>();
    expectTypeOf(post.get("authorId")).toEqualTypeOf<number>();
  });

  it("keeps nullable and optional columns honest", () => {
    expectTypeOf(post.get("publishedAt")).toEqualTypeOf<Date | null>();
    expectTypeOf(post.get("summary")).toEqualTypeOf<string | undefined>();
  });

  it("removes null and undefined when a default is passed", () => {
    expectTypeOf(post.get("publishedAt", new Date())).toEqualTypeOf<Date>();
    expectTypeOf(post.get("summary", "none")).toEqualTypeOf<string>();
  });

  it("rejects unknown columns", () => {
    // @ts-expect-error not a column of Post
    post.get("tilte");
  });

  it("accepts dot paths loosely and an explicit type argument", () => {
    expectTypeOf(post.get("meta.seoTitle")).toEqualTypeOf<any>();
    expectTypeOf(post.get<string>("meta.seoTitle")).toEqualTypeOf<string>();
    expectTypeOf(post.get<number>("views")).toEqualTypeOf<number>();
  });

  it("checks set() values against the column", () => {
    post.set("views", 10);
    post.set("publishedAt", null);
    post.set("publishedAt", new Date());
    post.set("meta.seoTitle", "anything");

    // @ts-expect-error a string is not a number
    post.set("views", "10");
    // @ts-expect-error a string is not a Date
    post.set("createdOn", "2026-01-01");
    // @ts-expect-error not a column of Post
    post.set("tilte", "x");

    expect(post.get("views")).toBe(10);
  });

  it("keeps models without a schema type loosely typed", () => {
    const thing = new LooseThing({ anything: 1 });

    expectTypeOf(thing.get("anything")).toBeAny();

    thing.set("whatever", { a: 1 });

    expect(thing.get("whatever")).toEqual({ a: 1 });
  });
});

describe("Model snapshots and request schemas", () => {
  it("toDataSnapshot() is typed, read-only and drops hidden columns", () => {
    const createdOn = new Date("2026-01-01T00:00:00Z");
    const post = new Post({ title: "Hello", rating: 4.5, createdOn });
    const snapshot = post.toDataSnapshot();

    expectTypeOf(snapshot).toEqualTypeOf<ModelDataSnapshot<PostSchema>>();
    expectTypeOf(snapshot.createdOn).toEqualTypeOf<Date>();
    expectTypeOf(snapshot.publishedAt).toEqualTypeOf<Date | null>();

    expect(snapshot).toEqual({ title: "Hello", createdOn });
    expect(snapshot.createdOn).toBe(createdOn);
    expect(snapshot).not.toBe(post.data);
  });

  it("requestSchema() omits internal fields at runtime and in the type", () => {
    const request = Post.requestSchema();

    expect(Object.keys(request.schema)).not.toContain("authorId");
    expect(Object.keys(request.schema)).toContain("title");
    expect(Object.keys(postSchema.schema)).toContain("authorId");

    const picked = request.pick("title", "views");

    expect(Object.keys(picked.schema)).toEqual(["title", "views"]);
    // @ts-expect-error authorId is internal, so it is not a request key
    request.pick("authorId");
  });

  it("requestSchema() throws for a model without a schema", () => {
    expect(() => LooseThing.requestSchema()).toThrow(/no static schema/);
  });
});

describe("dev warning for a column read as a property", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  class Article extends Model {
    public static table = "dev_warn_articles";
    public static schema = v.object({ headline: v.string(), uuid: v.string() });

    public get slug() {
      return "a-slug";
    }
  }

  it("warns once per model and column, naming the fix", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const article = new Article({ headline: "Hi" });

    expect((article as unknown as Record<string, unknown>).headline).toBeUndefined();
    expect((article as unknown as Record<string, unknown>).headline).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("Article.headline");
    expect(warn.mock.calls[0]?.[0]).toContain('model.get("headline")');
  });

  it("does not shadow members of the model or change get()", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const article = new Article({ headline: "Hi", uuid: "x" });

    expect(article.get("headline")).toBe("Hi");
    expect(article.slug).toBe("a-slug");
    expect(Object.keys(article)).not.toContain("headline");
    expect(warn).not.toHaveBeenCalled();
  });

  it("lets a property assignment keep working", () => {
    const article = new Article({ headline: "Hi" }) as unknown as Record<string, unknown>;

    article.headline = "assigned";

    expect(article.headline).toBe("assigned");
  });
});
