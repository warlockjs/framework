import type React from "react";
import { renderReact } from "../react";

/**
 * Create a complete HTML page from rendered content
 */
function createHtmlPage(html: string): string {
  const styles: string[] = [];
  const links: string[] = [];

  const body = html.replace(/<style.*?<\/style>|<link.*?>/gims, (match: string) => {
    if (match.startsWith("<style")) {
      styles.push(match);
    } else {
      links.push(match);
    }
    return "";
  });

  const head = `<head>${links.join("")}${styles.join("")}</head>`;

  return `<!doctype html><html>${head}<body>${body}</body></html>`;
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
export async function renderReactMail(
  element: React.ReactElement | React.ComponentType,
): Promise<string> {
  const React = await import("react");
  const reactElement = typeof element === "function" ? React.createElement(element) : element;

  let render: typeof import("@react-email/render").render;

  try {
    ({ render } = await import("@react-email/render"));
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;

    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
      throw error;
    }

    // @react-email/render not installed — graceful fallback
    const content = renderReact(reactElement);
    return createHtmlPage(content);
  }

  // A throwing component must surface its real error, not fall back silently
  return await render(reactElement as React.ReactElement);
}
