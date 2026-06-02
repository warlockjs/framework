import { ltrim, rtrim } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/utils/urls.ts
let baseUrl = "";
/**
* Set base url
*/
function setBaseUrl(url) {
	baseUrl = url;
}
/**
* Get full path for the given path
*/
function url(path = "") {
	return rtrim(baseUrl, "/") + "/" + ltrim(path, "/");
}
/**
* Get uploads url
*/
function uploadsUrl(path = "") {
	return url("/uploads/" + ltrim(path, "/"));
}
/**
* Get full path for the given path related to public route
*/
function publicUrl(path = "") {
	return url("/public/" + ltrim(path, "/"));
}
/**
* Assets url
*/
function assetsUrl(path = "") {
	return publicUrl("/assets/" + ltrim(path, "/"));
}
//#endregion
export { assetsUrl, publicUrl, setBaseUrl, uploadsUrl, url };

//# sourceMappingURL=urls.mjs.map