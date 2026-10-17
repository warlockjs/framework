import type { ChildModel, Model } from "@warlock.js/cascade";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineFactory, resetFactorySequences } from "./factories";

type UserSchema = { name: string; email: string; role: string; createdAt: Date };

/** Model.create() stand-in: records what the factory saves, no database. */
const created: Array<Partial<UserSchema>> = [];
const create = vi.fn(async (data: Partial<UserSchema>) => {
  created.push(data);

  return { id: created.length, data };
});

// Only `create` is called by a factory; the rest of the static side is unused.
const User = { create } as unknown as ChildModel<Model<UserSchema>>;

const userFactory = defineFactory(User, (seed) => ({
  name: seed.text("User"),
  email: seed.email(),
  role: seed.pick(["member", "editor"]),
  createdAt: seed.date(seed.index),
})).state("admin", (seed) => ({ role: "admin", email: seed.email("admin") }));

beforeEach(() => {
  created.length = 0;
  create.mockClear();
  resetFactorySequences();
});

describe("defineFactory", () => {
  it("make() builds deterministic attributes from the sequence, without saving", () => {
    expect(userFactory.make()).toEqual({
      name: "User 1",
      email: "user1@example.test",
      role: "member",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(userFactory.make({ name: "Ada" })).toMatchObject({ name: "Ada", role: "editor" });
    expect(create).not.toHaveBeenCalled();
  });

  it("is the same on every run once the sequences are reset", () => {
    const first = userFactory.makeMany(3);

    resetFactorySequences();

    expect(userFactory.makeMany(3)).toEqual(first);
    expect(first.map((user) => user.email)).toEqual([
      "user1@example.test",
      "user2@example.test",
      "user3@example.test",
    ]);
    expect(first[2]?.createdAt).toEqual(new Date("2026-01-03T00:00:00.000Z"));
  });

  it("create() saves through Model.create(); create(n) saves n records in order", async () => {
    const one = await userFactory.create({ role: "owner" });
    const many = await userFactory.create(2);

    expect(one).toMatchObject({ id: 1 });
    expect(many).toHaveLength(2);
    expect(created.map((user) => [user.name, user.role])).toEqual([
      ["User 1", "owner"],
      ["User 2", "editor"],
      ["User 3", "member"],
    ]);
  });

  it("applies states with with(), sharing the base sequence", async () => {
    await userFactory.with("admin").createMany(1);
    await userFactory.create();

    expect(created[0]).toMatchObject({ role: "admin", email: "admin1@example.test" });
    expect(created[1]).toMatchObject({ name: "User 2" });
  });

  it("takes overrides as a function of the seed", () => {
    expect(userFactory.make((seed) => ({ name: `Custom ${seed.sequence}` })).name).toBe("Custom 1");
  });

  it("names the defined states when an unknown one is used", () => {
    expect(() => userFactory.with("banned").make()).toThrow(
      'Factory state "banned" is not defined. Defined states: admin.',
    );
  });
});
