/**
 * The Grimoire tab: a browser ES module that the devtools dashboard loads
 * (`panels/grimoire/view.js`) and that the static export inlines. It builds
 * the DOM with the context's `el()` and `svg()` helpers and sets every string
 * from the data as text, never as HTML. Hash links look like `#grimoire/flow/<feature>/<flow>`.
 *
 * Keep the last line as it is: the static export swaps it out to inline this file.
 */

/** The tabs: `[route, label]`. */
const TABS = [
  ["product", "Product map"],
  ["", "Overview"],
  ["features", "Features"],
  ["apps", "Apps"],
  ["tasks", "Tasks"],
  ["releases", "Releases"],
  ["check", "Check"],
  ["modules", "Modules"],
];

const SVG_WIDTH = 720;
const SVG_HEIGHT = 440;

/** How long a view may take before the skeleton is shown instead of waiting for it (ms). */
const SKELETON_AFTER = 150;

const BUILD_HINT = "Run warlock grimoire build, then reload.";

/** Decode one hash segment; a malformed escape stays as written. */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The value of a located field (`{ value, at }`), or the field itself. */
function plain(field) {
  return field !== null && typeof field === "object" && "value" in field ? field.value : field;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Which tab a hash route belongs to; `null` when it belongs to none. */
function tabOf(route) {
  const type = (route.split("?")[0] ?? "").split("/")[0] ?? "";

  switch (type) {
    case "product":
      return "product";
    case "features":
    case "feature":
    case "flow":
      return "features";
    case "apps":
    case "page":
      return "apps";
    case "tasks":
    case "task":
      return "tasks";
    case "releases":
    case "release":
      return "releases";
    case "check":
      return "check";
    case "modules":
    case "file":
    case "route":
      return "modules";
    default:
      return "";
  }
}

/** The hash route (without `#grimoire/`) of a search hit or graph node id, or `null`. */
function targetOf(type, id) {
  const encode = encodeURIComponent;

  switch (type) {
    case "feature":
      return `feature/${encode(id)}`;
    case "flow": {
      const [feature, flow] = id.split("/");
      return `flow/${encode(feature ?? "")}/${encode(flow ?? "")}`;
    }
    case "page":
    case "screen": {
      const space = id.indexOf(" ");
      return space < 0 ? null : `page/${encode(id.slice(0, space))}/${encode(id.slice(space + 1))}`;
    }
    case "block": {
      const [app, page] = id.split("/");
      return `page/${encode(app ?? "")}/${encode(page ?? "")}`;
    }
    case "route": {
      const space = id.indexOf(" ");
      return space < 0
        ? null
        : `route/${encode(id.slice(0, space))}/${encode(id.slice(space + 1))}`;
    }
    case "file":
      return `file/${encode(id)}`;
    case "export":
      return `file/${encode(id.split("#")[0] ?? id)}`;
    case "task":
      return `task/${encode(id)}`;
    default:
      return null;
  }
}

/** The target of a graph node id (`file:src/a.ts`, `feature:auth`, …). */
function nodeTarget(id) {
  const colon = id.indexOf(":");
  const type = id.slice(0, colon);
  const rest = id.slice(colon + 1);

  if (type === "file" || type === "feature" || type === "flow") return targetOf(type, rest);
  // A layout has no view of its own: its blocks are listed on each page that uses it.
  if (type === "page") {
    const [app, page] = rest.split("/");
    return `page/${encodeURIComponent(app ?? "")}/${encodeURIComponent(page ?? "")}`;
  }
  if (type === "block") return targetOf("block", rest);
  return null;
}

/** Cut a long label from the front so the end of a path stays visible. */
function shorten(text, max = 26) {
  return text.length > max ? `…${text.slice(text.length - max + 1)}` : text;
}

const NODE_COLOURS = {
  center: "var(--brand)",
  feature: "var(--chart-2)",
  flow: "var(--chart-1)",
  app: "var(--chart-3)",
  block: "var(--chart-4)",
  layout: "var(--muted-foreground)",
  module: "var(--brand)",
  file: "var(--muted-foreground)",
};

// ── Building blocks ─────────────────────────────────────────────────────────

function link(ctx, text, target, attrs = {}) {
  return ctx.el("a", { href: ctx.href(target), text, ...attrs });
}

/** The tone (`good`, `info`, `warn`, `bad`, or none) a status word is shown in. */
function toneOf(status) {
  switch (status) {
    case "shipped":
    case "passing":
    case "pass":
    case "confirmed":
    case "done":
    case "fresh":
    case "cached":
    case "clean":
      return "good";
    case "building":
    case "open":
      return "info";
    case "proposed":
    case "inferred":
    case "warning":
    case "waiting":
    case "stale":
    case "missing":
    case "untested":
    case "not-run":
    case "no-test":
      return "warn";
    case "failing":
    case "fail":
    case "error":
      return "bad";
    default:
      return "";
  }
}

function pill(ctx, text, tone = "") {
  return ctx.el("span", { class: tone ? `grimoire-pill is-${tone}` : "grimoire-pill", text });
}

function mono(ctx, text) {
  return ctx.el("span", { class: "grimoire-mono", text });
}

function muted(ctx, text) {
  return ctx.el("span", { class: "grimoire-muted", text });
}

function list(ctx, items) {
  return ctx.el(
    "ul",
    { class: "grimoire-list" },
    items.map((item) => ctx.el("li", {}, item)),
  );
}

/** A table that scrolls inside its card instead of widening the page. */
function table(ctx, headings, rows) {
  return ctx.el("div", { class: "grimoire-scroll" }, [
    ctx.el("table", { class: "grimoire-table" }, [
      ctx.el("thead", {}, [
        ctx.el(
          "tr",
          {},
          headings.map((heading) => ctx.el("th", { scope: "col", text: heading })),
        ),
      ]),
      ctx.el(
        "tbody",
        {},
        rows.map((row) =>
          ctx.el(
            "tr",
            {},
            row.map((cell, column) =>
              ctx.el("td", { "data-label": headings[column] ?? "" }, cell),
            ),
          ),
        ),
      ),
    ]),
  ]);
}

/** A card with a heading. */
function section(ctx, title, children = []) {
  return ctx.el("section", { class: "grimoire-card" }, [
    ctx.el("h3", { text: title }),
    ...children,
  ]);
}

/** Label and value pairs. */
function facts(ctx, rows) {
  return ctx.el(
    "dl",
    { class: "grimoire-facts" },
    rows.flatMap(([label, value]) => [
      ctx.el("dt", { text: label }),
      ctx.el("dd", {}, value ?? muted(ctx, "none")),
    ]),
  );
}

/** A trail of links back up the hierarchy; the last crumb is the current view. */
function crumbs(ctx, trail) {
  return ctx.el("nav", { class: "grimoire-crumbs", "aria-label": "Breadcrumb" }, [
    ctx.el(
      "ol",
      {},
      trail.map(([label, target], index) =>
        ctx.el("li", {}, [
          index < trail.length - 1 && target !== undefined
            ? link(ctx, label, target)
            : ctx.el("span", { "aria-current": "page", text: label }),
        ]),
      ),
    ),
  ]);
}

/** The title block of a detail view. */
function heading(ctx, title, extras = []) {
  return ctx.el("header", { class: "grimoire-heading" }, [
    ctx.el("h2", { text: title }),
    extras.length ? ctx.el("div", { class: "grimoire-heading-meta" }, extras) : "",
  ]);
}

/** Items as compact chips; past `limit` the rest sits behind a "+N more" button. */
function chipList(ctx, items, make, limit = 8) {
  if (!items.length) return muted(ctx, "none");

  const nodes = items.map(make);
  const holder = ctx.el("div", { class: "grimoire-chips" });
  const more = ctx.el("button", { type: "button", class: "grimoire-more" });
  let open = false;

  const paint = () => {
    const visible = open ? nodes : nodes.slice(0, limit);

    more.textContent = open ? "Show fewer" : `+${nodes.length - limit} more`;
    more.setAttribute("aria-expanded", String(open));
    holder.replaceChildren(...visible, ...(nodes.length > limit ? [more] : []));
  };

  more.addEventListener("click", () => {
    open = !open;
    paint();
  });
  paint();
  return holder;
}

function fileLink(ctx, file) {
  return link(ctx, file, `file/${encodeURIComponent(file)}`, { class: "grimoire-chip" });
}

function fileChips(ctx, files, limit = 8) {
  return chipList(ctx, files, (file) => fileLink(ctx, file), limit);
}

/** `<feature>/<flow>` as a link. */
function flowLink(ctx, ref) {
  const target = targetOf("flow", ref);
  return target === null ? ref : link(ctx, ref, target);
}

function routeLink(ctx, method, path) {
  return link(
    ctx,
    `${method} ${path}`,
    `route/${encodeURIComponent(method)}/${encodeURIComponent(path)}`,
  );
}

/** Split a hash route into its path and its query (`check?code=GR3006&feature=cart`). */
function parseRoute(route) {
  const at = route.indexOf("?");
  const query = {};

  if (at >= 0) {
    for (const [key, value] of new URLSearchParams(route.slice(at + 1))) query[key] = value;
  }

  return { path: at < 0 ? route : route.slice(0, at), query };
}

/** The hash route of the Check tab for a filter; empty values are left out. */
function checkTarget(filter) {
  const params = new URLSearchParams();

  for (const key of ["code", "feature", "flow", "severity", "state", "offset", "limit"]) {
    const value = filter[key];

    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }

  const text = params.toString();

  return text ? `check?${text}` : "check";
}

/**
 * Text with `` `code` `` spans as nodes: plain strings and `<code>` elements.
 * Every part is set as text. Unbalanced backticks stay as written.
 */
function codeText(ctx, text) {
  const value = String(text ?? "");

  if (!value.includes("`")) return value;

  const parts = value.split("`");

  if (parts.length % 2 === 0) return value;

  return parts
    .map((part, index) =>
      index % 2 === 1 ? ctx.el("code", { class: "grimoire-code", text: part }) : part,
    )
    .filter((part) => part !== "");
}

/** The reason of a "does not apply" case, without the words the view groups it under. */
function stripDoesNotApply(answer) {
  const rest = String(answer ?? "")
    .replace(/^does not apply\b[:\s—-]*/i, "")
    .trim();

  return rest || "no reason written";
}

/** Select a node's text so the reader can copy it by hand. */
function selectNode(node, done) {
  try {
    const selection = globalThis.getSelection?.();
    const range = globalThis.document?.createRange?.();

    if (selection && range) {
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
      done("Selected. Press Ctrl+C to copy.");
      return;
    }
  } catch {
    // Fall through to the plain message.
  }

  done("Select the line and copy it by hand.");
}

/** Copy text with the clipboard API; fall back to selecting `node`. Never throws. */
function copyText(text, node, done) {
  try {
    const clipboard = globalThis.navigator?.clipboard;

    if (clipboard && typeof clipboard.writeText === "function") {
      Promise.resolve(clipboard.writeText(text)).then(
        () => done("Copied."),
        () => selectNode(node, done),
      );
      return;
    }
  } catch {
    // Fall through to selecting.
  }

  selectNode(node, done);
}

const STEP_ICONS = {
  page: [["rect", { x: "3", y: "4", width: "18", height: "14", rx: "2" }], ["path", { d: "M3 9h18" }]],
  route: [["path", { d: "M5 12h14M13 6l6 6-6 6" }]],
  mail: [["rect", { x: "3", y: "5", width: "18", height: "14", rx: "2" }], ["path", { d: "M3 7l9 6 9-6" }]],
  notification: [["path", { d: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" }]],
  job: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M12 7v5l3 2" }]],
  event: [["path", { d: "M13 2L4 14h7l-1 8 9-12h-7z" }]],
  "outside service": [["path", { d: "M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 0 1 17 18z" }]],
  affects: [
    ["path", { d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" }],
  ],
};

/** A small icon for a flow step type. */
function stepIcon(ctx, type) {
  const { svg } = ctx;
  const shapes = STEP_ICONS[type] ?? STEP_ICONS.route;

  return svg(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: "18",
      height: "18",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "grimoire-step-icon",
    },
    shapes.map(([tag, attrs]) => svg(tag, attrs)),
  );
}

/** Show a node's children only while open; the content is built on the first open. */
function expander(ctx, label, make) {
  const panel = ctx.el("div", { class: "grimoire-expand" });
  let node = null;
  let open = false;
  const button = ctx.el("button", {
    type: "button",
    class: "grimoire-more",
    "aria-expanded": "false",
    text: label,
    onclick: () => {
      open = !open;
      if (open && node === null) node = make();
      panel.replaceChildren(...(open && node ? [node] : []));
      button.setAttribute("aria-expanded", String(open));
      button.textContent = open ? "Hide" : label;
    },
  });

  return { button, panel };
}

/**
 * Findings loaded page by page from the check route: `filter` is a
 * `GrimoireCheckFilter`; "Load more" appends the next page.
 */
function pagedFindings(ctx, filter, options = {}) {
  const { el } = ctx;
  const size = options.size ?? 20;
  const list = el("ul", { class: "grimoire-findings" });
  const status = el("p", { class: "grimoire-muted", role: "status" });
  const more = el("button", { type: "button", class: "grimoire-filter", text: "Load more" });
  const holder = el("div", { class: "grimoire-paged" });
  let offset = 0;
  let busy = false;

  function paint(total, failed) {
    status.textContent = failed
      ? `Could not load the findings: ${failed}. Try again.`
      : `Showing ${offset} of ${total}`;
    more.textContent = failed ? "Try again" : `Load ${Math.min(size, total - offset)} more`;
    holder.replaceChildren(list, status, failed || offset < total ? more : "");
  }

  async function load() {
    if (busy) return;
    busy = true;

    try {
      const page = await ctx.api(checkTarget({ ...filter, offset, limit: size }));

      for (const finding of page.findings) list.append(findingItem(ctx, finding, options));
      offset += page.findings.length;
      paint(page.total, null);
    } catch (error) {
      paint(0, error && error.message ? error.message : String(error));
    }

    busy = false;
  }

  more.addEventListener("click", load);
  holder.append(el("p", { class: "grimoire-muted", role: "status", text: "Loading findings…" }));
  load();
  return holder;
}

/**
 * A filterable, sortable listing: a text box, status buttons with counts, an
 * optional sort menu and an "N of M" line. `render(shown)` returns the one
 * node that fills the body each time the filters change.
 */
function listing(ctx, options) {
  const { el } = ctx;
  const { items, noun, render } = options;
  const state = { text: "", status: "", sort: options.sorts?.[0]?.[0] ?? "" };
  const body = el("div", { class: "grimoire-listing-body" });
  const count = el("p", {
    class: "grimoire-listing-count",
    role: "status",
    "aria-live": "polite",
  });
  const buttons = [];
  const bar = el("div", { class: "grimoire-toolbar" });

  bar.append(
    el("input", {
      type: "search",
      class: "grimoire-filter-input",
      placeholder: `Filter ${noun}`,
      "aria-label": `Filter ${noun}`,
      oninput: (event) => {
        state.text = event.target.value;
        paint();
      },
    }),
  );

  if (options.statusOf) {
    const found = [...new Set(items.map(options.statusOf))];
    const order = options.statusOrder ?? [];
    const statuses = found.sort(
      (left, right) =>
        (order.indexOf(left) < 0 ? 99 : order.indexOf(left)) -
          (order.indexOf(right) < 0 ? 99 : order.indexOf(right)) || left.localeCompare(right),
    );

    if (statuses.length > 1) {
      const group = el("div", { class: "grimoire-filters", role: "group", "aria-label": "Status" });

      for (const status of ["", ...statuses]) {
        const total = status
          ? items.filter((item) => options.statusOf(item) === status).length
          : items.length;
        const button = el("button", {
          type: "button",
          class: "grimoire-filter",
          "aria-pressed": "false",
          text: `${status || "all"} ${total}`,
          onclick: () => {
            state.status = status;
            paint();
          },
        });

        buttons.push([button, status]);
        group.append(button);
      }

      bar.append(group);
    }
  }

  if (options.sorts && options.sorts.length > 1) {
    bar.append(
      el(
        "select",
        {
          class: "grimoire-sort",
          "aria-label": "Sort",
          onchange: (event) => {
            state.sort = event.target.value;
            paint();
          },
        },
        options.sorts.map(([key, label]) => el("option", { value: key, text: `Sort: ${label}` })),
      ),
    );
  }

  function paint() {
    const query = state.text.trim().toLowerCase();
    let shown = items.filter(
      (item) =>
        (!state.status || options.statusOf(item) === state.status) &&
        (!query || options.textOf(item).toLowerCase().includes(query)),
    );
    const sort = options.sorts?.find(([key]) => key === state.sort);

    if (sort) shown = [...shown].sort(sort[2]);

    for (const [button, status] of buttons) {
      button.setAttribute("aria-pressed", String(status === state.status));
    }

    count.textContent = `${shown.length} of ${items.length} ${noun}`;
    body.replaceChildren(
      shown.length
        ? render(shown, items)
        : ctx.empty(`No ${noun} match these filters. Clear the filter to see all ${items.length}.`),
    );
  }

  paint();
  return el("div", { class: "grimoire-listing" }, [bar, count, body]);
}

/** One finding: severity, code, message, what to do (unless `hints` is `false`), and where. */
function findingItem(ctx, finding, options = {}) {
  const place = finding.at ? `${finding.at.file}:${finding.at.line}` : null;
  const file = finding.subject.file;

  return ctx.el("li", { class: "grimoire-finding" }, [
    ctx.el("div", { class: "grimoire-finding-head" }, [
      pill(ctx, finding.severity, toneOf(finding.severity)),
      finding.expected ? pill(ctx, "expected") : "",
      mono(ctx, finding.code),
    ]),
    ctx.el("p", { class: "grimoire-finding-message" }, codeText(ctx, finding.message)),
    finding.hint && options.hints !== false
      ? ctx.el("p", { class: "grimoire-muted" }, codeText(ctx, finding.hint))
      : "",
    place || file
      ? ctx.el("div", { class: "grimoire-chips" }, [
          place ? mono(ctx, place) : "",
          file && file !== finding.at?.file ? fileLink(ctx, file) : "",
        ])
      : "",
  ]);
}

/** A list of findings: severity, code, message, what to do, and where. */
function findingList(ctx, findings, options = {}) {
  return ctx.el(
    "ul",
    { class: "grimoire-findings" },
    findings.map((finding) => findingItem(ctx, finding, options)),
  );
}

function changesView(ctx, changes) {
  if (!changes.length) return ctx.empty("No changelog entries.");
  return list(
    ctx,
    changes.map((change) => [
      pill(ctx, change.word),
      ` ${plain(change.version)} `,
      change.flow ? [flowLink(ctx, `${change.feature}/${change.flow}`), " "] : "",
      codeText(ctx, change.text),
      change.release
        ? ` (release ${change.release}${change.date ? `, ${change.date}` : ""})`
        : " (not released)",
    ]),
  );
}

// ── Graphs ──────────────────────────────────────────────────────────────────

/** Plain SVG for a graph answer: the centre node in the middle, the others on one or two rings. */
function graphView(ctx, graph, title) {
  const { el, svg, empty, href } = ctx;
  const card = el("section", { class: "grimoire-card grimoire-graph" }, [
    el("h3", { text: title }),
  ]);

  if (!graph.nodes.length) {
    card.append(empty("Nothing to draw."));
    return card;
  }

  const centre = graph.nodes.find((node) => node.type === "center");
  const others = graph.nodes.filter((node) => node !== centre);
  const place = new Map();
  const middleX = SVG_WIDTH / 2;
  const middleY = SVG_HEIGHT / 2;

  if (centre) place.set(centre.id, [middleX, middleY]);

  const inner = centre ? Math.min(others.length, 18) : 0;
  const rings = centre ? [others.slice(0, inner), others.slice(inner)] : [others, []];
  rings.forEach((ring, index) => {
    const radiusX = centre ? (index === 0 ? 210 : 320) : 300;
    const radiusY = centre ? (index === 0 ? 150 : 195) : 185;
    ring.forEach((node, position) => {
      const angle =
        (position / Math.max(ring.length, 1)) * 2 * Math.PI - Math.PI / 2 + index * 0.15;
      place.set(node.id, [
        middleX + radiusX * Math.cos(angle),
        middleY + radiusY * Math.sin(angle),
      ]);
    });
  });

  const canvas = svg("svg", {
    viewBox: `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`,
    class: "grimoire-svg",
    role: "img",
    "aria-label": title,
  });

  for (const edge of graph.edges) {
    const from = place.get(edge.from);
    const to = place.get(edge.to);
    if (!from || !to) continue;
    canvas.append(
      svg("line", {
        x1: from[0].toFixed(1),
        y1: from[1].toFixed(1),
        x2: to[0].toFixed(1),
        y2: to[1].toFixed(1),
        stroke: "var(--input)",
        "stroke-width": edge.weight ? String(Math.min(1 + Math.log2(edge.weight), 5)) : "1.2",
      }),
    );
  }

  // Labels overlap on a crowded ring: stagger them, and past 40 nodes name only the centre
  // (every node keeps its tooltip, and the module list sits under the graph).
  const labelled = graph.nodes.length <= 40;

  for (const [position, node] of graph.nodes.entries()) {
    const at = place.get(node.id);
    if (!at) continue;
    const target = nodeTarget(node.id);
    const circle = svg("circle", {
      cx: at[0].toFixed(1),
      cy: at[1].toFixed(1),
      r: node.type === "center" ? "9" : "6",
      fill: NODE_COLOURS[node.type] ?? "var(--muted-foreground)",
    });
    const label = svg("text", {
      x: at[0].toFixed(1),
      y: (at[1] + (node.type === "center" ? 24 : 18 + (position % 2) * 12)).toFixed(1),
      "text-anchor": "middle",
      fill: "var(--foreground)",
      "font-size": "11",
      text: shorten(node.label, node.type === "center" ? 26 : 16),
    });
    const group = svg(
      "g",
      {},
      [svg("title", { text: node.label }), circle, labelled || node.type === "center" ? label : ""].filter(
        (child) => child !== "",
      ),
    );
    canvas.append(target === null ? group : svg("a", { href: href(target) }, [group]));
  }

  card.append(el("div", { class: "grimoire-scroll" }, [canvas]));
  if (!labelled) {
    card.append(
      el("p", {
        class: "grimoire-muted",
        text: "Too many nodes to label. Point at a node for its name; every module is listed below.",
      }),
    );
  }
  return card;
}

// ── Views ───────────────────────────────────────────────────────────────────

/** One overview card: a number, what it counts, and where it leads. */
function stat(ctx, { label, value, sub, target, tone = "" }) {
  return ctx.el(
    "a",
    { class: tone ? `grimoire-stat is-${tone}` : "grimoire-stat", href: ctx.href(target) },
    [
      ctx.el("span", { class: "grimoire-stat-label", text: label }),
      ctx.el("span", { class: "grimoire-stat-value", text: String(value) }),
      ctx.el("span", { class: "grimoire-stat-sub", text: sub }),
    ],
  );
}

const STATUS_ORDER = ["shipped", "building", "proposed", "retired"];

async function overviewView(ctx, summaryRequest) {
  const [data, check, releases] = await Promise.all([
    summaryRequest,
    ctx.api("check/groups").catch(() => null),
    ctx.api("releases").catch(() => null),
  ]);
  const { el } = ctx;
  const features = data.features.features;
  const byStatus = new Map();

  for (const item of features) byStatus.set(item.status, (byStatus.get(item.status) ?? 0) + 1);

  const flows = features.reduce((total, item) => total + item.flows.length, 0);
  const statusLine = [...byStatus.entries()]
    .sort(([a], [b]) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b))
    .map(([status, total]) => `${total} ${status}`)
    .join(", ");
  const waiting = data.tasks.waiting.length;
  const open = data.tasks.open.length - waiting;
  const stale = data.routes === "stale" || data.routes === "missing";
  const out = el("div", { class: "grimoire-view" });

  out.append(
    el("div", { class: "grimoire-stats" }, [
      stat(ctx, {
        label: "Features",
        value: features.length,
        sub: features.length ? `${statusLine}; ${plural(flows, "flow")}` : "none written yet",
        target: "features",
      }),
      stat(ctx, {
        label: "Apps",
        value: data.apps ? data.apps.apps : "-",
        sub: data.apps
          ? `${plural(data.apps.pages, "page")}, ${plural(data.apps.screens, "screen")}`
          : "not counted",
        target: "apps",
      }),
      stat(ctx, {
        label: "Tasks",
        value: open,
        sub: `${open} open, ${waiting} waiting, ${data.tasks.done.length} done`,
        target: "tasks",
        tone: waiting ? "warn" : "",
      }),
      stat(ctx, {
        label: "Check errors",
        value: data.counts.errors,
        sub: `${plural(data.counts.errors, "error")}, ${plural(data.counts.warnings, "warning")}, ${data.counts.expected} expected`,
        target: "check",
        tone: data.counts.errors ? "bad" : data.counts.warnings ? "warn" : "good",
      }),
      stat(ctx, {
        label: "Book",
        value: data.book.files,
        sub: `files in ${plural(data.book.modules, "module")}`,
        target: "modules",
      }),
      stat(ctx, {
        label: "Route facts",
        value: data.routes,
        sub: stale ? "need a refresh" : "up to date",
        target: "check",
        tone: toneOf(data.routes),
      }),
    ]),
  );

  if (stale) {
    out.append(
      el("p", {
        class: "grimoire-note",
        text: "The route facts are old or missing. Run warlock grimoire build to refresh them.",
      }),
    );
  }

  if (!features.length) {
    out.append(
      ctx.empty(
        data.book.files
          ? `No features are written yet. The book lists ${data.book.files} files; search it above, or open the module graph. Ask your agent to write the features (skill use-the-grimoire).`
          : "The book is empty. Run warlock grimoire build.",
      ),
    );
  }

  // Errors first, then the biggest groups; each leads to the Check tab filtered to its code.
  const problems = (check?.groups ?? [])
    .filter((group) => group.count > 0)
    .sort(
      (left, right) =>
        (left.severity === "error" ? 0 : 1) - (right.severity === "error" ? 0 : 1) ||
        right.count - left.count ||
        left.code.localeCompare(right.code),
    )
    .slice(0, 5);
  const recent = [...(releases?.releases ?? [])]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5);

  out.append(
    el("div", { class: "grimoire-split" }, [
      section(ctx, "Top problems", [
        check
          ? problems.length
            ? list(
                ctx,
                problems.map((group) => [
                  pill(ctx, group.severity, toneOf(group.severity)),
                  " ",
                  link(ctx, group.code, checkTarget({ code: group.code }), { class: "grimoire-mono" }),
                  " ",
                  ...[codeText(ctx, group.title)].flat(),
                  " ",
                  pill(ctx, String(group.count)),
                ]),
              )
            : el("p", {}, [pill(ctx, "clean", "good"), " Nothing to fix."])
          : ctx.empty("The check report could not be loaded."),
        check ? el("p", {}, [link(ctx, "Open the check report", "check")]) : "",
      ]),
      section(ctx, "Recent releases", [
        recent.length
          ? list(
              ctx,
              recent.map((item) => [
                link(ctx, item.release, `release/${encodeURIComponent(item.release)}`),
                " ",
                muted(ctx, item.date),
              ]),
            )
          : ctx.empty(
              releases ? "No releases are written yet." : "The releases could not be loaded.",
            ),
        recent.length ? el("p", {}, [link(ctx, "All releases", "releases")]) : "",
      ]),
    ]),
  );

  if (features.length) {
    const latest = [...features]
      .sort((left, right) => right.updated.localeCompare(left.updated))
      .slice(0, 6);

    out.append(
      section(ctx, "Recently updated features", [
        list(
          ctx,
          latest.map((item) => [
            link(ctx, item.id, `feature/${encodeURIComponent(item.id)}`),
            " ",
            pill(ctx, item.status, toneOf(item.status)),
            " ",
            muted(ctx, `${item.title}, updated ${item.updated}`),
          ]),
        ),
        el("p", {}, [link(ctx, `All ${features.length} features`, "features")]),
      ]),
    );
  }

  return out;
}

const FEATURE_SORTS = [
  ["id", "name", (a, b) => a.id.localeCompare(b.id)],
  [
    "status",
    "status",
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.id.localeCompare(b.id),
  ],
  ["flows", "most flows", (a, b) => b.flows.length - a.flows.length || a.id.localeCompare(b.id)],
  [
    "updated",
    "recently updated",
    (a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id),
  ],
];

async function featuresView(ctx) {
  const data = await ctx.api("features");
  const { el } = ctx;
  const items = data.features;

  if (!items.length) {
    return ctx.empty(
      "No features are written yet. Ask your agent to write them (skill use-the-grimoire), then run warlock grimoire build.",
    );
  }

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Features"),
    listing(ctx, {
      items,
      noun: "features",
      placeholder: "Filter features",
      textOf: (item) =>
        [item.id, item.title, item.summary ?? "", ...item.flows.map((flow) => flow.id)].join(" "),
      statusOf: (item) => item.status,
      statusOrder: STATUS_ORDER,
      sorts: FEATURE_SORTS,
      render: (shown) =>
        el(
          "div",
          { class: "grimoire-feature-grid" },
          shown.map((item) => {
            const tone = toneOf(item.status);

            return el(
              "article",
              { class: tone ? `grimoire-feature is-${tone}` : "grimoire-feature" },
              [
                el("header", {}, [
                  el("h3", {}, [
                    link(ctx, item.title || item.id, `feature/${encodeURIComponent(item.id)}`),
                  ]),
                  pill(ctx, item.status, tone),
                ]),
                el("p", { class: "grimoire-feature-id" }, [
                  mono(ctx, item.id),
                  ` version ${item.version}, updated ${item.updated}`,
                ]),
                item.summary ? el("p", { class: "grimoire-clamp", text: item.summary }) : "",
                el("div", { class: "grimoire-feature-flows" }, [
                  muted(ctx, plural(item.flows.length, "flow")),
                  item.flows.length
                    ? chipList(
                        ctx,
                        item.flows,
                        (flow) =>
                          link(
                            ctx,
                            flow.id,
                            `flow/${encodeURIComponent(item.id)}/${encodeURIComponent(flow.id)}`,
                            { class: "grimoire-chip", title: flow.heading ?? flow.id },
                          ),
                        6,
                      )
                    : "",
                ]),
              ],
            );
          }),
        ),
    }),
  ]);
}

async function featureView(ctx, id) {
  const [data, graph] = await Promise.all([
    ctx.api(`features/${encodeURIComponent(id)}`),
    ctx.api(`graph/feature/${encodeURIComponent(id)}`).catch(() => null),
  ]);
  const { el } = ctx;
  const readme = data.readme;
  const status = plain(readme.status);
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Features", "features"], [String(plain(readme.id))]]),
    heading(ctx, plain(readme.title), [
      mono(ctx, plain(readme.id)),
      pill(ctx, status, toneOf(status)),
      pill(ctx, `version ${plain(readme.version)}`),
      readme.origin ? pill(ctx, plain(readme.origin), toneOf(plain(readme.origin))) : "",
      muted(ctx, `updated ${plain(readme.updated)}`),
    ]),
  ]);

  if (readme.summary) out.append(el("p", { class: "grimoire-lede", text: readme.summary }));

  out.append(
    section(ctx, "Flows", [
      data.flows.length
        ? table(
            ctx,
            ["Flow", "Status", "Since", "Heading"],
            data.flows.map((flow) => [
              [
                link(
                  ctx,
                  flow.id,
                  `flow/${encodeURIComponent(plain(readme.id))}/${encodeURIComponent(flow.id)}`,
                ),
              ],
              [pill(ctx, flow.status, toneOf(flow.status))],
              [flow.since],
              [flow.heading ?? ""],
            ]),
          )
        : ctx.empty("This feature has no flows yet."),
    ]),
  );

  const map = data.bookmap;
  out.append(
    section(ctx, "Code", [
      facts(ctx, [
        ["Own files", String(map.own.length)],
        ["Borrowed", String(map.borrowed.length)],
        ["Routes", String(map.routes.length)],
        ["Not reached by a flow", String(map.unreached.length)],
      ]),
      el("h4", { text: "Routes" }),
      map.routes.length
        ? list(
            ctx,
            map.routes.map((item) => [
              routeLink(ctx, item.method, item.path),
              " in ",
              fileLink(ctx, item.file),
            ]),
          )
        : muted(ctx, "none"),
      el("h4", { text: "Pages and screens" }),
      Object.keys(map.pages).length
        ? list(
            ctx,
            Object.entries(map.pages).flatMap(([app, pages]) =>
              pages.map((item) => [
                link(
                  ctx,
                  `${app} ${item.route}`,
                  `page/${encodeURIComponent(app)}/${encodeURIComponent(item.route)}`,
                ),
              ]),
            ),
          )
        : muted(ctx, "none"),
      el("h4", { text: "Own files" }),
      fileChips(ctx, map.own, 12),
      el("h4", { text: "Files no flow reaches" }),
      fileChips(ctx, map.unreached, 12),
    ]),
  );

  if (data.tasks.length) {
    out.append(
      section(ctx, "Open tasks", [
        list(
          ctx,
          data.tasks.map((task) => [
            link(ctx, task.id, `task/${encodeURIComponent(task.id)}`, { class: "grimoire-nowrap" }),
            " ",
            codeText(ctx, task.title),
            " ",
            pill(ctx, task.status, toneOf(task.status)),
          ]),
        ),
      ]),
    );
  }

  out.append(section(ctx, "Recent changes", [changesView(ctx, data.changes)]));

  if (data.findings.length) out.append(section(ctx, "Findings", [findingList(ctx, data.findings)]));
  if (graph) out.append(graphView(ctx, graph, "The feature and its neighbours"));
  return out;
}

