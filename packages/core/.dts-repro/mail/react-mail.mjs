import { renderReact } from "../react/index.mjs";
//#region ../../@warlock.js/core/src/mail/react-mail.ts
/**
* Create a complete HTML page from rendered content
*/
function createHtmlPage(html) {
	const styles = [];
	const links = [];
	const body = html.replace(/<style.*?<\/style>|<link.*?>/gims, (match) => {
		if (match.startsWith("<style")) styles.push(match);
		else links.push(match);
		return "";
	});
	return `<!doctype html><html>${`<head>${links.join("")}${styles.join("")}</head>`}<body>${body}</body></html>`;
}
/**
* Render a React element to HTML for email
*
* - Uses @react-email/render when installed (full react-email pipeline)
* - Falls back to react-dom/server renderToStaticMarkup otherwise
*
* **Note:** This function requires React packages to be installed.
* Install them with: `warlock add react` or `npm install react react-dom`
*/
async function renderReactMail(element) {
	const React = await import("react");
	const reactElement = typeof element === "function" ? React.createElement(element) : element;
	try {
		const { render } = await import("@react-email/render");
		return await render(reactElement);
	} catch {
		return createHtmlPage(renderReact(reactElement));
	}
}
//#endregion
export { renderReactMail };

//# sourceMappingURL=react-mail.mjs.map