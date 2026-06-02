import { config } from "../config/config-getter.mjs";
import "../config/index.mjs";
//#region ../../@warlock.js/core/src/tests/test-helpers.ts
/**
* Warlock.js Test Helpers
*
* Utilities for testing Warlock.js applications.
*/
/**
* Get the test server base URL
*/
function getTestServerUrl() {
	const port = config.key("http.port", 2031);
	return `http://${config.key("http.host", "localhost")}:${port}`;
}
/**
* Simple HTTP request helper for test server
* Uses native fetch - lightweight, no extra dependencies
*/
async function testRequest(path, options = {}) {
	const baseUrl = getTestServerUrl();
	const url = path.startsWith("/") ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
	return fetch(url, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options.headers
		}
	});
}
/**
* GET request helper
*/
async function testGet(path, options = {}) {
	return testRequest(path, {
		...options,
		method: "GET"
	});
}
/**
* POST request helper
*/
async function testPost(path, body, options = {}) {
	return testRequest(path, {
		...options,
		method: "POST",
		body: body ? JSON.stringify(body) : void 0
	});
}
/**
* PUT request helper
*/
async function testPut(path, body, options = {}) {
	return testRequest(path, {
		...options,
		method: "PUT",
		body: body ? JSON.stringify(body) : void 0
	});
}
/**
* DELETE request helper
*/
async function testDelete(path, options = {}) {
	return testRequest(path, {
		...options,
		method: "DELETE"
	});
}
/**
* PATCH request helper
*/
async function testPatch(path, body, options = {}) {
	return testRequest(path, {
		...options,
		method: "PATCH",
		body: body ? JSON.stringify(body) : void 0
	});
}
/**
* Parse JSON response with type safety
*/
async function parseJsonResponse(response) {
	return response.json();
}
/**
* Assert response status and return parsed JSON
*/
async function expectJson(response, expectedStatus = 200) {
	if (response.status !== expectedStatus) {
		const text = await response.text();
		throw new Error(`Expected status ${expectedStatus}, got ${response.status}. Body: ${text}`);
	}
	return parseJsonResponse(response);
}
//#endregion
export { expectJson, getTestServerUrl, parseJsonResponse, testDelete, testGet, testPatch, testPost, testPut, testRequest };

//# sourceMappingURL=test-helpers.mjs.map