const STEP_FILE_SETS = [
  ["direct", "Direct imports", "direct"],
  ["feature", "In this feature", "feature"],
  ["reachable", "All reachable", "reachable"],
  ["type-only", "Type-only", "typeOnly"],
];

/** The files behind one step, loaded a page at a time from the step files route. */
function stepFilesPanel(ctx, feature, flowId, step) {
  const { el } = ctx;
  const counts = step.counts ?? { direct: 0, feature: 0, reachable: 0, typeOnly: 0 };
  const sets = STEP_FILE_SETS.filter(([, , key]) => key !== "typeOnly" || counts[key] > 0);
  const body = el("div", { class: "grimoire-step-files-body" });
  const tabs = el("div", { class: "grimoire-subtabs", role: "tablist", "aria-label": "File set" });
  const loaded = new Map();
  const buttons = [];

  function paint(state) {
    const groups = new Map();

    for (const item of state.files) groups.set(item.module, [...(groups.get(item.module) ?? []), item]);

    state.box.replaceChildren(
      ...[...groups.entries()].map(([name, items]) =>
        el("div", { class: "grimoire-module-group" }, [
          el("h5", { text: `${name || "(no module)"} (${items.length})` }),
          el(
            "div",
            { class: "grimoire-chips" },
            items.map((item) => fileLink(ctx, item.file)),
          ),
        ]),
      ),
      state.files.length || state.error ? "" : muted(ctx, "No files in this set."),
      state.error
        ? el("p", { class: "grimoire-error-title", text: `Could not load the files: ${state.error}. Try again.` })
        : "",
      state.files.length < state.total || state.error
        ? el("button", {
            type: "button",
            class: "grimoire-filter",
            text: state.error ? "Try again" : `Load ${Math.min(STEP_FILES_PAGE, state.total - state.files.length)} more`,
            onclick: () => fetchPage(state),
          })
        : "",
    );
  }

  async function fetchPage(state) {
    if (state.busy) return;
    state.busy = true;

    try {
      const answer = await ctx.api(
        `flows/${encodeURIComponent(feature)}/${encodeURIComponent(flowId)}/steps/${step.index}/files?set=${state.set}&offset=${state.files.length}`,
      );

      state.files.push(...answer.files);
      state.total = answer.total;
      state.error = null;
    } catch (error) {
      state.error = error && error.message ? error.message : String(error);
    }

    state.busy = false;
    paint(state);
  }

  function open(set) {
    let state = loaded.get(set);

    if (!state) {
      state = { set, files: [], total: 0, error: null, busy: false, box: el("div", {}) };
      state.box.append(muted(ctx, "Loading files…"));
      loaded.set(set, state);
      fetchPage(state);
    }

    for (const [button, key] of buttons) {
      button.setAttribute("aria-selected", String(key === set));
      button.setAttribute("class", key === set ? "grimoire-subtab is-active" : "grimoire-subtab");
    }

    body.replaceChildren(state.box);
  }

  for (const [key, label, countKey] of sets) {
    const button = el("button", {
      type: "button",
      role: "tab",
      class: "grimoire-subtab",
      "aria-selected": "false",
      text: `${label} ${counts[countKey]}`,
      onclick: () => open(key),
    });

    buttons.push([button, key]);
    tabs.append(button);
  }

  open("direct");
  return el("div", { class: "grimoire-step-files" }, [tabs, body]);
}

