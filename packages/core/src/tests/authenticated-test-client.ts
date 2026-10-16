import { testDelete, testGet, testPatch, testPost, testPut, testRequest } from "./test-helpers";

/** Structural auth contract: an Auth model satisfies this without a runtime auth import. */
export interface TestAuthenticableUser {
  generateAccessToken(): Promise<{ token: string }>;
  removeAccessToken(token: string): Promise<void>;
}

/** An isolated HTTP client using one real issued access token. */
export type AuthenticatedTestClient = {
  request: typeof testRequest;
  get: typeof testGet;
  post: typeof testPost;
  put: typeof testPut;
  patch: typeof testPatch;
  delete: typeof testDelete;
  /** Revoke only this client's token; fixtures still own their user/data cleanup. */
  dispose(): Promise<void>;
};

/**
 * Issue a real persisted access token and bind it to this client's requests.
 * Authentication middleware still verifies every request; no globals or bypasses
 * are installed. The bound identity takes precedence over per-request headers.
 */
export async function actingAs(user: TestAuthenticableUser): Promise<AuthenticatedTestClient> {
  const { token } = await user.generateAccessToken();
  if (!token.trim()) throw new Error("actingAs() requires a non-empty access token.");

  const authorized = (options: RequestInit = {}): RequestInit => {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${token}`);
    return { ...options, headers };
  };

  return {
    request: (path, options) => testRequest(path, authorized(options)),
    get: (path, options) => testGet(path, authorized(options)),
    post: (path, body, options) => testPost(path, body, authorized(options)),
    put: (path, body, options) => testPut(path, body, authorized(options)),
    patch: (path, body, options) => testPatch(path, body, authorized(options)),
    delete: (path, options) => testDelete(path, authorized(options)),
    dispose: () => user.removeAccessToken(token),
  };
}
