/**
 * The DOM helpers a package panel's view module receives (`el`, `svg`,
 * `empty`) and the URL helpers behind `api`, `href` and `asset`. Ported from
 * the 5.55.0 dashboard unchanged, so existing view modules keep working.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, unknown>;

function fill(node: Element, attrs: Attrs, children: unknown): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;

    if (key === "class" && node instanceof HTMLElement) node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value as EventListener);
    } else node.setAttribute(key, String(value));
  }

  for (const child of Array.isArray(children) ? children : [children]) {
    if (child !== null && child !== undefined) node.append(child as Node | string);
  }
}

/** Creates an HTML element: `class`, `text`, `on<event>` and other attributes, then the children. */
export function el(tag: string, attrs: Attrs = {}, children: unknown = []): HTMLElement {
  const node = document.createElement(tag);

  fill(node, attrs, children);

  return node;
}

/** Like `el()`, for SVG elements (graphs drawn by panels). */
export function svg(tag: string, attrs: Attrs = {}, children: unknown = []): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);

  fill(node, attrs, children);

  return node;
}

/** A paragraph styled as an empty-state note. */
export function empty(message: string): HTMLElement {
  return el("p", { class: "empty", text: message });
}

/** A panel's data URL: `""`, `"search?q=x"`, `"/flows/a"` and `"?page=2"` all resolve under `api/<id>`. */
export function panelApiUrl(id: string, path = ""): string {
  const suffix = !path || path.startsWith("/") || path.startsWith("?") ? path : `/${path}`;

  return `api/${id}${suffix}`;
}

/** The link to one of a panel's views: `#<id>` or `#<id>/<route>`. */
export function panelHref(id: string, route = ""): string {
  return `#${id}${route ? `/${route}` : ""}`;
}