const STEP_FILES_PAGE = 200;

/** A number tile that leads nowhere. */
function tile(ctx, { label, value, sub, tone = "" }) {
  return ctx.el("div", { class: tone ? `grimoire-stat is-${tone}` : "grimoire-stat" }, [
    ctx.el("span", { class: "grimoire-stat-label", text: label }),
    ctx.el("span", { class: "grimoire-stat-value", text: String(value) }),
    ctx.el("span", { class: "grimoire-stat-sub", text: sub }),
  ]);
}

/** How many files a step reaches, in words. */
function countsLine(counts) {
  const parts = [
    `${counts.direct} direct`,
    `${counts.feature} in feature`,
    `${counts.reachable} reachable`,
  ];

  if (counts.typeOnly > 0) parts.push(`${counts.typeOnly} type-only`);

  return parts.join(" · ");
}

/** The journey: steps as a vertical stepper. */
function journey(ctx, feature, flowId, flow, steps) {
  const { el } = ctx;

  if (!steps.length) return ctx.empty("This flow has no steps.");

  return el(
    "ol",
    { class: "grimoire-stepper" },
    steps.map((step) => {
      const written = (flow.steps ?? []).find((item) => item.index === step.index);
      const note = written && written.note ? written.note : null;
      const counts = step.counts ?? { direct: 0, feature: 0, reachable: 0, typeOnly: 0 };
      const shown = expander(ctx, "Show files", () => stepFilesPanel(ctx, feature, flowId, step));
      const space = step.target.indexOf(" ");

      return el("li", { class: "grimoire-step" }, [
        el("span", { class: "grimoire-step-marker" }, [stepIcon(ctx, step.type)]),
        el("div", { class: "grimoire-step-body" }, [
          el("div", { class: "grimoire-step-head" }, [
            mono(ctx, `${step.index}`),
            pill(ctx, step.type),
            step.type === "route" && space > 0
              ? routeLink(ctx, step.target.slice(0, space), step.target.slice(space + 1))
              : el("span", { class: "grimoire-step-target", text: step.target }),
            step.found === false ? pill(ctx, "not found in the book", "bad") : "",
          ]),
          note ? el("p", { class: "grimoire-muted" }, codeText(ctx, note)) : "",
          step.linked
            ? el("p", { class: "grimoire-linked" }, [
                "Affects ",
                flowLink(ctx, step.linked.ref),
                step.linked.heading ? ` (${step.linked.heading})` : "",
                step.linked.summary ? el("span", { class: "grimoire-muted" }, [" ", step.linked.summary]) : "",
              ])
            : "",
          step.entry ? el("p", {}, [muted(ctx, "Starts at "), fileLink(ctx, step.entry)]) : "",
          counts.reachable || counts.direct
            ? el("div", { class: "grimoire-step-counts" }, [muted(ctx, countsLine(counts)), shown.button])
            : "",
          shown.panel,
        ]),
      ]);
    }),
  );
}

