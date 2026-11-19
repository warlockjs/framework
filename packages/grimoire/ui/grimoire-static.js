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
      const wordsOf = (value) =>
        value
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean);
      const tokens = wordsOf(text);
      for (const item of data.search) {
        const id = item.id.toLowerCase();
        const detail = (item.detail ?? "").toLowerCase();
        const written = item.type === "feature" || item.type === "flow";
        const body = written && item.text ? wordsOf(item.text) : [];
        // Written text matches whole words (a short token must equal a word), so "5" finds AC-5 and not AC-15.
        const inBody =
          tokens.length > 0 &&
          body.length > 0 &&
          tokens.every((token) =>
            body.some((word) => (token.length >= 3 ? word.startsWith(token) : word === token)),
          );
        let score =
          id === text
            ? 4
            : id.startsWith(text)
              ? 3
              : id.includes(text)
                ? 2
                : detail.includes(text) || inBody
                  ? 1
                  : 0;
        // Written content ranks above files and exports of the same match.
        if (text && score && written) score += 2;
        if (text && score) hits.push({ ...item, text: undefined, score });
      }
      hits.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
      // Features and flows keep a share of the limit, so files never push them out; the list is grouped by type.
      const order = [
        "feature",
        "flow",
        "block",
        "page",
        "screen",
        "route",
        "mail",
        "job",
        "file",
        "export",
        "task",
      ];
      const writtenHits = hits
        .filter((hit) => hit.type === "feature" || hit.type === "flow")
        .slice(0, Math.max(1, Math.ceil(limit * 0.75)));
      const chosen = new Set(writtenHits);
      for (const hit of hits) {
        if (chosen.size >= limit) break;
        chosen.add(hit);
      }
      const counts = {};
      for (const hit of hits) counts[hit.type] = (counts[hit.type] ?? 0) + 1;
      return {
        type: "search",
        text,
        counts,
        hits: [...chosen]
          .sort(
            (left, right) =>
              order.indexOf(left.type) - order.indexOf(right.type) ||
              right.score - left.score ||
              left.id.localeCompare(right.id),
          )
          .map(({ text: _text, ...hit }) => hit),
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
      else if (/^on[a-z]+$/i.test(key)) {
        // Only a real function becomes a listener; a string `on*` attribute is never set (it would be script).
        if (typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value);
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
