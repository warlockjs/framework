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
 */
export function renderReactMail(element: React.ReactElement | React.ComponentType): string {
  const content = renderReact(element);

  return createHtmlPage(content);
}