/** The health numbers; older answers have none, so they are counted from the criteria. */
function flowHealth(data) {
  if (data.health) return data.health;

  const criteria = data.bookmap.criteria;
  const byStatus = { pass: 0, fail: 0, stale: 0, "not-run": 0, "no-test": 0 };

  for (const item of criteria) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;

  return {
    criteria: { total: criteria.length, proven: byStatus.pass, byStatus },
    steps: {
      total: data.bookmap.steps.length,
      resolved: data.bookmap.steps.filter((step) => step.found !== false).length,
    },
    findings: { errors: 0, warnings: 0, expected: 0 },
  };
}

/** The first criterion to work on: failing, then without a test, then not run or stale. */
function fixNextCriterion(criteria) {
  for (const status of ["fail", "no-test", "not-run", "stale"]) {
    const found = criteria.find((item) => item.status === status);

    if (found) return found;
  }

  return null;
}

/** The "Fix next" box. */
function fixNextBox(ctx, ref, criterion) {
  const { el } = ctx;

  if (!criterion) {
    return el("section", { class: "grimoire-card grimoire-fixnext is-good" }, [
      el("h3", { text: "Fix next" }),
      el("p", {}, [pill(ctx, "done", "good"), " Every criterion is proven by a passing test."]),
    ]);
  }

  const status = criterion.status;
  const first = criterion.tests[0];
  const line = `// @proves ${ref} ${criterion.id}`;
  const lead =
    status === "fail"
      ? `${criterion.id} fails${first ? ` in ${first.file}:${first.line}` : ""}. Fix the code or the test, then run the tests again.`
      : status === "no-test"
        ? `${criterion.id} has no test. Put this line directly above the test that proves it.`
        : status === "stale"
          ? `${criterion.id} has a result older than its test file. Run the tests again.`
          : `${criterion.id} has a test that has not run. Run the tests with the Grimoire reporter.`;
  const code = el("code", { class: "grimoire-code grimoire-proof-line", text: line });
  const note = el("span", { class: "grimoire-muted", role: "status" });
  const body = [
    el("p", { class: "grimoire-fixnext-lead" }, [
      pill(ctx, status, toneOf(status)),
      " ",
      codeText(ctx, lead),
    ]),
    el("p", { class: "grimoire-muted" }, codeText(ctx, criterion.text)),
  ];

  if (status === "no-test") {
    body.push(
      el("div", { class: "grimoire-copyline" }, [
        code,
        el("button", {
          type: "button",
          class: "grimoire-filter",
          text: "Copy",
          onclick: () => copyText(line, code, (message) => (note.textContent = message)),
        }),
        note,
      ]),
    );
  }

  return el("section", { class: "grimoire-card grimoire-fixnext" }, [el("h3", { text: "Fix next" }), ...body]);
}

/** One criterion with one status pill and the tests behind it. */
function proofRow(ctx, criterion, untracked) {
  const { el } = ctx;
  // Tagged tests with no results file read "tagged", not "not-run".
  const label = (status) => (untracked && status === "not-run" ? "tagged" : status);
  const tone = (status) => (untracked && status === "not-run" ? "" : toneOf(status));

  return el("li", { class: "grimoire-proof", id: `grimoire-ac-${criterion.id}` }, [
    el("div", { class: "grimoire-proof-head" }, [
      mono(ctx, criterion.id),
      criterion.app ? pill(ctx, criterion.app) : "",
      pill(ctx, label(criterion.status), tone(criterion.status)),
    ]),
    el("p", { class: "grimoire-proof-text" }, codeText(ctx, criterion.text)),
    criterion.tests.length
      ? el(
          "ul",
          { class: "grimoire-proof-tests" },
          criterion.tests.map((test) =>
            el("li", {}, [
              fileLink(ctx, test.file),
              mono(ctx, `:${test.line}`),
              test.name ? el("span", {}, [" ", test.name]) : "",
              " ",
              pill(
                ctx,
                test.stale ? `${label(test.result)}, stale` : label(test.result),
                test.stale ? "warn" : tone(test.result),
              ),
            ]),
          ),
        )
      : "",
  ]);
}

