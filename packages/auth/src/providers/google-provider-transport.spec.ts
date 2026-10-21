import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { GoogleProviderConfig } from "../contracts/providers";
import type { JoseModule } from "./google-provider";

vi.mock("@warlock.js/core", async () =>
  (await import("../test-support/fake-core")).fakeCoreModule({}),
);
vi.mock("../services/optional-peer", () => ({ loadOptionalPeer: async () => jose }));

import { GoogleProvider } from "./google-provider";

type Signer = {
  setProtectedHeader(header: Record<string, string>): Signer;
  setIssuer(issuer: string): Signer;
  setAudience(audience: string): Signer;
  setExpirationTime(expiry: string): Signer;
  sign(key: CryptoKey): Promise<string>;
};
type SigningJose = JoseModule & {
  generateKeyPair(algorithm: string): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;
  exportJWK(key: CryptoKey): Promise<Record<string, unknown>>;
  SignJWT: new (claims: Record<string, unknown>) => Signer;
};
let jose: SigningJose;
let privateKey: CryptoKey;
let jwks: { keys: Record<string, unknown>[] };
const expected = { state: "state", nonce: "nonce", codeVerifier: "secret-verifier" };
const endpoints = {
  authorization: "https://provider.test/authorize",
  token: "https://provider.test/token",
  jwks: "https://provider.test/keys",
};
const settings: GoogleProviderConfig = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://example.test/callback",
  endpoints,
};

beforeAll(async () => {
  const store = resolve(__dirname, "../../../../node_modules/.pnpm");
  const entry = readdirSync(store).find((name) => name.startsWith("jose@"));
  if (!entry) throw new Error("Install the jose optional peer to run provider specs");
  jose = (await import(
    pathToFileURL(resolve(store, entry, "node_modules/jose/dist/webapi/index.js")).href
  )) as SigningJose;
  const pair = await jose.generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwks = { keys: [{ ...(await jose.exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" }] };
});

async function signedToken(
  claims: Record<string, unknown> = {},
  issuer = "https://accounts.google.com",
  audience = "client",
) {
  return new jose.SignJWT({ sub: "subject", nonce: expected.nonce, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(privateKey);
}

function transport(token: string): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === endpoints.token) {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("code_verifier")).toBe(expected.codeVerifier);
      expect(form.get("code")).toBe("code");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ id_token: token });
    }
    expect(String(input)).toBe(endpoints.jwks);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return Response.json(jwks);
  });
}

const callback = (provider: GoogleProvider) =>
  provider.handleCallback({ query: { code: "code" }, expected });

describe("Google provider transport", () => {
  it("uses controlled endpoints and the injected transport with real signature verification and PKCE", async () => {
    const fetch = transport(await signedToken());
    const provider = new GoogleProvider({ ...settings, fetch });
    const url = new URL(provider.authorizationUrl(expected));
    expect(url.origin + url.pathname).toBe(endpoints.authorization);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    await expect(callback(provider)).resolves.toMatchObject({ providerUserId: "subject" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["issuer", "audience", "nonce", "signature"])(
    "keeps %s validation with injected endpoints",
    async (invalid) => {
      let token = await signedToken(
        invalid === "nonce" ? { nonce: "wrong" } : {},
        invalid === "issuer" ? "https://provider.test" : undefined,
        invalid === "audience" ? "wrong" : undefined,
      );
      if (invalid === "signature") {
        const parts = token.split(".");
        parts[2] = "invalid-signature";
        token = parts.join(".");
      }
      await expect(
        callback(new GoogleProvider({ ...settings, fetch: transport(token) })),
      ).rejects.toMatchObject({
        reason: invalid === "nonce" ? "nonce-mismatch" : "invalid-id-token",
      });
    },
  );

  it.each(["token", "jwks"] as const)("aborts a stalled %s endpoint", async (endpoint) => {
    const working = transport(await signedToken());
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) !== endpoints[endpoint]) return working(input, init);
      const signal = init?.signal;
      if (!signal) throw new Error("Missing deadline");
      return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    // AbortSignal.timeout uses an unreferenced timer; keep this spec alive and
    // fail boundedly if a regression removes the signal.
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error("Provider did not abort")), 1000);
    });
    try {
      await expect(
        Promise.race([callback(new GoogleProvider({ ...settings, fetch, timeoutMs: 20 })), guard]),
      ).rejects.toMatchObject({
        reason: endpoint === "token" ? "code-exchange-failed" : "invalid-id-token",
      });
    } finally {
      clearTimeout(deadline);
    }
  });

  it.each([0, -1, NaN, Infinity, 1.5, 2_147_483_648])(
    "rejects an unbounded deadline: %s",
    (timeoutMs) => {
      expect(() => new GoogleProvider({ ...settings, timeoutMs })).toThrow(/timeoutMs/);
    },
  );
});
