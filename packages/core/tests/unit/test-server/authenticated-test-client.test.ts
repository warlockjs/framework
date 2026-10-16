import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actingAs } from "../../../src/tests/authenticated-test-client";
import { testGet } from "../../../src/tests/test-helpers";

const fetchMock = vi.fn();
const user = (token: string) => ({
  generateAccessToken: vi.fn(async () => ({ token })),
  removeAccessToken: vi.fn(async (_token: string) => undefined),
});

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  fetchMock.mockReset().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function headers(index: number) {
  return new Headers((fetchMock.mock.calls[index][1] as RequestInit).headers);
}

describe("actingAs", () => {
  it.each(["production", "development", undefined])(
    "refuses NODE_ENV=%s before minting credentials",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      const actor = user("unused");
      await expect(actingAs(actor)).rejects.toThrow('requires NODE_ENV="test"');
      expect(actor.generateAccessToken).not.toHaveBeenCalled();
      expect(actor.removeAccessToken).not.toHaveBeenCalled();
    },
  );

  it("keeps simultaneous users and anonymous helpers independent", async () => {
    const ada = user("ada-token");
    const bob = user("bob-token");
    const [a, b] = await Promise.all([actingAs(ada), actingAs(bob)]);
    await Promise.all([a.get("/account"), b.get("/account"), testGet("/account")]);
    expect(headers(0).get("authorization")).toBe("Bearer ada-token");
    expect(headers(1).get("authorization")).toBe("Bearer bob-token");
    expect(headers(2).get("authorization")).toBeNull();
    expect(ada.generateAccessToken).toHaveBeenCalledOnce();
    expect(bob.generateAccessToken).toHaveBeenCalledOnce();
  });

  it("preserves Headers/tuple options without changing their headers", async () => {
    const client = await actingAs(user("bound-token"));
    const original = new Headers({ "x-test": "one", authorization: "Bearer other" });
    const signal = new AbortController().signal;
    await client.get("/account", { headers: original, signal });
    await client.delete("/account", { headers: [["x-test", "two"]] });
    expect(headers(0).get("authorization")).toBe("Bearer bound-token");
    expect(headers(0).get("x-test")).toBe("one");
    expect(headers(1).get("x-test")).toBe("two");
    expect(original.get("authorization")).toBe("Bearer other");
    expect(fetchMock.mock.calls[0][1].signal).toBe(signal);
  });

  it("keeps JSON body semantics and generic multipart requests", async () => {
    const client = await actingAs(user("token"));
    const form = new FormData();
    form.set("name", "Ada");
    await client.post("/values", false);
    await client.put("/values", 0);
    await client.patch("/values", null);
    await client.request("/form", { method: "POST", body: form });
    expect(fetchMock.mock.calls.slice(0, 3).map((call) => call[1].body)).toEqual([
      "false",
      "0",
      "null",
    ]);
    expect(headers(0).get("content-type")).toBe("application/json");
    expect(headers(3).has("content-type")).toBe(false);
    expect(fetchMock.mock.calls[3][1].body).toBe(form);
  });

  it("revokes only its own issued token", async () => {
    const actor = user("issued-token");
    const client = await actingAs(actor);
    await client.dispose();
    expect(actor.removeAccessToken).toHaveBeenCalledExactlyOnceWith("issued-token");
  });

  it("propagates authentication policy failures and refuses an empty token", async () => {
    const actor = user(" ");
    await expect(actingAs(actor)).rejects.toThrow(/non-empty access token/);
    expect(actor.removeAccessToken).toHaveBeenCalledExactlyOnceWith(" ");
    const denied = user("unused");
    denied.generateAccessToken.mockRejectedValueOnce(new Error("account disabled"));
    await expect(actingAs(denied)).rejects.toThrow("account disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