/** A flow's neighbours in the README order. */
function neighbours(ctx, feature, data, className) {
  const make = (item, arrow) =>
    item
      ? link(ctx, arrow === "prev" ? `‹ ${item.heading ?? item.id}` : `${item.heading ?? item.id} ›`, `flow/${encodeURIComponent(feature)}/${encodeURIComponent(item.id)}`, {
          class: `grimoire-neighbour is-${arrow}`,
          rel: arrow,
        })
      : "";

  if (!data.previous && !data.next) return "";

  return ctx.el("nav", { class: className, "aria-label": "Other flows of this feature" }, [
    make(data.previous, "prev"),
    make(data.next, "next"),
  ]);
}

async function flowView(ctx, feature, flowId) {
  const data = await ctx.api(`flows/${encodeURIComponent(feature)}/${encodeURIComponent(flowId)}`);
  const { el } = ctx;
  const flow = data.flow;
  const map = data.bookmap;
  const ref = `${feature}/${flowId}`;
  const status = plain(flow.status);
  const origin = flow.origin ? plain(flow.origin) : null;
  const title = plain(flow.heading) ?? plain(flow.id);
  const summary = plain(flow.summary) ?? null;
  const health = flowHealth(data);
  const results = data.results ?? null;
  const untracked = Boolean(results && results.recorded === false && results.proofs > 0);
  const apps = data.feature && data.feature.apps ? data.feature.apps : [];
  const problems = health.findings.errors + health.findings.warnings;
  const proven = health.criteria.proven;
  const total = health.criteria.total;
  const failing = health.criteria.byStatus.fail ?? 0;
  const out = el("div", { class: "grimoire-view grimoire-flow" }, [
    el("div", { class: "grimoire-minihead" }, [
      el("strong", { text: title }),
      pill(ctx, status, toneOf(status)),
      muted(ctx, `${proven}/${total} proven`),
    ]),
    crumbs(ctx, [
      ["Features", "features"],
      [(data.feature && data.feature.title) || feature, `feature/${encodeURIComponent(feature)}`],
      [title],
    ]),
    heading(ctx, title, [
      mono(ctx, ref),
      pill(ctx, status, toneOf(status)),
      origin ? pill(ctx, origin, toneOf(origin)) : "",
      muted(ctx, `since ${plain(flow.since)}, for ${plain(flow.who)}`),
      ...apps.map((app) => pill(ctx, app)),
      neighbours(ctx, feature, data, "grimoire-switcher"),
    ]),
    summary
      ? el("p", { class: "grimoire-lede" }, codeText(ctx, summary))
      : el("p", {
          class: "grimoire-muted",
          text: "No summary yet. Add one sentence under the title of the flow file.",
        }),
    el("div", { class: "grimoire-stats grimoire-health" }, [
      tile(ctx, {
        label: "Criteria proven",
        value: `${proven}/${total}`,
        sub: failing ? `${plural(failing, "criterion")} failing` : total ? "passing tests" : "none written",
        tone: failing ? "bad" : total && proven === total ? "good" : total ? "warn" : "",
      }),
      el("div", { class: "grimoire-stat" }, [
        el("span", { class: "grimoire-stat-label", text: "Last test run" }),
        el("span", {
          class: "grimoire-stat-value grimoire-stat-small",
          text: results && results.recorded && results.updatedAt ? results.updatedAt.slice(0, 10) : "none",
        }),
        el("span", {
          class: "grimoire-stat-sub",
          text: results && results.recorded ? "results recorded" : "no results recorded",
        }),
      ]),
      stat(ctx, {
        label: "Findings",
        value: problems,
        sub: `${plural(health.findings.errors, "error")}, ${plural(health.findings.warnings, "warning")}`,
        target: checkTarget({ flow: ref }),
        tone: health.findings.errors ? "bad" : problems ? "warn" : "good",
      }),
      el("div", { class: "grimoire-stat" }, [
        el("span", { class: "grimoire-stat-label", text: "Steps resolved" }),
        el("span", {
          class: "grimoire-stat-value",
          text: `${health.steps.resolved}/${health.steps.total}`,
        }),
        el("span", { class: "grimoire-stat-sub", text: "found in the book" }),
      ]),
    ]),
  ]);

  if (untracked) {
    out.append(
      el("div", { class: "grimoire-note", role: "note" }, [
        el("strong", { text: "No test results recorded yet. " }),
        codeText(
          ctx,
          `${results.proofs} tagged ${results.proofs === 1 ? "test is" : "tests are"} waiting for a result. Add \`grimoireReporter()\` to the Vitest config and run the tests, or set the panel option \`testResultsFile\`. Looking in ${results.file}.`,
        ),
      ]),
    );
  }

  out.append(fixNextBox(ctx, ref, fixNextCriterion(map.criteria)));
  out.append(section(ctx, "Journey", [journey(ctx, feature, flowId, flow, map.steps)]));
  out.append(
    section(ctx, "Proof", [
      map.criteria.length
        ? el(
            "ul",
            { class: "grimoire-proofs" },
            map.criteria.map((criterion) => proofRow(ctx, criterion, untracked)),
          )
        : ctx.empty("No criteria written."),
    ]),
  );

  if ((flow.differs ?? []).length) {
    out.append(
      section(ctx, "Differs by app", [
        list(
          ctx,
          flow.differs.map((item) => [mono(ctx, item.name), " ", codeText(ctx, item.text)]),
        ),
      ]),
    );
  }

  if (flow.cases.length) {
    const handled = flow.cases.filter((item) => !item.doesNotApply);
    const skipped = flow.cases.filter((item) => item.doesNotApply);
    const jump = (id) =>
      el("button", {
        type: "button",
        class: "grimoire-chip",
        title: `Go to ${id}`,
        text: id,
        onclick: () => {
          const target = out.findAll
            ? out.findAll((node) => node.attributes && node.attributes.id === `grimoire-ac-${id}`)[0]
            : out.querySelector?.(`[id="grimoire-ac-${id}"]`);

          target?.scrollIntoView?.({ block: "center" });
        },
      });

    out.append(
      section(ctx, "Cases", [
        handled.length
          ? el(
              "ul",
              { class: "grimoire-cases" },
              handled.map((item) =>
                el("li", {}, [
                  el("strong", { text: item.question }),
                  " ",
                  codeText(ctx, item.answer),
                  (item.criteria ?? []).length
                    ? el("span", { class: "grimoire-chips" }, [" proven by ", ...item.criteria.map(jump)])
                    : "",
                ]),
              ),
            )
          : muted(ctx, "No handled cases written."),
        skipped.length
          ? el("details", { class: "grimoire-details" }, [
              el("summary", { text: `Does not apply (${skipped.length})` }),
              list(
                ctx,
                skipped.map((item) => [
                  el("strong", { text: item.question }),
                  " ",
                  codeText(ctx, stripDoesNotApply(item.answer)),
                ]),
              ),
            ])
          : "",
      ]),
    );
  }

  if ((flow.notHandled ?? []).length) {
    out.append(
      section(ctx, "Not handled", [
        list(
          ctx,
          flow.notHandled.map((item) => [el("strong", { text: item.name }), " ", codeText(ctx, item.text)]),
        ),
      ]),
    );
  }

  if (flow.unknowns.length) {
    out.append(
      section(ctx, "Unknowns", [
        list(
          ctx,
          flow.unknowns.map((item) => [codeText(ctx, item.text)]),
        ),
      ]),
    );
  }

  out.append(
    section(ctx, "Where users see it", [
      map.shownBy.length
        ? list(
            ctx,
            map.shownBy.map((shown) => [
              shown.type === "layout"
                ? `${shown.app} layout ${shown.id}`
                : link(
                    ctx,
                    `${shown.app} ${shown.type} ${shown.id}`,
                    `page/${encodeURIComponent(shown.app)}/${encodeURIComponent(shown.id)}`,
                  ),
              ` as block ${shown.block}`,
            ]),
          )
        : ctx.empty("No app page shows this flow."),
    ]),
  );
  out.append(section(ctx, "History", [changesView(ctx, data.history)]));

  // Missing tests are already shown per criterion above, so they are not listed twice.
  const rest = data.findings.filter((finding) => finding.code !== "GR4001");

  if (rest.length) out.append(section(ctx, "Findings", [findingList(ctx, rest)]));

  out.append(neighbours(ctx, feature, data, "grimoire-pager"));
  return out;
}

async function pageView(ctx, app, key) {
  const path = `${encodeURIComponent(app)}/pages/${encodeURIComponent(key)}`;
  const [data, graph] = await Promise.all([
    ctx.api(`apps/${path}`),
    ctx
      .api(`graph/page?app=${encodeURIComponent(app)}&page=${encodeURIComponent(key)}`)
      .catch(() => null),
  ]);
  const { el } = ctx;
  const page = data.page;
  const title = plain(page.heading) ?? page.id;
  const route = plain(page.route) ?? plain(page.screen) ?? page.id;
  const origin = page.origin ? plain(page.origin) : null;
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Apps", "apps"], [app, "apps"], [title]]),
    heading(ctx, title, [
      pill(ctx, page.type === "screen" ? "screen" : "page"),
      mono(ctx, route),
      muted(ctx, app),
      origin ? pill(ctx, origin, toneOf(origin)) : "",
    ]),
  ]);

  if (page.purpose) out.append(el("p", { class: "grimoire-lede", text: page.purpose }));

  const rows = [
    ...(data.layout ? data.layout.blocks.map((row) => ({ row, from: "layout" })) : []),
    ...page.blocks.map((row) => ({ row, from: "page" })),
  ];
  out.append(
    section(ctx, "Blocks", [
      rows.length
        ? table(
            ctx,
            ["Block", "From", "Flow", "Who", "Changes with"],
            rows.map(({ row, from }) => [
              [row.block],
              [pill(ctx, from)],
              [row.flow ? flowLink(ctx, row.flow) : ""],
              [row.who.everyone ? "everyone" : row.who.conditions.join(", ")],
              [
                row.changesWith
                  .map((change) =>
                    change.condition ? `${change.condition}: ${change.text}` : change.text,
                  )
                  .join("; "),
              ],
            ]),
          )
        : ctx.empty("No blocks are written for this page."),
    ]),
  );

  if (page.blockFiles.length) {
    out.append(
      section(
        ctx,
        "Block details",
        page.blockFiles.map((block) =>
          el("div", {}, [
            el("h4", { text: block.id }),
            list(
              ctx,
              block.details.map((detail) => [`${detail.name}: ${detail.text}`]),
            ),
          ]),
        ),
      ),
    );
  }

  if (data.book) {
    out.append(
      section(ctx, "In the code", [
        facts(ctx, [
          ["File", fileLink(ctx, data.book.file)],
          ["Layouts", data.book.layouts?.length ? fileChips(ctx, data.book.layouts) : null],
          [
            "Requires",
            data.book.requires?.length
              ? chipList(ctx, data.book.requires, (item) => mono(ctx, item))
              : null,
          ],
        ]),
      ]),
    );
  }

  if (graph) out.append(graphView(ctx, graph, "The page and its blocks"));
  return out;
}

