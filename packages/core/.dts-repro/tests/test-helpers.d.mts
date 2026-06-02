//#region ../../@warlock.js/core/src/tests/test-helpers.d.ts
/**
 * Warlock.js Test Helpers
 *
 * Utilities for testing Warlock.js applications.
 */
/**
 * Get the test server base URL
 */
declare function getTestServerUrl(): string;
/**
 * Simple HTTP request helper for test server
 * Uses native fetch - lightweight, no extra dependencies
 */
declare function testRequest(path: string, options?: RequestInit): Promise<Response>;
/**
 * GET request helper
 */
declare function testGet(path: string, options?: RequestInit): Promise<Response>;
/**
 * POST request helper
 */
declare function testPost(path: string, body?: unknown, options?: RequestInit): Promise<Response>;
/**
 * PUT request helper
 */
declare function testPut(path: string, body?: unknown, options?: RequestInit): Promise<Response>;
/**
 * DELETE request helper
 */
declare function testDelete(path: string, options?: RequestInit): Promise<Response>;
/**
 * PATCH request helper
 */
declare function testPatch(path: string, body?: unknown, options?: RequestInit): Promise<Response>;
/**
 * Parse JSON response with type safety
 */
declare function parseJsonResponse<T>(response: Response): Promise<T>;
/**
 * Assert response status and return parsed JSON
 */
declare function expectJson<T>(response: Response, expectedStatus?: number): Promise<T>;
//#endregion
export { expectJson, getTestServerUrl, parseJsonResponse, testDelete, testGet, testPatch, testPost, testPut, testRequest };
//# sourceMappingURL=test-helpers.d.mts.map