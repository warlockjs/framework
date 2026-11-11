import { afterEach, describe, expect, it, vi } from "vitest";

const configValues = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("@warlock.js/core", async () =>
  (await import("../test-support/fake-core")).fakeCoreModule(configValues),
);
vi.mock("@warlock.js/logger", () => ({ log: { warn: vi.fn(), error: vi.fn() } }));

import type { AuthProvider } from "../contracts/providers";
import { InvalidProviderCallbackError } from "../errors/invalid-provider-callback.error";
import { AppleProvider } from "./apple-provider";
import { DiscordProvider } from "./discord-provider";
import { FacebookProvider } from "./facebook-provider";
import { GitHubProvider } from "./github-provider";
import { LinkedInProvider } from "./linkedin-provider";
import { XProvider } from "./x-provider";

const oauth = { clientId: "id", clientSecret: "secret", redirectUri: "https://app.test/cb" };

/** Providers whose first callback request is a plain token exchange. */
const exchangeFirst: Array<[string, (timeoutMs?: number) => AuthProvider]> = [
  ["GitHub", (timeoutMs) => new GitHubProvider({ ...oauth, timeoutMs })],
  ["Discord", (timeoutMs) => new DiscordProvider({ ...oauth, timeoutMs })],
  ["Facebook", (timeoutMs) => new FacebookProvider({ ...oauth, timeoutMs })],
  ["X", (timeoutMs) => new XProvider({ ...oauth, timeoutMs })],
  ["LinkedIn", (timeoutMs) => new LinkedInProvider({ ...oauth, timeoutMs })],
];

/** A provider endpoint that never answers, but stops when its request is aborted. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider request deadlines", () => {
  it.each(exchangeFirst)(
    "%s: a token endpoint that never answers fails the callback within timeoutMs",
    async (_name, build) => {
      const fetch = hangingFetch();
      vi.stubGlobal("fetch", fetch);

      const error = await build(20)
        .handleCallback({
          query: { code: "code-1" },
          expected: { state: "s", nonce: "n", codeVerifier: "v" },
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidProviderCallbackError);
      expect((error as InvalidProviderCallbackError).reason).toBe("code-exchange-failed");
      expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    },
  );

  it.each([
    ...exchangeFirst,
    [
      "Apple",
      (timeoutMs?: number) =>
        new AppleProvider({
          clientId: "id",
          teamId: "team",
          keyId: "key",
          privateKey: "pem",
          redirectUri: "https://app.test/cb",
          timeoutMs,
        }),
    ] as [string, (timeoutMs?: number) => AuthProvider],
  ])("%s: refuses an unusable timeoutMs at construction", (name, build) => {
    expect(() => build(0)).toThrow(`${name} provider timeoutMs`);
    expect(() => build(1.5)).toThrow("timeoutMs");
    expect(() => build()).not.toThrow();
  });
});