/** The group a page or screen is listed under: the first segment of its route, or the top level. */
function groupOf(row) {
  const segments = (row.route ?? row.id)
    .split("/")
    .filter((segment) => segment && !segment.startsWith(":") && !segment.startsWith("["));
  const first = segments[0]?.replace(/^\(.*\)$/, "") ?? "";

  return segments.length > 1 && first ? first : "";
}

function appIcon(ctx, type) {
  const { svg } = ctx;
  const common = {
    viewBox: "0 0 24 24",
    width: "22",
    height: "22",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: "grimoire-app-icon",
  };

  return type === "mobile"
    ? svg("svg", common, [
        svg("rect", { x: "7", y: "2.5", width: "10", height: "19", rx: "2.2" }),
        svg("path", { d: "M11 18.5h2" }),
      ])
    : svg("svg", common, [
        svg("rect", { x: "3", y: "4", width: "18", height: "12", rx: "2" }),
        svg("path", { d: "M9 20h6M12 16v4" }),
      ]);
}

async function appsView(ctx) {
  const data = await ctx.api("apps");
  const { el } = ctx;

  if (!data.apps.length)
    return ctx.empty(
      "No apps are written in grimoire/apps. Ask your agent to write them (skill use-the-grimoire).",
    );

  // Older answers list ids only.
  const rowsOf = (app) =>
    app.rows ?? [
      ...app.pages.map((id) => ({ id, type: "page" })),
      ...app.screens.map((id) => ({ id, type: "screen" })),
    ];
  const items = data.apps.flatMap((app) =>
    rowsOf(app).map((row) => ({
      route: null,
      heading: null,
      origin: null,
      layout: null,
      blocks: null,
      ...row,
      app: app.id,
    })),
  );

  const renderApp = (app, rows, filtered) => {
    const own = items.filter((row) => row.app === app.id);
    const confirmed = own.filter((row) => row.origin === "confirmed").length;
    const inferred = own.filter((row) => row.origin === "inferred").length;
    const groups = new Map();

    for (const row of rows) {
      const name = groupOf(row);

      groups.set(name, [...(groups.get(name) ?? []), row]);
    }

    return el("section", { class: "grimoire-card grimoire-app-card" }, [
      el("header", { class: "grimoire-app-head" }, [
        appIcon(ctx, app.type),
        el("h3", { text: app.id }),
        pill(ctx, app.type === "mobile" ? "mobile app" : "site"),
        mono(ctx, app.root),
      ]),
      el("p", { class: "grimoire-muted" }, [
        `${plural(app.pages.length, "page")}, ${plural(app.screens.length, "screen")}`,
        confirmed || inferred ? `; ${confirmed} confirmed, ${inferred} inferred` : "",
        filtered ? `; showing ${rows.length}` : "",
      ]),
      own.length
        ? [...groups.entries()]
            .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
            .map(([name, group]) =>
              el("div", { class: "grimoire-group" }, [
                el("h4", { text: `${name ? `/${name}` : "Top level"} (${group.length})` }),
                table(
                  ctx,
                  ["Page", "Route or screen", "Title", "Layout", "Blocks", "Status"],
                  [...group]
                    .sort((a, b) => (a.route ?? a.id).localeCompare(b.route ?? b.id))
                    .map((row) => [
                      [
                        link(
                          ctx,
                          row.id,
                          `page/${encodeURIComponent(app.id)}/${encodeURIComponent(row.id)}`,
                        ),
                        row.type === "screen" ? [" ", pill(ctx, "screen")] : "",
                      ],
                      [row.route ? mono(ctx, row.route) : ""],
                      [row.heading ?? ""],
                      [row.layout ?? ""],
                      [row.blocks === null ? "" : String(row.blocks)],
                      [
                        row.origin
                          ? pill(ctx, row.origin, toneOf(row.origin))
                          : muted(ctx, "unmarked"),
                      ],
                    ]),
                ),
              ]),
            )
        : ctx.empty("No pages written."),
    ]);
  };

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Apps"),
    items.length
      ? listing(ctx, {
          items,
          noun: "pages and screens",
          placeholder: "Filter pages and screens",
          textOf: (row) => [row.app, row.id, row.route ?? "", row.heading ?? ""].join(" "),
          statusOf: (row) => row.origin ?? "unmarked",
          statusOrder: ["confirmed", "inferred", "unmarked"],
          render: (shown, all) =>
            el(
              "div",
              { class: "grimoire-app-list" },
              data.apps
                .filter(
                  (app) => shown.length === all.length || shown.some((row) => row.app === app.id),
                )
                .map((app) =>
                  renderApp(
                    app,
                    shown.filter((row) => row.app === app.id),
                    shown.length !== all.length,
                  ),
                ),
            ),
        })
      : el(
          "div",
          { class: "grimoire-app-list" },
          data.apps.map((app) => renderApp(app, [], false)),
        ),
  ]);
}

/** One task's header facts. */
function taskCard(ctx, task) {
  return section(ctx, task.id, [
    facts(ctx, [
      ["Title", codeText(ctx, task.title)],
      ["Type", task.type],
      ["Status", pill(ctx, task.status, toneOf(task.status))],
      [
        "Feature",
        task.feature
          ? link(ctx, task.feature, `feature/${encodeURIComponent(task.feature)}`)
          : null,
      ],
      ["Flow", task.feature && task.flow ? flowLink(ctx, `${task.feature}/${task.flow}`) : null],
      ["Apps", task.apps?.length ? task.apps.join(", ") : null],
      ["File", mono(ctx, task.file)],
      ["Decision needed", task.decisionNeeded ?? null],
      ["Shipped in", task.shipped ? `${task.shipped.feature} ${task.shipped.version}` : null],
    ]),
  ]);
}

async function tasksView(ctx, only) {
  const data = await ctx.api("tasks");
  const { el } = ctx;

  if (only) {
    const task = [...data.open, ...data.waiting, ...data.done].find((item) => item.id === only);

    return el("div", { class: "grimoire-view" }, [
      crumbs(ctx, [["Tasks", "tasks"], [only]]),
      task
        ? taskCard(ctx, task)
        : ctx.empty(`No task ${only}. Open the task list to see the ids that exist.`),
    ]);
  }

  // `waiting` is the part of `open` that waits for the owner: each task shows in one group only.
  const waiting = new Set(data.waiting.map((task) => task.id));
  const groups = [
    ["open", "Open", data.open.filter((task) => !waiting.has(task.id))],
    ["waiting", "Waiting for approval", data.waiting],
    ["done", "Done", data.done],
  ];
  const items = groups.flatMap(([group, , tasks]) => tasks.map((task) => ({ ...task, group })));

  if (!items.length) return ctx.empty("No tasks are written in grimoire/tasks.");

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Tasks"),
    listing(ctx, {
      items,
      noun: "tasks",
      textOf: (task) =>
        [task.id, task.title, task.type, task.feature ?? "", task.decisionNeeded ?? ""].join(" "),
      statusOf: (task) => task.group,
      statusOrder: ["open", "waiting", "done"],
      render: (shown) =>
        el(
          "div",
          { class: "grimoire-view-groups" },
          groups
            .map(([group, title]) => [title, shown.filter((task) => task.group === group), group])
            .filter(([, tasks]) => tasks.length)
            .map(([title, tasks, group]) =>
              section(ctx, `${title} (${tasks.length})`, [
                table(
                  ctx,
                  ["Task", "Title", "Type", "Status", "Feature", "Decision needed"],
                  tasks.map((task) => [
                    [
                      link(ctx, task.id, `task/${encodeURIComponent(task.id)}`, {
                        class: "grimoire-nowrap",
                      }),
                    ],
                    [codeText(ctx, task.title)],
                    [task.type],
                    [pill(ctx, task.status, toneOf(group))],
                    [
                      task.feature
                        ? link(ctx, task.feature, `feature/${encodeURIComponent(task.feature)}`)
                        : "",
                    ],
                    [task.decisionNeeded ?? ""],
                  ]),
                ),
              ]),
            ),
        ),
    }),
  ]);
}

async function releasesView(ctx) {
  const data = await ctx.api("releases");
  const { el } = ctx;

  if (!data.releases.length) return ctx.empty("No releases are written in grimoire/releases.");

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Releases"),
    listing(ctx, {
      items: data.releases,
      noun: "releases",
      textOf: (item) => `${item.release} ${item.date} ${item.file}`,
      sorts: [
        ["newest", "newest first", (a, b) => b.date.localeCompare(a.date)],
        ["oldest", "oldest first", (a, b) => a.date.localeCompare(b.date)],
      ],
      render: (shown) =>
        section(ctx, "Releases", [
          table(
            ctx,
            ["Release", "Date", "File"],
            shown.map((item) => [
              [link(ctx, item.release, `release/${encodeURIComponent(item.release)}`)],
              [item.date],
              [mono(ctx, item.file)],
            ]),
          ),
        ]),
    }),
  ]);
}

async function releaseView(ctx, id) {
  const data = await ctx.api(`releases/${encodeURIComponent(id)}`);
  const { el } = ctx;
  const entries = data.collected?.entries ?? [];
  const byFeature = new Map();

  for (const entry of entries)
    byFeature.set(entry.feature, [...(byFeature.get(entry.feature) ?? []), entry]);

  return el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Releases", "releases"], [`Release ${plain(data.release)}`]]),
    heading(ctx, `Release ${plain(data.release)}`, [muted(ctx, plain(data.date))]),
    data.brief ? el("p", { class: "grimoire-lede", text: data.brief }) : "",
    entries.length
      ? [...byFeature.entries()].map(([feature, items]) =>
          section(ctx, `${feature} (${items.length})`, [
            list(
              ctx,
              items.map((entry) => [
                `${entry.feature} ${entry.version}: ${entry.text ?? JSON.stringify(entry)}`,
              ]),
            ),
          ]),
        )
      : section(ctx, "Collected entries", [ctx.empty("Nothing is listed for this release.")]),
  ]);
}

/** One link of a filter row; the active one is marked. */
function filterLink(ctx, label, target, active) {
  return ctx.el("a", {
    href: ctx.href(target),
    class: active ? "grimoire-filter is-active" : "grimoire-filter",
    ...(active ? { "aria-current": "true" } : {}),
    text: label,
  });
}

/** A select that opens the Check tab with one more filter set. */
function filterSelect(ctx, label, key, options, query) {
  return ctx.el(
    "select",
    {
      class: "grimoire-sort",
      "aria-label": label,
      onchange: (event) => ctx.navigate(checkTarget({ ...query, [key]: event.target.value })),
    },
    [
      ctx.el("option", { value: "", text: `${label}: all` }),
      ...options.map((option) =>
        ctx.el("option", {
          value: option,
          text: option,
          ...(query[key] === option ? { selected: "selected" } : {}),
        }),
      ),
    ],
  );
}

