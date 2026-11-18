/**
 * The static export's loader: it gives the Grimoire view a context whose
 * `api()` reads the data embedded in the page instead of fetching, and mounts
 * the view into one element. The exporter inlines this file after the view
 * module, so `renderGrimoire` is in scope. There are no imports or exports.
 */

const GRIMOIRE_STATIC_SVG = "http://www.w3.org/2000/svg";
const GRIMOIRE_STATIC_NEEDS_APP =
  "This answer needs the running app. Open the Grimoire tab in devtools.";

/** The `api()` of the static page: `data.routes` by name, `data.files` by path, search over `data.search`. */
function grimoireStaticApi(data) {
  const decode = (text) => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };

  return async (path = "") => {
    const [pathname = "", query = ""] = path.split("?");
    const params = new URLSearchParams(query);
    let name = pathname.replace(/^\//, "").split("/").map(decode).join("/");

    if (name === "search") {
      const text = (params.get("q") ?? "").trim().toLowerCase();
      const limit = Number(params.get("limit")) || 20;
      const hits = [];
      for (const item of data.search) {
        const id = item.id.toLowerCase();
        const detail = (item.detail ?? "").toLowerCase();
        const score =
          id === text
            ? 4
            : id.startsWith(text)
              ? 3
              : id.includes(text)
                ? 2
                : detail.includes(text)
                  ? 1
                  : 0;
        if (text && score) hits.push({ ...item, score });
      }
      hits.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
      return {
        type: "search",
        text,
        hits: hits.slice(0, limit),
        routes: data.routes.summary?.routes ?? "cached",
        notes: [],
      };
    }

    if (name === "file" || name === "graph/file") {
      const file = params.get("path") ?? "";
      const found = Object.prototype.hasOwnProperty.call(data.files, file)
        ? data.files[file]
        : undefined;
      if (!found) throw new Error(`"${params.get("path")}" is not in the exported book.`);
      return name === "file" ? found.result : found.graph;
    }

    if (name === "graph/page") {
      name = `graph/page/${params.get("app")}/${params.get("page")}`;
    }

    if (Object.prototype.hasOwnProperty.call(data.routes, name)) return data.routes[name];
    throw new Error(GRIMOIRE_STATIC_NEEDS_APP);
  };
}

/** The context the view gets in the static page. `route` is the hash after `#grimoire/`. */
function grimoireStaticContext(data, root, rerender) {
  const hash = location.hash.slice(1);
  const route = hash.startsWith("grimoire/") ? hash.slice("grimoire/".length) : "";
  const apply = (node, attrs) => {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue;
      if (key === "class") node.setAttribute("class", value);
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
  };
  const build = (node, attrs, children) => {
    apply(node, attrs);
    for (const child of Array.isArray(children) ? children : [children]) node.append(child);
    return node;
  };
  const el = (tag, attrs = {}, children = []) =>
    build(document.createElement(tag), attrs, children);

  return {
    id: "grimoire",
    root,
    route,
    api: grimoireStaticApi(data),
    href: (target = "") => `#grimoire${target ? `/${target}` : ""}`,
    navigate(target) {
      const next = `#grimoire${target ? `/${target}` : ""}`;
      if (location.hash === next) rerender();
      else location.hash = next;
    },
    refresh: rerender,
    // Screenshots sit next to index.html, in the same folder layout as grimoire/screenshots/.
    file: (src) => `screenshots/${String(src).split("/").map(encodeURIComponent).join("/")}`,
    shared: false,
    share: null,
    el,
    svg: (tag, attrs = {}, children = []) =>
      build(document.createElementNS(GRIMOIRE_STATIC_SVG, tag), attrs, children),
    empty: (message) => el("p", { class: "empty", text: message }),
  };
}

/** Render the view into `container` now and again when the hash changes. Called from the exported page, which inlines this file. */
// oxlint-disable-next-line eslint/no-unused-vars -- called by the inlined bootstrap line of the static export.
function grimoireStaticMount(data, container, render) {
  let version = 0;
  async function show() {
    const mine = ++version;
    const root = document.createElement("section");
    root.setAttribute("class", "panel");
    root.setAttribute("data-panel", "grimoire");
    try {
      const view = await render(grimoireStaticContext(data, root, show));
      if (mine !== version) return;
      container.replaceChildren(view ?? root);
    } catch (error) {
      const message = document.createElement("p");
      message.setAttribute("class", "error");
      message.textContent = `Could not load this view: ${error.message}`;
      container.replaceChildren(message);
    }
  }
  window.addEventListener("hashchange", show);
  return show();
}
