import events from "@mongez/events";
import { isIterable, isPlainObject, isScalar } from "@mongez/supportive-is";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Response } from "./response";

/** The recursive, fully async walk `parse()` used to be: the output contract. */
async function referenceParse(value: any): Promise<any> {
  if (!value || isScalar(value)) return value;

  if (Buffer.isBuffer(value) || value instanceof Uint8Array || typeof value.pipe === "function") {
    return value;
  }

  if (value instanceof Map) return referenceParse(Object.fromEntries(value));

  if (value.toJSON) return await value.toJSON();

  if (isIterable(value)) {
    return Promise.all(Array.from(value as Iterable<any>).map((item) => referenceParse(item)));
  }

  if (!isPlainObject(value)) return value;

  const parsed: Record<string, any> = {};

  for (const key in value) {
    parsed[key] = await referenceParse(value[key]);
  }

  return parsed;
}

class Model {
  public constructor(private readonly data: Record<string, unknown>) {}

  public async toJSON() {
    await new Promise((resolve) => setImmediate(resolve));

    return { ...this.data, serialized: true };
  }
}

function fixtures() {
  return {
    nested: {
      a: 1,
      b: "two",
      c: [1, 2, { d: null, e: [true, false] }],
      f: { g: { h: "deep" } },
    },
    map: new Map<string, unknown>([
      ["x", 1],
      ["y", { z: new Date("2026-01-01T00:00:00Z") }],
    ]),
    set: new Set([1, "two", { three: 3 }]),
    syncToJSON: { when: new Date("2026-02-03T04:05:06Z"), label: "x" },
    asyncToJSON: { user: new Model({ id: 1 }), plain: { ok: true } },
    models: [new Model({ id: 1 }), new Model({ id: 2 }), { id: 3 }],
    buffer: { file: Buffer.from("abc") },
  };
}

describe("Response.parse", () => {
  it("returns the same output as the original walk", async () => {
    const response = new Response();

    for (const [name, value] of Object.entries(fixtures())) {
      const expected = await referenceParse(fixtures()[name as keyof ReturnType<typeof fixtures>]);

      expect(await response.parse(value), name).toEqual(expected);
    }
  });

  it("returns plain data by reference, without copying", async () => {
    const response = new Response();
    const body = {
      items: [
        { id: 1, tags: ["a"] },
        { id: 2, tags: [] },
      ],
      total: 2,
    };

    expect(await response.parse(body)).toBe(body);
  });

  it("never rewrites the caller's object when a child is converted", async () => {
    const response = new Response();
    const when = new Date("2026-01-01T00:00:00Z");
    const shared = { meta: { untouched: true }, when, list: [new Model({ id: 7 })] };

    const parsed = await response.parse(shared);

    expect(parsed).not.toBe(shared);
    expect(shared.when).toBe(when);
    expect(shared.list[0]).toBeInstanceOf(Model);
    // Unchanged branches are shared, changed ones are copies.
    expect(parsed.meta).toBe(shared.meta);
    expect(parsed.list).not.toBe(shared.list);
    expect(parsed).toEqual({
      meta: { untouched: true },
      when: when.toISOString(),
      list: [{ id: 7, serialized: true }],
    });
  });

  it("calls each toJSON once, starting them all before awaiting any", async () => {
    const response = new Response();
    const started: number[] = [];
    const item = (id: number) => ({
      toJSON: vi.fn(async () => {
        started.push(id);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { id };
      }),
    });
    const items = [item(1), item(2), item(3)];
    const body = { first: items[0], rest: [items[1], items[2]] };

    const pending = response.parse(body);

    expect(started).toEqual([1, 2, 3]);

    expect(await pending).toEqual({ first: { id: 1 }, rest: [{ id: 2 }, { id: 3 }] });

    for (const entry of items) {
      expect(entry.toJSON).toHaveBeenCalledTimes(1);
    }
  });

  it("walks a 10k-node body without any toJSON call", async () => {
    const response = new Response();
    const body = Array.from({ length: 2_000 }, (_, index) => ({
      index,
      name: `row ${index}`,
      nested: { flag: index % 2 === 0, values: [index, index + 1] },
    }));

    expect(await response.parse(body)).toBe(body);
  });

  it("rejects when a toJSON throws", async () => {
    const response = new Response();

    await expect(
      response.parse({
        broken: {
          toJSON() {
            throw new Error("boom");
          },
        },
      }),
    ).rejects.toThrow("boom");
  });
});

describe("Response events without listeners", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    events.unsubscribe("response.sending");
  });

  function fakeResponse() {
    const headers = new Map<string, unknown>();
    const sent: unknown[] = [];
    const reply = {
      sent: false,
      statusCode: 200,
      raw: { once() {} },
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      header: (name: string, value: unknown) => headers.set(name.toLowerCase(), value),
      status(code: number) {
        reply.statusCode = code;
        return reply;
      },
      async send(body: unknown) {
        sent.push(body);
      },
    };
    const response = new Response();

    response.setResponse(reply as never);
    response.request = { id: "req-1", endTime: undefined } as never;
    response.setRoute({ method: "GET", path: "/x" } as never);

    return { response, sent };
  }

  it("schedules no event-loop turn when nothing subscribed", async () => {
    const immediate = vi.spyOn(globalThis, "setImmediate");
    const { response, sent } = fakeResponse();

    await response.send({ a: 1 });

    expect(sent).toEqual([{ a: 1 }]);
    expect(immediate).not.toHaveBeenCalled();
  });

  it("still runs a listener before the body is written", async () => {
    const order: string[] = [];
    const { response, sent } = fakeResponse();

    Response.on("sending", () => {
      order.push(`listener:${sent.length}`);
    });

    await response.send({ a: 1 });

    expect(order).toEqual(["listener:0"]);
    expect(sent).toHaveLength(1);
  });
});