/** One code of the check: its title, the fix once, and its features with a count and "Show". */
function checkGroupCard(ctx, group, mode, query) {
  const { el } = ctx;
  const count = mode === "expected" ? group.expected : group.count;
  const filter = { state: mode, ...(query.severity ? { severity: query.severity } : {}) };
  // Files no flow reaches are one finding per file: shown one row per feature, files on request.
  const perFeature = group.code === "GR3006";
  const features = group.features;

  return el("section", { class: "grimoire-card grimoire-check-group" }, [
    el("header", { class: "grimoire-check-head" }, [
      pill(ctx, group.severity, mode === "expected" ? "" : toneOf(group.severity)),
      mono(ctx, group.code),
      el("h3", {}, codeText(ctx, group.title)),
      pill(ctx, String(count)),
    ]),
    group.fix ? el("p", { class: "grimoire-muted" }, codeText(ctx, group.fix)) : "",
    features.length
      ? el(
          "ul",
          { class: "grimoire-check-features" },
          features.map((item) => {
            const shown = expander(ctx, perFeature ? "Show files" : "Show", () =>
              pagedFindings(
                ctx,
                { ...filter, code: group.code, ...(item.feature === "(none)" ? {} : { feature: item.feature }) },
                { hints: false },
              ),
            );

            return el("li", { class: "grimoire-check-feature" }, [
              el("div", { class: "grimoire-check-feature-row" }, [
                item.feature === "(none)"
                  ? muted(ctx, "no feature")
                  : link(
                      ctx,
                      item.feature,
                      checkTarget({ ...filter, code: group.code, feature: item.feature }),
                    ),
                pill(ctx, plural(item.count, perFeature ? "file" : "finding")),
                shown.button,
              ]),
              shown.panel,
            ]);
          }),
        )
      : "",
    perFeature
      ? ""
      : (() => {
          const all = expander(ctx, `Show all ${count}`, () =>
            pagedFindings(ctx, { ...filter, code: group.code }, { hints: false }),
          );

          return el("div", {}, [all.button, all.panel]);
        })(),
  ]);
}

async function checkView(ctx, query = {}) {
  const report = await ctx.api("check/groups");
  const { counts } = report;
  const { el } = ctx;
  const groups = report.groups ?? [];
  const kinds = groups.filter((group) => group.count > 0).length;
  const expectedMode = query.state === "expected";
  const matches = (group) =>
    (!query.code || group.code === query.code) &&
    (!query.severity || group.severity === query.severity) &&
    (!query.feature || group.features.some((item) => item.feature === query.feature));
  const main = expectedMode ? [] : groups.filter((group) => group.count > 0 && matches(group));
  const expected = groups.filter(
    (group) => group.expected > 0 && (expectedMode || group.count === 0) && matches(group),
  );
  const flat = Boolean(query.flow || query.feature);
  const names = [...new Set(groups.flatMap((group) => group.features.map((item) => item.feature)))]
    .filter((name) => name !== "(none)")
    .sort();
  const active = ["code", "feature", "flow", "severity", "state"].filter((key) => query[key]);

  const out = el("div", { class: "grimoire-view" }, [
    heading(ctx, "Check", [
      pill(ctx, `${plural(counts.errors, "error")}`, counts.errors ? "bad" : "good"),
      pill(ctx, plural(counts.warnings, "warning"), counts.warnings ? "warn" : ""),
      pill(ctx, `${counts.expected} expected`),
      muted(ctx, `routes ${report.routes ?? "cached"}`),
    ]),
    el("p", {
      class: "grimoire-headline",
      text: `${plural(counts.errors, "error")} · ${plural(counts.warnings, "warning")} in ${plural(kinds, "kind")}`,
    }),
    el("div", { class: "grimoire-toolbar grimoire-check-filters" }, [
      el("div", { class: "grimoire-filters", role: "group", "aria-label": "Severity" }, [
        filterLink(ctx, "all", checkTarget({ ...query, severity: "" }), !query.severity),
        filterLink(ctx, "errors", checkTarget({ ...query, severity: "error" }), query.severity === "error"),
        filterLink(ctx, "warnings", checkTarget({ ...query, severity: "warning" }), query.severity === "warning"),
      ]),
      el("div", { class: "grimoire-filters", role: "group", "aria-label": "State" }, [
        filterLink(ctx, "to fix", checkTarget({ ...query, state: "" }), !query.state),
        filterLink(ctx, "expected", checkTarget({ ...query, state: "expected" }), expectedMode),
      ]),
      filterSelect(ctx, "Code", "code", groups.map((group) => group.code), query),
      filterSelect(ctx, "Feature", "feature", names, query),
    ]),
    active.some((key) => key === "code" || key === "feature" || key === "flow")
      ? el(
          "div",
          { class: "grimoire-chips" },
          ["code", "feature", "flow"]
            .filter((key) => query[key])
            .map((key) =>
              link(ctx, `${key}: ${query[key]} ×`, checkTarget({ ...query, [key]: "" }), {
                class: "grimoire-chip",
                title: `Clear the ${key} filter`,
              }),
            ),
        )
      : "",
  ]);

  if (flat) {
    out.append(
      section(ctx, "Findings", [
        pagedFindings(
          ctx,
          {
            code: query.code,
            feature: query.feature,
            flow: query.flow,
            severity: query.severity,
            state: query.state ?? "unexpected",
          },
          { size: 50 },
        ),
      ]),
    );
    return out;
  }

  if (!main.length && !expected.length) {
    out.append(
      ctx.empty(
        active.length
          ? "No findings match these filters. Clear a filter to see more."
          : "No findings. The written files and the code agree.",
      ),
    );
    return out;
  }

  if (main.length) {
    out.append(
      el("div", { class: "grimoire-view-groups" }, [
        el("h3", { class: "grimoire-subhead", text: `To fix (${plural(main.length, "kind")})` }),
        ...main.map((group) => checkGroupCard(ctx, group, "unexpected", query)),
      ]),
    );
  }

  if (expected.length) {
    out.append(
      el("div", { class: "grimoire-view-groups" }, [
        el("h3", { class: "grimoire-subhead", text: `Expected: proposed work (${plural(expected.length, "kind")})` }),
        el("p", {
          class: "grimoire-muted",
          text: "These concern features or flows that are still proposed, so the code does not exist yet. They never fail the check.",
        }),
        ...expected.map((group) => checkGroupCard(ctx, group, "expected", query)),
      ]),
    );
  }

  return out;
}

async function fileView(ctx, path) {
  const [data, graph] = await Promise.all([
    ctx.api(`file?path=${encodeURIComponent(path)}`),
    ctx.api(`graph/file?path=${encodeURIComponent(path)}`).catch(() => null),
  ]);
  const { el } = ctx;
  const entry = data.entry;
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Modules", "modules"], [entry.file]]),
    heading(ctx, entry.file, [
      pill(ctx, entry.type),
      mono(ctx, entry.module),
      muted(ctx, `${entry.lines} lines`),
    ]),
  ]);
  if (entry.about) out.append(el("p", { class: "grimoire-lede", text: entry.about }));

  out.append(
    section(ctx, "Who uses it", [
      facts(ctx, [
        [
          "Owned by",
          entry.feature
            ? link(ctx, entry.feature, `feature/${encodeURIComponent(entry.feature)}`)
            : null,
        ],
        ["Borrowed by", entry.borrowedBy.length ? entry.borrowedBy.join(", ") : null],
        [
          "Used by flows",
          entry.flows.length
            ? el(
                "span",
                {},
                entry.flows.flatMap((flow) => [flowLink(ctx, flow), " "]),
              )
            : null,
        ],
      ]),
    ]),
    section(ctx, "Exports", [
      entry.exports.length
        ? list(
            ctx,
            entry.exports.map((item) => [mono(ctx, item.name), item.about ? ` ${item.about}` : ""]),
          )
        : muted(ctx, "none"),
    ]),
    section(ctx, "Imports", [fileChips(ctx, entry.imports, 20)]),
    section(ctx, "Imported by", [fileChips(ctx, entry.importedBy, 20)]),
  );

  if (entry.routes.length) {
    out.append(
      section(ctx, "Routes", [
        list(
          ctx,
          entry.routes.map((item) => [routeLink(ctx, item.method, item.path), ` (${item.via})`]),
        ),
      ]),
    );
  }

  if (graph) out.append(graphView(ctx, graph, "The file and its neighbours"));
  return out;
}

async function routeView(ctx, method, path) {
  const data = await ctx.api(
    `route?method=${encodeURIComponent(method)}&path=${encodeURIComponent(path)}`,
  );
  const { el } = ctx;
  const found = data.route;
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Modules", "modules"], [`${found.method} ${found.path}`]]),
    heading(ctx, `${found.method} ${found.path}`, [muted(ctx, found.description ?? found.handler)]),
  ]);
  if (found.handlerFile) out.append(el("p", {}, ["Handler: ", fileLink(ctx, found.handlerFile)]));
  out.append(
    section(ctx, "Files behind it", [fileChips(ctx, data.files, 20)]),
    section(ctx, "Flow steps", [
      data.steps.length
        ? list(
            ctx,
            data.steps.map((step) => [flowLink(ctx, step.flow), ` step ${step.index}`]),
          )
        : muted(ctx, "none"),
    ]),
  );
  return out;
}

async function modulesView(ctx) {
  const graph = await ctx.api("graph/modules");
  const { el } = ctx;
  const weight = new Map();

  for (const edge of graph.edges) {
    for (const end of [edge.from, edge.to])
      weight.set(end, (weight.get(end) ?? 0) + (edge.weight ?? 1));
  }

  const items = graph.nodes.map((node) => ({ label: node.label, links: weight.get(node.id) ?? 0 }));

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Module coupling"),
    el("p", {
      class: "grimoire-muted",
      text: "Lines are imports between modules; thicker means more imports. The most connected modules are drawn.",
    }),
    graphView(ctx, graph, "Modules"),
    items.length
      ? listing(ctx, {
          items,
          noun: "modules",
          textOf: (item) => item.label,
          sorts: [
            [
              "links",
              "most imports",
              (a, b) => b.links - a.links || a.label.localeCompare(b.label),
            ],
            ["name", "name", (a, b) => a.label.localeCompare(b.label)],
          ],
          render: (shown) =>
            section(ctx, "Modules", [
              table(
                ctx,
                ["Module", "Imports to and from"],
                shown.map((item) => [[mono(ctx, item.label)], [String(item.links)]]),
              ),
            ]),
        })
      : "",
  ]);
}

// ── Shell ───────────────────────────────────────────────────────────────────

/**
 * An asset URL `import()` accepts. A host may hand out a page-relative path
 * (`panels/grimoire/x.js`), which `import()` reads as a bare module specifier
 * and refuses; resolve it against the page first.
 */
function moduleUrl(url) {
  const base = globalThis.document?.baseURI ?? globalThis.location?.href;

  try {
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

/** Pick the view for the hash route. */
async function body(ctx, summaryRequest) {
  const { path, query } = parseRoute(ctx.route ?? "");
  const parts = path ? path.split("/").map(decodeSegment) : [];
  const [type = "", first = "", second = ""] = parts;

  switch (type) {
    case "product": {
      const map = globalThis.grimoireProductMap ?? (await import(/* @vite-ignore */ moduleUrl(ctx.asset("product-map.js"))));

      return map.productMapView(ctx, parts.slice(1));
    }
    case "features":
      return featuresView(ctx);
    case "feature":
      return featureView(ctx, first);
    case "flow":
      return flowView(ctx, first, second);
    case "page":
      return pageView(ctx, first, parts.slice(2).join("/"));
    case "apps":
      return appsView(ctx);
    case "tasks":
      return tasksView(ctx, "");
    case "task":
      return tasksView(ctx, first);
    case "releases":
      return releasesView(ctx);
    case "release":
      return releaseView(ctx, first);
    case "check":
      return checkView(ctx, query);
    case "file":
      return fileView(ctx, first);
    case "route":
      return routeView(ctx, first, parts.slice(2).join("/"));
    case "modules":
      return modulesView(ctx);
    default:
      return overviewView(ctx, summaryRequest);
  }
}

/** What the view is about, for error messages, and the list to go back to. */
function describe(route) {
  const type = (route.split("?")[0] ?? "").split("/")[0] ?? "";
  const map = {
    product: ["the product map", null],
    features: ["the features", null],
    feature: ["the feature", ["Features", "features"]],
    flow: ["the flow", ["Features", "features"]],
    apps: ["the apps", null],
    page: ["the page", ["Apps", "apps"]],
    tasks: ["the tasks", null],
    task: ["the task", ["Tasks", "tasks"]],
    releases: ["the releases", null],
    release: ["the release", ["Releases", "releases"]],
    check: ["the check report", null],
    modules: ["the module graph", null],
    file: ["the file", ["Modules", "modules"]],
    route: ["the route", ["Modules", "modules"]],
  };

  return map[type] ?? ["the overview", null];
}

/** The loading state: shown at once, so a large book never leaves a blank area. */
function skeleton(ctx) {
  const { el } = ctx;

  return el("div", { class: "grimoire-skeleton", role: "status" }, [
    el("p", { class: "grimoire-skeleton-title", text: "Opening the book…" }),
    el("p", {
      class: "grimoire-muted",
      text: "A large book can take a few seconds to open the first time.",
    }),
    el(
      "div",
      { class: "grimoire-skeleton-grid", "aria-hidden": "true" },
      [1, 2, 3, 4, 5, 6].map(() => el("div", { class: "grimoire-skeleton-block" })),
    ),
  ]);
}

/** A failed view: what failed, why, what to do, and a way to try again. */
function errorBox(ctx, route, error) {
  const { el } = ctx;
  const [what, back] = describe(route);
  const message = error && error.message ? error.message : String(error);
  const needsApp = message.includes("running app");

  return el("div", { class: "grimoire-error", role: "alert" }, [
    el("p", { class: "grimoire-error-title", text: `Could not load ${what}: ${message}` }),
    el("p", {
      class: "grimoire-muted",
      text: needsApp
        ? "Open the Grimoire tab in the devtools dashboard to see this answer."
        : back
          ? `It may have been renamed or removed. Go back to the list, or run warlock grimoire build and reload.`
          : BUILD_HINT,
    }),
    el("p", {}, [
      el("button", {
        type: "button",
        class: "grimoire-filter",
        text: "Try again",
        onclick: () => ctx.refresh(),
      }),
      back ? [" ", link(ctx, `Back to ${back[0]}`, back[1])] : "",
    ]),
  ]);
}

let shortcutHandler = null;

/** `/` focuses the search box from anywhere that is not a text field; the newest view owns the key. */
function bindShortcut(input) {
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  if (shortcutHandler) document.removeEventListener("keydown", shortcutHandler);

  shortcutHandler = (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;

    const target = event.target;
    const tag = target && target.tagName;

    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      (target && target.isContentEditable)
    )
      return;
    if (!input.isConnected) return;

    event.preventDefault();
    input.focus();
  };
  document.addEventListener("keydown", shortcutHandler);
}

/** The header: the tabs and the one search box. Results appear under the box, grouped by type. */
function header(ctx, route, summaryRequest) {
  const { el } = ctx;
  const results = el("div", { class: "grimoire-results" });
  const active = tabOf(route);
  const badges = new Map();
  let activeTab = null;
  let token = 0;
  let timer = null;
  let rows = [];
  let current = -1;

  function highlight(index) {
    current = index;
    rows.forEach((row, position) => {
      row.node.setAttribute(
        "class",
        position === index ? "grimoire-hit is-active" : "grimoire-hit",
      );
      row.node.setAttribute("aria-selected", String(position === index));
    });
    if (rows[index]) {
      input.setAttribute("aria-activedescendant", `grimoire-hit-${index}`);
      rows[index].node.scrollIntoView?.({ block: "nearest" });
    }
  }

  function clear() {
    token += 1;
    rows = [];
    current = -1;
    results.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute?.("aria-activedescendant");
  }

  async function run(text) {
    const mine = ++token;
    rows = [];
    current = -1;
    results.replaceChildren();
    if (!text.trim()) {
      input.setAttribute("aria-expanded", "false");
      return;
    }
    input.setAttribute("aria-expanded", "true");
    try {
      const answer = await ctx.api(`search?q=${encodeURIComponent(text.trim())}&limit=15`);
      if (mine !== token) return;
      results.replaceChildren();
      if (!answer.hits.length) {
        results.append(
          ctx.empty(
            `Nothing matches "${text.trim()}". Try a shorter word, or a file or route name.`,
          ),
        );
        return;
      }

      const groups = new Map();

      for (const hit of answer.hits) groups.set(hit.type, [...(groups.get(hit.type) ?? []), hit]);

      for (const [type, hits] of groups) {
        const group = el(
          "div",
          { class: "grimoire-hit-group", role: "group", "aria-label": type },
          [
            el("p", {
              class: "grimoire-hit-title",
              "aria-hidden": "true",
              text: `${type} (${hits.length})`,
            }),
          ],
        );

        for (const hit of hits) {
          const target = targetOf(hit.type, hit.id);
          const inner = [
            pill(ctx, hit.type),
            mono(ctx, hit.id),
            hit.detail ? muted(ctx, hit.detail) : "",
          ];

          if (target === null) {
            group.append(el("div", { class: "grimoire-hit is-plain" }, inner));
            continue;
          }

          const node = el(
            "a",
            {
              href: ctx.href(target),
              class: "grimoire-hit",
              role: "option",
              id: `grimoire-hit-${rows.length}`,
              "aria-selected": "false",
            },
            inner,
          );

          rows.push({ node, target });
          group.append(node);
        }

        results.append(group);
      }
    } catch (error) {
      if (mine === token)
        results.append(
          el("p", {
            class: "grimoire-error-title",
            text: `Search failed: ${error.message}. Run warlock grimoire build, then search again.`,
          }),
        );
    }
  }

  const input = el("input", {
    type: "search",
    class: "grimoire-search",
    role: "combobox",
    placeholder: "Search flows, blocks, routes, files and tasks (press /)",
    "aria-label": "Search the Grimoire",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    autocomplete: "off",
    oninput: (event) => {
      const text = event.target.value;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => run(text), 150);
    },
    onkeydown: (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!rows.length) return;
        event.preventDefault?.();
        const step = event.key === "ArrowDown" ? 1 : -1;
        highlight((current + step + rows.length) % rows.length);
      } else if (event.key === "Enter") {
        const row = rows[current] ?? rows[0];
        if (!row) return;
        event.preventDefault?.();
        ctx.navigate(row.target);
      } else if (event.key === "Escape") {
        if (timer !== null) clearTimeout(timer);
        input.value = "";
        clear();
      }
    },
  });

  const nav = el(
    "nav",
    { class: "grimoire-tabs", "aria-label": "Grimoire" },
    TABS.map(([target, label]) => {
      const badge = el("span", { class: "grimoire-tab-count" });

      badges.set(target, badge);

      const tab = el(
        "a",
        {
          href: ctx.href(target),
          class: target === active ? "grimoire-tab is-active" : "grimoire-tab",
          ...(target === active ? { "aria-current": "page" } : {}),
        },
        [label, " ", badge],
      );

      if (target === active) activeTab = tab;

      return tab;
    }),
  );

  bindShortcut(input);

  // The counts arrive with the summary; a view that does not need it still shows them.
  summaryRequest.then(
    (data) => {
      const set = (key, value) => {
        const badge = badges.get(key);
        if (badge && value !== undefined && value !== null) badge.textContent = String(value);
      };
      set("features", data.features?.features?.length);
      set("apps", data.apps?.apps);
      set("tasks", data.tasks ? data.tasks.open.length : undefined);
      set("releases", data.releases);
      set("check", data.counts ? data.counts.errors + data.counts.warnings : undefined);
    },
    () => undefined,
  );

  return {
    element: el("div", { class: "grimoire-header" }, [
      nav,
      el("div", { class: "grimoire-searchbox" }, [input, results]),
    ]),
    run,
    input,
    /** Bring the open tab into view in a scrolling tab bar (phones). */
    revealActive: () => {
      try {
        activeTab?.scrollIntoView?.({ inline: "center", block: "nearest" });
      } catch {
        // A host without scrollIntoView options keeps the bar where it is.
      }
    },
  };
}

/** The context with `el()` flattening nested child lists and skipping empty ones. */
function withFlatChildren(context) {
  const flat = (children) =>
    Array.isArray(children)
      ? children
          .flat(Infinity)
          .filter((child) => child !== null && child !== undefined && child !== false)
      : children;
  return { ...context, el: (tag, attrs, children) => context.el(tag, attrs, flat(children)) };
}

async function renderGrimoire(context) {
  const ctx = withFlatChildren(context);
  const { root, el } = ctx;
  const route = ctx.route ?? "";

  if (typeof ctx.asset === "function")
    root.append(el("link", { rel: "stylesheet", href: ctx.asset("grimoire.css") }));

  // The tab counts and the overview share one summary request.
  const summaryRequest = Promise.resolve().then(() => ctx.api("summary"));

  summaryRequest.catch(() => undefined);

  const top = header(ctx, route, summaryRequest);
  const content = el("div", { class: "grimoire-body", "aria-busy": "true" });

  content.append(skeleton(ctx));
  root.append(el("div", { class: "grimoire-root" }, [top.element, content]));
  top.revealActive();

  const loaded = (async () => {
    try {
      content.replaceChildren(await body(ctx, summaryRequest));
    } catch (error) {
      content.replaceChildren(errorBox(ctx, route, error));
    }
    content.setAttribute("aria-busy", "false");
  })();

  // A quick answer is shown filled in; a slow one hands back the skeleton at once and fills in later.
  await (typeof setTimeout === "function"
    ? Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, SKELETON_AFTER))])
    : loaded);
  return root;
}

export default renderGrimoire;
