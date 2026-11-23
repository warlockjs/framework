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
  ["bird-view", "Bird view"],
  ["", "Overview"],
  ["features", "Features"],
  ["apps", "Apps"],
  ["tasks", "Tasks"],
  ["releases", "Releases"],
  ["check", "Check"],
  ["modules", "Modules"],
];

/** An app group with more pages than this starts closed on the Apps page. */
const APP_GROUP_OPEN_LIMIT = 6;

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
    case "bird-view":
      return "bird-view";
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

/** Cut a long label from the end, so the start of a name stays readable. The full name is in the node's `<title>`. */
function shortenEnd(text, max = 16) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

/** The words for the state of the route facts, shared by Overview and Check. */
function routeFactsState(state) {
  const value = state ?? "cached";
  const sub = {
    fresh: "read from the running app",
    cached: "from the last build",
    stale: "older than the code. Run warlock grimoire build to refresh them",
    missing: "none yet: route, mail and notification steps are not checked",
  };

  return { value, sub: sub[value] ?? "", stale: value === "stale" || value === "missing" };
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

/** "Warlock.js v5.58.0" with the framework logo, from the adapter's host; nothing when the adapter reports none. */
function grimoireBrand(ctx, host) {
  if (!host || !host.name) return null;

  return ctx.el("div", { class: "grimoire-brand" }, [
    host.logo
      ? ctx.el("img", {
          class: "grimoire-brand-logo",
          src: host.logo,
          alt: "",
          width: "24",
          height: "24",
        })
      : "",
    ctx.el("span", { class: "grimoire-brand-name", text: host.name }),
    host.version
      ? ctx.el("span", { class: "grimoire-brand-version", text: `v${host.version}` })
      : "",
  ]);
}

/** The app's own name and version ("shop 1.4.0") for the bottom of the view; `null` when unknown. */
function grimoireAppLine(ctx, host) {
  const app = host && host.app;

  if (!app || !app.name) return null;

  return ctx.el("p", { class: "grimoire-appline" }, [
    ctx.el("span", { class: "grimoire-muted", text: "App " }),
    ctx.el("span", {
      class: "grimoire-mono",
      text: app.version ? `${app.name} ${app.version}` : app.name,
    }),
  ]);
}

/** One flow card: the heading as the title, the id under it, the status, and the counts that are known. */
function grimoireFlowCard(ctx, feature, flow) {
  const { el } = ctx;
  const count = (value, one, many = `${one}s`) =>
    typeof value === "number" ? `${value} ${value === 1 ? one : many}` : null;
  const metrics = [
    count(flow.steps, "step"),
    count(flow.cases, "case"),
    typeof flow.criteria === "number"
      ? typeof flow.tested === "number"
        ? `${flow.tested}/${flow.criteria} criteria tested`
        : count(flow.criteria, "criterion", "criteria")
      : null,
  ].filter(Boolean);
  const findings = typeof flow.findings === "number" ? flow.findings : 0;

  return el("li", { class: "grimoire-flowcard" }, [
    el("div", { class: "grimoire-flowcard-top" }, [
      pill(ctx, flow.status, toneOf(flow.status)),
      el("span", { class: "grimoire-muted", text: `since ${flow.since}` }),
    ]),
    el("h4", { class: "grimoire-flowcard-title" }, [
      link(
        ctx,
        flow.heading ?? flow.id,
        `flow/${encodeURIComponent(feature)}/${encodeURIComponent(flow.id)}`,
        { class: "grimoire-flowcard-link" },
      ),
    ]),
    flow.heading ? el("span", { class: "grimoire-mono grimoire-muted", text: flow.id }) : "",
    metrics.length
      ? el(
          "ul",
          { class: "grimoire-flowcard-metrics" },
          metrics.map((text) => el("li", { text })),
        )
      : "",
    findings > 0
      ? el("span", {
          class: "grimoire-pill is-warn grimoire-flowcard-findings",
          text: `${findings} ${findings === 1 ? "finding" : "findings"}`,
        })
      : "",
  ]);
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
            row.map((cell, column) => ctx.el("td", { "data-label": headings[column] ?? "" }, cell)),
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
  page: [
    ["rect", { x: "3", y: "4", width: "18", height: "14", rx: "2" }],
    ["path", { d: "M3 9h18" }],
  ],
  route: [["path", { d: "M5 12h14M13 6l6 6-6 6" }]],
  mail: [
    ["rect", { x: "3", y: "5", width: "18", height: "14", rx: "2" }],
    ["path", { d: "M3 7l9 6 9-6" }],
  ],
  notification: [["path", { d: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" }]],
  job: [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["path", { d: "M12 7v5l3 2" }],
  ],
  event: [["path", { d: "M13 2L4 14h7l-1 8 9-12h-7z" }]],
  "outside service": [["path", { d: "M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A4 4 0 0 1 17 18z" }]],
  affects: [
    [
      "path",
      {
        d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
      },
    ],
  ],
};

/** A small icon for a flow step type. */
function stepIcon(ctx, type, size = 18) {
  const { svg } = ctx;
  const shapes = STEP_ICONS[type] ?? STEP_ICONS.route;

  return svg(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: String(size),
      height: String(size),
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

  // Module graph: sites, mobile and other roots sit on an inner ring, the `src/app` modules on the outer one.
  const roots = centre ? [] : others.filter((node) => node.group === "roots");
  const apart = roots.length > 0 && roots.length < others.length;
  const inner = centre ? Math.min(others.length, 18) : 0;
  const rings = centre
    ? [others.slice(0, inner), others.slice(inner)]
    : apart
      ? [roots, others.filter((node) => node.group !== "roots")]
      : [others, []];
  rings.forEach((ring, index) => {
    const radiusX = centre ? (index === 0 ? 210 : 320) : apart ? (index === 0 ? 120 : 310) : 300;
    const radiusY = centre ? (index === 0 ? 150 : 195) : apart ? (index === 0 ? 85 : 190) : 185;
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
      text:
        node.type === "module"
          ? shortenEnd(node.label, 16)
          : shorten(node.label, node.type === "center" ? 26 : 16),
    });
    const group = svg(
      "g",
      {},
      [
        svg("title", { text: node.title ?? node.label }),
        circle,
        labelled || node.type === "center" ? label : "",
      ].filter((child) => child !== ""),
    );
    canvas.append(target === null ? group : svg("a", { href: href(target) }, [group]));
  }

  card.append(el("div", { class: "grimoire-scroll" }, [canvas]));
  if (apart) {
    card.append(
      el("p", {
        class: "grimoire-muted",
        text: "Inner ring: sites, mobile and other roots. Outer ring: modules under src/app.",
      }),
    );
  }
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
  // `waiting` is the part of `open` that waits for the owner, so the tile counts the same tasks as the tab badge.
  const waiting = data.tasks.waiting.length;
  const open = data.tasks.open.length;
  const routeFacts = routeFactsState(data.routes);
  const stale = routeFacts.stale;
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
        sub: `${open} open, ${waiting} of them waiting for approval; ${data.tasks.done.length} done`,
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
        value: routeFacts.value,
        sub: routeFacts.sub,
        target: "check",
        tone: toneOf(data.routes),
      }),
    ]),
  );

  if (stale) {
    out.append(
      el("p", {
        class: "grimoire-note",
        text: `Route facts: ${routeFacts.value}, ${routeFacts.sub}.`,
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
                  link(ctx, group.code, checkTarget({ code: group.code }), {
                    class: "grimoire-mono",
                  }),
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

// ── Tabs, groups and the feature map ────────────────────────────────────────

/** Move the address bar to `route` without reloading the view (the tab is already shown). */
function rememberRoute(ctx, route) {
  try {
    globalThis.history?.replaceState?.(null, "", ctx.href(route));
  } catch {
    // A host that keeps its own history leaves the address as it is.
  }
}

/**
 * Real tab buttons over lazily built panels. `tabs` is
 * `[{ id, label, count?, make }]`; `make()` runs the first time a tab opens, so
 * a long list in a closed tab costs nothing. `route(id)` is the hash route the
 * tab owns; the first tab is the default.
 */
function tabbed(ctx, { tabs, active, label, prefix, route }) {
  const { el } = ctx;
  const strip = el("div", { class: "grimoire-pagetabs", role: "tablist", "aria-label": label });
  const panel = el("div", { class: "grimoire-tabpanel", role: "tabpanel", tabindex: "0" });
  const buttons = new Map();
  const built = new Map();

  function show(id, user) {
    const tab = tabs.find((item) => item.id === id) ?? tabs[0];

    for (const [key, button] of buttons) {
      const on = key === tab.id;

      button.setAttribute("aria-selected", String(on));
      button.setAttribute("tabindex", on ? "0" : "-1");
      button.setAttribute("class", on ? "grimoire-pagetab is-active" : "grimoire-pagetab");
    }

    if (!built.has(tab.id)) built.set(tab.id, tab.make());

    panel.setAttribute("aria-labelledby", `${prefix}-tab-${tab.id}`);
    panel.replaceChildren(built.get(tab.id));
    if (user) rememberRoute(ctx, route(tab.id));
  }

  function move(from, step) {
    const next = tabs[(from + step + tabs.length) % tabs.length];

    show(next.id, true);
    buttons.get(next.id)?.focus?.();
  }

  tabs.forEach((tab, index) => {
    const button = el(
      "button",
      {
        type: "button",
        role: "tab",
        id: `${prefix}-tab-${tab.id}`,
        class: "grimoire-pagetab",
        "aria-selected": "false",
        "aria-controls": `${prefix}-panel`,
        tabindex: "-1",
        onclick: () => show(tab.id, true),
        onkeydown: (event) => {
          const keys = {
            ArrowRight: () => move(index, 1),
            ArrowLeft: () => move(index, -1),
            Home: () => move(0, 0),
            End: () => move(tabs.length - 1, 0),
          };
          const act = keys[event.key];

          if (!act) return;
          event.preventDefault?.();
          act();
        },
      },
      [
        tab.label,
        typeof tab.count === "number"
          ? el("span", { class: "grimoire-tab-count", text: String(tab.count) })
          : "",
      ],
    );

    buttons.set(tab.id, button);
    strip.append(button);
  });

  panel.setAttribute("id", `${prefix}-panel`);
  show(active, false);

  return el("div", { class: "grimoire-tabbed" }, [strip, panel]);
}

/**
 * A group that is closed until opened. `make()` builds the body on the first
 * open, so a closed group costs one row.
 */
function group(ctx, { title, count, tone = "", lead = [], make, open = false, className = "" }) {
  const { el } = ctx;
  const body = el("div", { class: "grimoire-group-body" });
  let built = false;
  let isOpen = false;
  const button = el(
    "button",
    {
      type: "button",
      class: "grimoire-group-head",
      "aria-expanded": "false",
      onclick: () => toggle(!isOpen),
    },
    [
      el("span", { class: "grimoire-group-caret", "aria-hidden": "true", text: "▸" }),
      ...lead,
      el("span", { class: "grimoire-group-title", text: title }),
      typeof count === "number"
        ? el("span", { class: "grimoire-tab-count", text: String(count) })
        : "",
    ],
  );

  function toggle(next) {
    isOpen = next;

    if (isOpen && !built) {
      built = true;
      body.append(make());
    }

    button.setAttribute("aria-expanded", String(isOpen));
    body.setAttribute("class", isOpen ? "grimoire-group-body is-open" : "grimoire-group-body");
  }

  const node = el(
    "div",
    { class: `grimoire-group ${tone ? `is-${tone}` : ""} ${className}`.trim() },
    [button, body],
  );

  node.toggle = toggle;
  if (open) toggle(true);

  return node;
}

/** A long list shown a slice at a time: `make(item)` builds one row; "Show more" adds the next slice. */
function slicedList(ctx, items, make, options = {}) {
  const { el } = ctx;
  const size = options.size ?? 30;
  const tag = options.tag ?? "ul";
  const list = el(tag, { class: options.className ?? "grimoire-list" });
  const more = el("button", { type: "button", class: "grimoire-more" });
  const holder = el("div", {}, [list, more]);
  let shown = 0;

  function paint() {
    const next = items.slice(shown, shown + size);

    for (const item of next) list.append(make(item));
    shown += next.length;
    more.textContent = `Show ${Math.min(size, items.length - shown)} more (${items.length - shown} left)`;
    more.setAttribute("class", shown >= items.length ? "grimoire-more is-hidden" : "grimoire-more");
    more.setAttribute("aria-hidden", String(shown >= items.length));
  }

  more.addEventListener("click", paint);
  paint();
  return holder;
}

/** What a feature-map chip leads to: the written page, the route, or the entry file. */
function mapChipTarget(chip) {
  if (chip.type === "page" && chip.app && chip.page) {
    return `page/${encodeURIComponent(chip.app)}/${encodeURIComponent(chip.page)}`;
  }
  if (chip.type === "route" && chip.method && chip.path) {
    return `route/${encodeURIComponent(chip.method)}/${encodeURIComponent(chip.path)}`;
  }
  return chip.file ? `file/${encodeURIComponent(chip.file)}` : null;
}

/** One chip of the feature map: a glyph and the name; a dashed look when the step matched nothing. */
function mapChip(ctx, chip) {
  const target = mapChipTarget(chip);
  const missing = chip.found === false;
  const attrs = {
    class: `grimoire-mapchip is-${chip.type.replace(/\s+/g, "-")}${missing ? " is-missing" : ""}`,
    title: `${chip.type}, step ${chip.step}${missing ? ", not found in the book" : ""}: ${chip.label}`,
  };
  const inner = [
    stepIcon(ctx, chip.type, 14),
    ctx.el("span", { class: "grimoire-mapchip-label", text: chip.label }),
  ];

  return target
    ? ctx.el("a", { ...attrs, href: ctx.href(target) }, inner)
    : ctx.el("span", attrs, inner);
}

/** The feature map: flows as rows, the places they run as columns. */
function featureMapView(ctx, feature, map) {
  const { el } = ctx;

  if (!map)
    return ctx.empty("This answer has no feature map. Update the Grimoire package and reload.");
  if (!map.rows.length) return ctx.empty("This feature has no flows yet.");
  if (!map.columns.length) {
    return ctx.empty(
      "No step of any flow resolves to a page, screen, route or background job yet.",
    );
  }

  return el("div", { class: "grimoire-scroll grimoire-featuremap" }, [
    el("table", { class: "grimoire-table grimoire-mapgrid" }, [
      el("caption", { class: "grimoire-sr", text: "Flows and the places they run" }),
      el("thead", {}, [
        el("tr", {}, [
          el("th", { scope: "col", text: "Flow" }),
          ...map.columns.map((column) =>
            el("th", { scope: "col", class: `is-${column.type}` }, [
              el("span", {
                class: "grimoire-maptype",
                text:
                  column.type === "site" ? "site" : column.type === "mobile" ? "mobile app" : "",
              }),
              el("span", { text: column.title }),
            ]),
          ),
        ]),
      ]),
      el(
        "tbody",
        {},
        map.rows.map((row) =>
          el("tr", {}, [
            el("th", { scope: "row", class: "grimoire-maprow" }, [
              link(
                ctx,
                row.heading ?? row.flow,
                `flow/${encodeURIComponent(feature)}/${encodeURIComponent(row.flow)}`,
              ),
              row.heading
                ? el("span", { class: "grimoire-mono grimoire-muted", text: row.flow })
                : "",
            ]),
            ...map.columns.map((column) => {
              const chips = row.cells[column.id] ?? [];

              return el(
                "td",
                { "data-label": column.title, class: chips.length ? "" : "is-empty" },
                chips.length
                  ? el(
                      "div",
                      { class: "grimoire-mapcell" },
                      chips.map((chip) => mapChip(ctx, chip)),
                    )
                  : el("span", { class: "grimoire-muted", "aria-label": "none", text: "–" }),
              );
            }),
          ]),
        ),
      ),
    ]),
  ]);
}

/** The criteria of a feature, counted from its proofs. */
function featureCriteria(data) {
  const byStatus = {};
  let total = 0;

  for (const item of data.proofs ?? []) {
    for (const criterion of item.criteria) {
      total += 1;
      byStatus[criterion.status] = (byStatus[criterion.status] ?? 0) + 1;
    }
  }

  return {
    total,
    proven: byStatus.pass ?? 0,
    failing: byStatus.fail ?? 0,
    noTest: byStatus["no-test"] ?? 0,
  };
}

/** The feature's health tiles. */
function featureHealthStrip(ctx, id, data, unexpected) {
  const criteria = featureCriteria(data);
  const flows = data.flows;
  const shipped = flows.filter((flow) => flow.status === "shipped").length;
  const errors = unexpected.filter((finding) => finding.severity === "error").length;

  return ctx.el("div", { class: "grimoire-stats grimoire-health" }, [
    tile(ctx, { label: "Flows", value: flows.length, sub: `${shipped} shipped` }),
    tile(ctx, {
      label: "Criteria proven",
      value: `${criteria.proven}/${criteria.total}`,
      sub: criteria.failing
        ? `${plural(criteria.failing, "criterion")} failing`
        : criteria.noTest
          ? `${criteria.noTest} without a test`
          : criteria.total
            ? "by passing tests"
            : "none written",
      tone: criteria.failing
        ? "bad"
        : criteria.total && criteria.proven === criteria.total
          ? "good"
          : criteria.total
            ? "warn"
            : "",
    }),
    stat(ctx, {
      label: "Findings",
      value: unexpected.length,
      sub: `${plural(errors, "error")}, ${plural(unexpected.length - errors, "warning")}`,
      target: checkTarget({ feature: id }),
      tone: errors ? "bad" : unexpected.length ? "warn" : "good",
    }),
    tile(ctx, {
      label: "Own files",
      value: data.bookmap.own.length,
      sub: `${data.bookmap.unreached.length} not reached by a flow`,
    }),
  ]);
}

/** Findings grouped by code, each group closed; the check's titles come with the first open. */
function findingGroups(ctx, findings, options = {}) {
  const { el } = ctx;

  if (!findings.length) {
    return el("p", {}, [pill(ctx, "clean", "good"), " No findings."]);
  }

  const byCode = new Map();

  for (const finding of findings)
    byCode.set(finding.code, [...(byCode.get(finding.code) ?? []), finding]);

  const titles = ctx.api("check/groups").then(
    (answer) => new Map((answer.groups ?? []).map((item) => [item.code, item.title])),
    () => new Map(),
  );
  const groups = [...byCode.entries()]
    .map(([code, items]) => ({
      code,
      items,
      severity: items.some((item) => item.severity === "error") ? "error" : "warning",
    }))
    .sort(
      (left, right) =>
        (left.severity === "error" ? 0 : 1) - (right.severity === "error" ? 0 : 1) ||
        right.items.length - left.items.length ||
        left.code.localeCompare(right.code),
    );

  return el(
    "div",
    { class: "grimoire-groups" },
    groups.map((item) => {
      const title = el("span", { class: "grimoire-muted grimoire-group-note" });

      titles.then((known) => {
        const text = known.get(item.code);

        if (text) title.textContent = text;
      });

      return group(ctx, {
        title: item.code,
        count: item.items.length,
        tone: toneOf(item.severity),
        lead: [pill(ctx, item.severity, toneOf(item.severity))],
        make: () =>
          el("div", {}, [
            title,
            slicedList(ctx, item.items, (finding) => findingItem(ctx, finding, options), {
              className: "grimoire-findings",
              size: 25,
            }),
          ]),
      });
    }),
  );
}

/** Files grouped by module with a filter box; each group is closed and built when opened. */
function fileGroupsView(ctx, groups, extras) {
  const { el } = ctx;
  const holder = el("div", { class: "grimoire-groups" });
  const status = el("p", { class: "grimoire-muted", role: "status", "aria-live": "polite" });
  const input = el("input", {
    type: "search",
    class: "grimoire-filterbox",
    placeholder: "Filter files and modules",
    "aria-label": "Filter files",
    oninput: (event) => paint(String(event.target.value ?? "")),
  });

  function paint(text) {
    const needle = text.trim().toLowerCase();
    let files = 0;
    let shown = 0;
    const nodes = [];

    for (const item of groups) {
      const matches = needle
        ? item.module.toLowerCase().includes(needle)
          ? item.files
          : item.files.filter((file) => file.toLowerCase().includes(needle))
        : item.files;

      files += item.files.length;
      if (!matches.length) continue;

      shown += matches.length;
      nodes.push(
        group(ctx, {
          title: item.module || "(no module)",
          count: matches.length,
          open: needle !== "" && matches.length <= 40,
          make: () =>
            el(
              "div",
              { class: "grimoire-chips" },
              matches.map((file) => fileLink(ctx, file)),
            ),
        }),
      );
    }

    status.textContent = needle
      ? `${shown} of ${files} files match`
      : `${plural(files, "file")} in ${plural(groups.length, "module")}`;
    holder.replaceChildren(...(needle ? [] : extras), ...nodes);
  }

  paint("");
  return el("div", {}, [el("div", { class: "grimoire-toolbar" }, [input, status]), holder]);
}

/** The extra groups of the Files tab: routes, pages and screens, borrowed files, files no flow reaches. */
function featureCodeGroups(ctx, map) {
  const { el } = ctx;
  const pages = Object.entries(map.pages).flatMap(([app, items]) =>
    items.map((item) => ({ app, ...item })),
  );

  return [
    map.routes.length
      ? group(ctx, {
          title: "Routes",
          count: map.routes.length,
          make: () =>
            slicedList(ctx, map.routes, (item) =>
              el("li", {}, [
                routeLink(ctx, item.method, item.path),
                " in ",
                fileLink(ctx, item.file),
              ]),
            ),
        })
      : "",
    pages.length
      ? group(ctx, {
          title: "Pages and screens",
          count: pages.length,
          make: () =>
            slicedList(ctx, pages, (item) =>
              el("li", {}, [
                link(
                  ctx,
                  `${item.app} ${item.route}`,
                  `page/${encodeURIComponent(item.app)}/${encodeURIComponent(item.route)}`,
                ),
              ]),
            ),
        })
      : "",
    map.borrowed.length
      ? group(ctx, {
          title: "Borrowed from other features",
          count: map.borrowed.length,
          make: () =>
            el(
              "div",
              { class: "grimoire-chips" },
              map.borrowed.map((item) => fileLink(ctx, item.file)),
            ),
        })
      : "",
    map.unreached.length
      ? group(ctx, {
          title: "Not reached by a flow",
          count: map.unreached.length,
          tone: "warn",
          make: () =>
            el(
              "div",
              { class: "grimoire-chips" },
              map.unreached.map((file) => fileLink(ctx, file)),
            ),
        })
      : "",
  ];
}

/** The criteria of each flow with the tests behind them. */
function testsView(ctx, feature, proofs) {
  const { el } = ctx;
  const filled = proofs.filter((item) => item.criteria.length);

  if (!filled.length) return ctx.empty("No flow of this feature has acceptance criteria yet.");

  return el(
    "div",
    { class: "grimoire-groups" },
    filled.map((item) => {
      const proven = item.criteria.filter((criterion) => criterion.status === "pass").length;
      const failing = item.criteria.some((criterion) => criterion.status === "fail");

      return group(ctx, {
        title: item.heading ?? item.flow,
        count: item.criteria.length,
        tone: failing ? "bad" : proven === item.criteria.length ? "good" : "warn",
        lead: [muted(ctx, `${proven}/${item.criteria.length} proven`)],
        make: () =>
          el("div", {}, [
            el("p", {}, [
              link(
                ctx,
                "Open the flow",
                `flow/${encodeURIComponent(feature)}/${encodeURIComponent(item.flow)}/proof`,
              ),
            ]),
            el(
              "ul",
              { class: "grimoire-proofs" },
              item.criteria.map((criterion) => proofRow(ctx, criterion, false)),
            ),
          ]),
      });
    }),
  );
}

/** The Flows tab: one row per flow with its counts. */
function flowsTable(ctx, feature, flows) {
  if (!flows.length) return ctx.empty("This feature has no flows yet.");

  return table(
    ctx,
    ["Flow", "Status", "Steps", "Cases", "Criteria tested", "Findings"],
    flows.map((flow) => [
      [
        link(
          ctx,
          flow.heading ?? flow.id,
          `flow/${encodeURIComponent(feature)}/${encodeURIComponent(flow.id)}`,
        ),
        flow.heading ? [" ", mono(ctx, flow.id)] : "",
      ],
      [pill(ctx, flow.status, toneOf(flow.status))],
      [String(flow.steps)],
      [String(flow.cases)],
      [`${flow.tested}/${flow.criteria}`],
      [flow.findings ? pill(ctx, String(flow.findings), "warn") : muted(ctx, "0")],
    ]),
  );
}

async function featureView(ctx, id, tab = "") {
  const [data, graph] = await Promise.all([
    ctx.api(`features/${encodeURIComponent(id)}`),
    ctx.api(`graph/feature/${encodeURIComponent(id)}`).catch(() => null),
  ]);
  const { el } = ctx;
  const readme = data.readme;
  const status = plain(readme.status);
  const featureId = String(plain(readme.id));
  const unexpected = data.findings.filter((finding) => !finding.expected);
  const criteria = featureCriteria(data);
  const base = `feature/${encodeURIComponent(id)}`;
  const map = data.bookmap;
  const out = el("div", { class: "grimoire-view" }, [
    crumbs(ctx, [["Features", "features"], [featureId]]),
    heading(ctx, plain(readme.title), [
      mono(ctx, featureId),
      pill(ctx, status, toneOf(status)),
      pill(ctx, `version ${plain(readme.version)}`),
      readme.origin ? pill(ctx, plain(readme.origin), toneOf(plain(readme.origin))) : "",
      muted(ctx, `updated ${plain(readme.updated)}`),
    ]),
  ]);

  const overview = () => {
    const box = el("div", { class: "grimoire-tabstack" });

    if (readme.summary) box.append(el("p", { class: "grimoire-lede", text: readme.summary }));

    box.append(featureHealthStrip(ctx, featureId, data, unexpected));
    box.append(section(ctx, "Feature map", [featureMapView(ctx, featureId, data.map)]));

    if (graph) box.append(graphView(ctx, graph, "The feature and its neighbours"));

    box.append(
      section(ctx, "Flows", [
        data.flows.length
          ? el(
              "ul",
              { class: "grimoire-flowcards" },
              data.flows.map((flow) => grimoireFlowCard(ctx, featureId, flow)),
            )
          : ctx.empty("This feature has no flows yet."),
      ]),
    );

    if (data.tasks.length) {
      box.append(
        section(ctx, "Open tasks", [
          list(
            ctx,
            data.tasks.map((task) => [
              link(ctx, task.id, `task/${encodeURIComponent(task.id)}`, {
                class: "grimoire-nowrap",
              }),
              " ",
              codeText(ctx, task.title),
              " ",
              pill(ctx, task.status, toneOf(task.status)),
            ]),
          ),
        ]),
      );
    }

    box.append(section(ctx, "Recent changes", [changesView(ctx, data.changes)]));
    return box;
  };

  out.append(
    tabbed(ctx, {
      label: "This feature",
      prefix: "grimoire-feature",
      active: tab,
      route: (key) => (key === "overview" ? base : `${base}/${key}`),
      tabs: [
        { id: "overview", label: "Overview", make: overview },
        {
          id: "flows",
          label: "Flows",
          count: data.flows.length,
          make: () => section(ctx, "Flows", [flowsTable(ctx, featureId, data.flows)]),
        },
        {
          id: "files",
          label: "Files",
          count: map.own.length,
          make: () =>
            section(ctx, "Files", [
              fileGroupsView(
                ctx,
                data.fileGroups ?? [{ module: "", files: map.own }],
                featureCodeGroups(ctx, map),
              ),
            ]),
        },
        {
          id: "findings",
          label: "Findings",
          count: unexpected.length,
          make: () => section(ctx, "Findings", [findingGroups(ctx, data.findings)]),
        },
        {
          id: "tests",
          label: "Tests",
          count: criteria.total,
          make: () => section(ctx, "Tests", [testsView(ctx, featureId, data.proofs ?? [])]),
        },
      ],
    }),
  );

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

    for (const item of state.files)
      groups.set(item.module, [...(groups.get(item.module) ?? []), item]);

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
        ? el("p", {
            class: "grimoire-error-title",
            text: `Could not load the files: ${state.error}. Try again.`,
          })
        : "",
      state.files.length < state.total || state.error
        ? el("button", {
            type: "button",
            class: "grimoire-filter",
            text: state.error
              ? "Try again"
              : `Load ${Math.min(STEP_FILES_PAGE, state.total - state.files.length)} more`,
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
      resolved: data.bookmap.steps.filter((step) => step.found === true).length,
      unchecked: data.bookmap.steps.filter((step) => step.found === null).length,
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

  return el("section", { class: "grimoire-card grimoire-fixnext" }, [
    el("h3", { text: "Fix next" }),
    ...body,
  ]);
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
      ? link(
          ctx,
          arrow === "prev" ? `‹ ${item.heading ?? item.id}` : `${item.heading ?? item.id} ›`,
          `flow/${encodeURIComponent(feature)}/${encodeURIComponent(item.id)}`,
          {
            class: `grimoire-neighbour is-${arrow}`,
            rel: arrow,
          },
        )
      : "";

  if (!data.previous && !data.next) return "";

  return ctx.el("nav", { class: className, "aria-label": "Other flows of this feature" }, [
    make(data.previous, "prev"),
    make(data.next, "next"),
  ]);
}

/** The label a journey node shows for a step. */
function nodeLabel(step) {
  const tail = step.target.indexOf(" [");

  return tail > 0 ? step.target.slice(0, tail) : step.target;
}

/** Why a node looks the way it does, in words. */
function nodeState(step) {
  if (step.found === false) return "not found in the book";
  if (step.found === null) return "not checked by the book";
  return "found in the book";
}

/** What a selected journey node shows: its note, link, entry file and the files it reaches. */
function journeyDetail(ctx, feature, flowId, flow, step) {
  const { el } = ctx;
  const written = (flow.steps ?? []).find((item) => item.index === step.index);
  const note = written && written.note ? written.note : null;
  const counts = step.counts ?? { direct: 0, feature: 0, reachable: 0, typeOnly: 0 };
  const shown = expander(ctx, "Show files", () => stepFilesPanel(ctx, feature, flowId, step));
  const space = step.target.indexOf(" ");

  return el("div", { class: "grimoire-jdetail" }, [
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
          step.linked.summary
            ? el("span", { class: "grimoire-muted" }, [" ", step.linked.summary])
            : "",
        ])
      : "",
    step.entry ? el("p", {}, [muted(ctx, "Starts at "), fileLink(ctx, step.entry)]) : "",
    counts.reachable || counts.direct
      ? el("div", { class: "grimoire-step-counts" }, [muted(ctx, countsLine(counts)), shown.button])
      : "",
    shown.panel,
  ]);
}

/**
 * The journey: the written steps drawn in order as connected nodes (a row
 * that wraps; one column on a phone). Each node is a button; the one picked
 * opens its panel under the drawing.
 */
function journeyView(ctx, feature, flowId, flow, steps) {
  const { el } = ctx;

  if (!steps.length) return ctx.empty("This flow has no steps.");

  const detail = el("div", {
    class: "grimoire-jpanel",
    id: `grimoire-jpanel-${flowId}`,
    role: "region",
    "aria-label": "Step detail",
  });
  const nodes = new Map();
  let current = null;

  function pick(step) {
    const same = current === step.index;

    current = same ? null : step.index;

    for (const [index, button] of nodes) {
      const on = index === current;

      button.setAttribute("aria-expanded", String(on));
      button.setAttribute("class", `${button.baseClass}${on ? " is-selected" : ""}`);
    }

    detail.replaceChildren(...(same ? [] : [journeyDetail(ctx, feature, flowId, flow, step)]));
  }

  const list = el(
    "ol",
    { class: "grimoire-jny", "aria-label": "Steps in order" },
    steps.map((step) => {
      const state = step.found === false ? " is-missing" : step.found === null ? " is-unknown" : "";
      const baseClass = `grimoire-jnode is-${step.type.replace(/\s+/g, "-")}${state}`;
      const button = el(
        "button",
        {
          type: "button",
          class: baseClass,
          "aria-expanded": "false",
          "aria-controls": `grimoire-jpanel-${flowId}`,
          title: `Step ${step.index}, ${step.type}: ${nodeLabel(step)} (${nodeState(step)})`,
          onclick: () => pick(step),
        },
        [
          el("span", { class: "grimoire-jnode-top" }, [
            stepIcon(ctx, step.type, 16),
            el("span", { class: "grimoire-jnode-type", text: step.type }),
            el("span", { class: "grimoire-jnode-index", text: String(step.index) }),
          ]),
          el("span", { class: "grimoire-jnode-label", text: nodeLabel(step) }),
          step.found === false
            ? el("span", { class: "grimoire-jnode-flag", text: "not found" })
            : "",
        ],
      );

      button.baseClass = baseClass;
      nodes.set(step.index, button);

      return el("li", { class: "grimoire-jstep" }, [button]);
    }),
  );

  return el("div", { class: "grimoire-journey" }, [list, detail]);
}

/** The "What if…" lane: each handled case as a small card; no card is tied to a step, the data does not say which. */
function whatIfLane(ctx, feature, flowId, flow) {
  const { el } = ctx;
  const cases = flow.cases ?? [];
  const handled = cases.filter((item) => !item.doesNotApply);
  const skipped = cases.filter((item) => item.doesNotApply);

  if (!cases.length) return "";

  return section(ctx, "What if…", [
    handled.length
      ? el(
          "ul",
          { class: "grimoire-whatif" },
          handled.map((item) =>
            el("li", { class: "grimoire-whatif-card" }, [
              el("strong", { class: "grimoire-whatif-q", text: `What if ${item.question}?` }),
              el("p", {}, codeText(ctx, item.answer)),
              (item.criteria ?? []).length
                ? el("span", { class: "grimoire-chips" }, [
                    muted(ctx, "proven by "),
                    ...item.criteria.map((id) =>
                      link(
                        ctx,
                        id,
                        `flow/${encodeURIComponent(feature)}/${encodeURIComponent(flowId)}/proof`,
                        {
                          class: "grimoire-chip",
                          title: `Open the Proof tab for ${id}`,
                        },
                      ),
                    ),
                  ])
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
  ]);
}

async function flowView(ctx, feature, flowId, tab = "") {
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
  const base = `flow/${encodeURIComponent(feature)}/${encodeURIComponent(flowId)}`;
  // Missing tests are already shown per criterion in the Proof tab, so they are not listed twice.
  const rest = data.findings.filter((finding) => finding.code !== "GR4001");
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
        sub: failing
          ? `${plural(failing, "criterion")} failing`
          : total
            ? "passing tests"
            : "none written",
        tone: failing ? "bad" : total && proven === total ? "good" : total ? "warn" : "",
      }),
      el("div", { class: "grimoire-stat" }, [
        el("span", { class: "grimoire-stat-label", text: "Last test run" }),
        el("span", {
          class: "grimoire-stat-value grimoire-stat-small",
          text:
            results && results.recorded && results.updatedAt
              ? results.updatedAt.slice(0, 10)
              : "none",
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
          text: `${health.steps.resolved}/${health.steps.total - (health.steps.unchecked ?? 0)}`,
        }),
        el("span", {
          class: "grimoire-stat-sub",
          text: health.steps.unchecked
            ? `found in the book; ${health.steps.unchecked} not checked`
            : "found in the book",
        }),
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

  const journeyTab = () => {
    const box = el("div", { class: "grimoire-tabstack" });

    if ((flow.story ?? []).length) {
      box.append(
        section(ctx, "Story", [
          el(
            "ol",
            { class: "grimoire-story" },
            flow.story.map((item) => el("li", {}, codeText(ctx, item.text))),
          ),
        ]),
      );
    }

    box.append(section(ctx, "Journey", [journeyView(ctx, feature, flowId, flow, map.steps)]));
    box.append(whatIfLane(ctx, feature, flowId, flow));

    if ((flow.differs ?? []).length) {
      box.append(
        section(ctx, "Differs by app", [
          list(
            ctx,
            flow.differs.map((item) => [mono(ctx, item.name), " ", codeText(ctx, item.text)]),
          ),
        ]),
      );
    }

    if ((flow.notHandled ?? []).length) {
      box.append(
        section(ctx, "Not handled", [
          list(
            ctx,
            flow.notHandled.map((item) => [
              el("strong", { text: item.name }),
              " ",
              codeText(ctx, item.text),
            ]),
          ),
        ]),
      );
    }

    if (flow.unknowns.length) {
      box.append(
        section(ctx, "Unknowns", [
          list(
            ctx,
            flow.unknowns.map((item) => [codeText(ctx, item.text)]),
          ),
        ]),
      );
    }

    box.append(
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
    box.append(section(ctx, "History", [changesView(ctx, data.history)]));
    box.append(neighbours(ctx, feature, data, "grimoire-pager"));
    return box;
  };

  const proofTab = () =>
    el("div", { class: "grimoire-tabstack" }, [
      fixNextBox(ctx, ref, fixNextCriterion(map.criteria)),
      section(ctx, "Proof", [
        map.criteria.length
          ? el(
              "ul",
              { class: "grimoire-proofs" },
              map.criteria.map((criterion) => proofRow(ctx, criterion, untracked)),
            )
          : ctx.empty("No criteria written."),
      ]),
    ]);

  const filesTab = () =>
    section(ctx, "Files per step", [
      map.steps.length
        ? el(
            "div",
            { class: "grimoire-groups" },
            map.steps.map((step) => {
              const counts = step.counts ?? { direct: 0, feature: 0, reachable: 0, typeOnly: 0 };

              return group(ctx, {
                title: `${step.index}. ${nodeLabel(step)}`,
                count: counts.reachable,
                tone: step.found === false ? "warn" : "",
                lead: [pill(ctx, step.type)],
                make: () =>
                  counts.reachable || counts.direct
                    ? stepFilesPanel(ctx, feature, flowId, step)
                    : muted(
                        ctx,
                        step.found === false
                          ? "The step matched nothing in the book."
                          : "This step reaches no files.",
                      ),
              });
            }),
          )
        : ctx.empty("This flow has no steps."),
    ]);

  out.append(
    tabbed(ctx, {
      label: "This flow",
      prefix: "grimoire-flowtab",
      active: tab,
      route: (key) => (key === "journey" ? base : `${base}/${key}`),
      tabs: [
        { id: "journey", label: "Journey", count: map.steps.length, make: journeyTab },
        { id: "proof", label: "Proof", count: map.criteria.length, make: proofTab },
        { id: "files", label: "Files", make: filesTab },
        {
          id: "findings",
          label: "Findings",
          count: rest.length,
          make: () => section(ctx, "Findings", [findingGroups(ctx, rest)]),
        },
      ],
    }),
  );

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
              // A big group starts closed, so a phone does not open on a wall of tables; a filter opens them all.
              el(
                "details",
                {
                  class: "grimoire-group grimoire-app-group",
                  ...(group.length <= APP_GROUP_OPEN_LIMIT || filtered ? { open: "" } : {}),
                },
                [
                  el("summary", {
                    class: "grimoire-app-group-title",
                    text: `${name ? `/${name}` : "Top level"} (${group.length})`,
                  }),
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
                ],
              ),
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
                {
                  ...filter,
                  code: group.code,
                  ...(item.feature === "(none)" ? {} : { feature: item.feature }),
                },
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
      muted(
        ctx,
        `Route facts: ${routeFactsState(report.routes).value}, ${routeFactsState(report.routes).sub}`,
      ),
    ]),
    el("p", {
      class: "grimoire-headline",
      text: `${plural(counts.errors, "error")} · ${plural(counts.warnings, "warning")} in ${plural(kinds, "kind")}`,
    }),
    el("div", { class: "grimoire-toolbar grimoire-check-filters" }, [
      el("div", { class: "grimoire-filters", role: "group", "aria-label": "Severity" }, [
        filterLink(ctx, "all", checkTarget({ ...query, severity: "" }), !query.severity),
        filterLink(
          ctx,
          "errors",
          checkTarget({ ...query, severity: "error" }),
          query.severity === "error",
        ),
        filterLink(
          ctx,
          "warnings",
          checkTarget({ ...query, severity: "warning" }),
          query.severity === "warning",
        ),
      ]),
      el("div", { class: "grimoire-filters", role: "group", "aria-label": "State" }, [
        filterLink(ctx, "to fix", checkTarget({ ...query, state: "" }), !query.state),
        filterLink(ctx, "expected", checkTarget({ ...query, state: "expected" }), expectedMode),
      ]),
      filterSelect(
        ctx,
        "Code",
        "code",
        groups.map((group) => group.code),
        query,
      ),
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
        el("h3", {
          class: "grimoire-subhead",
          text: `Expected: proposed work (${plural(expected.length, "kind")})`,
        }),
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

  // A page or screen URL: no API route, one entry per site that serves the path.
  if (found === null) {
    return el("div", { class: "grimoire-view" }, [
      crumbs(ctx, [["Modules", "modules"], [`${method} ${path}`]]),
      heading(ctx, `${method} ${path}`, [muted(ctx, "page")]),
      section(ctx, "Pages", [
        list(
          ctx,
          data.pages.map((page) => [`${page.app} ${page.route} `, fileLink(ctx, page.file)]),
        ),
      ]),
      section(ctx, "Files behind it", [fileChips(ctx, data.files, 20)]),
    ]);
  }

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

/** More modules than this and the default view is the matrix, not the graph. */
const MODULES_GRAPH_LIMIT = 40;
/** How many of the most connected modules the matrix shows. */
const MODULES_MATRIX_SIZE = 20;

/** Import counts between the most connected modules: rows import, columns are imported. */
function modulesMatrix(ctx, graph, weight) {
  const { el } = ctx;
  const top = [...graph.nodes]
    .sort(
      (left, right) =>
        (weight.get(right.id) ?? 0) - (weight.get(left.id) ?? 0) ||
        (left.title ?? left.label).localeCompare(right.title ?? right.label),
    )
    .slice(0, MODULES_MATRIX_SIZE);
  const ids = new Set(top.map((node) => node.id));
  const counts = new Map();
  let biggest = 1;

  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;

    const value = edge.weight ?? 1;

    counts.set(`${edge.from}\n${edge.to}`, value);
    biggest = Math.max(biggest, value);
  }

  const name = (node) => node.title ?? node.label;

  return el("div", { class: "grimoire-card grimoire-modmatrix" }, [
    el("h3", { text: `The ${top.length} most connected modules` }),
    el("p", {
      class: "grimoire-muted",
      text: "Each cell counts the imports from the module on its row to the module in its column. Point at a name for its full path.",
    }),
    el("div", { class: "grimoire-scroll" }, [
      el("table", { class: "grimoire-table grimoire-modmatrix-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { scope: "col", text: "From / to" }),
            ...top.map((node) =>
              el("th", { scope: "col", title: name(node), text: shortenEnd(node.label, 10) }),
            ),
          ]),
        ]),
        el(
          "tbody",
          {},
          top.map((row) =>
            el("tr", {}, [
              el("th", { scope: "row", title: name(row), text: shortenEnd(row.label, 24) }),
              ...top.map((column) => {
                const value = counts.get(`${row.id}\n${column.id}`) ?? 0;

                return el("td", {
                  class: value ? "grimoire-modmatrix-cell has-imports" : "grimoire-modmatrix-cell",
                  title: `${name(row)} imports ${name(column)} ${plural(value, "time")}`,
                  style: value ? `--gm-level:${Math.round(10 + (value / biggest) * 60)}%` : null,
                  text: value ? String(value) : "",
                });
              }),
            ]),
          ),
        ),
      ]),
    ]),
  ]);
}

async function modulesView(ctx) {
  const graph = await ctx.api("graph/modules");
  const { el } = ctx;
  const weight = new Map();

  for (const edge of graph.edges) {
    for (const end of [edge.from, edge.to])
      weight.set(end, (weight.get(end) ?? 0) + (edge.weight ?? 1));
  }

  const items = graph.nodes.map((node) => ({
    label: node.title ?? node.label,
    links: weight.get(node.id) ?? 0,
  }));
  const big = graph.nodes.length > MODULES_GRAPH_LIMIT;
  const holder = el("div", { class: "grimoire-modview" });
  let mode = big ? "matrix" : "graph";

  const toggle = el("div", { class: "grimoire-modtoggle", role: "group", "aria-label": "View" });
  const buttons = new Map();

  function show(next) {
    mode = next;
    holder.replaceChildren(
      mode === "matrix" ? modulesMatrix(ctx, graph, weight) : graphView(ctx, graph, "Modules"),
    );

    for (const [key, button] of buttons) {
      button.setAttribute("aria-pressed", String(key === mode));
      button.setAttribute(
        "class",
        key === mode ? "grimoire-bird-button is-primary" : "grimoire-bird-button",
      );
    }
  }

  if (big) {
    for (const [key, label] of [
      ["matrix", "Matrix"],
      ["graph", "Graph"],
    ]) {
      const button = el("button", {
        type: "button",
        text: label,
        onclick: () => show(key),
      });

      buttons.set(key, button);
      toggle.append(button);
    }
  }

  show(mode);

  return el("div", { class: "grimoire-view" }, [
    heading(ctx, "Module coupling"),
    el("p", {
      class: "grimoire-muted",
      text: big
        ? `Imports between modules. There are ${graph.nodes.length} modules, so the matrix of the most connected ones opens first; the graph is one click away.`
        : "Lines are imports between modules; thicker means more imports. The most connected modules are drawn.",
    }),
    big ? toggle : "",
    holder,
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

// ── Bird view ───────────────────────────────────────────────────────────────

/** The words, glyph and tone of a cell state. A colour is never the only signal: every cell prints its words. */
const BIRD_STATES = {
  rejected: { label: "Rejected", glyph: "✕", tone: "bad" },
  fail: { label: "Failing", glyph: "✕", tone: "bad" },
  changed: { label: "Changed, not approved", glyph: "≠", tone: "warn" },
  stale: { label: "Needs a new run", glyph: "!", tone: "warn" },
  "not-run": { label: "Not run yet", glyph: "…", tone: "warn" },
  "no-test": { label: "No test", glyph: "–", tone: "" },
  pass: { label: "Passing", glyph: "✓", tone: "good" },
};

const BIRD_STATE_ORDER = ["rejected", "fail", "changed", "stale", "not-run", "no-test", "pass"];

/** The target the Approve all button sends when there is no baseline yet (the baseline is created from the current state). */
const BIRD_APPROVE_ALL = "all";

/** What an Approve or Reject failure says: the server's message, its status and reference, and what to do next. */
function birdFailure(verb, failure) {
  const details = [
    failure?.status ? `status ${failure.status}` : "",
    failure?.ref ? `reference ${failure.ref}` : "",
  ].filter(Boolean);

  return `Could not ${verb}: ${failure?.message ?? "the server did not answer"}${
    details.length ? ` (${details.join(", ")})` : ""
  }. Nothing was changed. Try again, or run warlock grimoire ${verb} in a terminal.`;
}

/** What a drift item says, in plain words. */
const BIRD_DRIFT_WORDS = {
  "shot-changed": "The screenshot changed",
  "shot-added": "A new screenshot was captured",
  "shot-removed": "The screenshot is no longer captured",
  "flow-added": "The flow is new",
  "flow-removed": "The flow was removed",
  "criterion-added": "A criterion was added",
  "criterion-removed": "A criterion was removed",
  "criterion-changed": "The criterion text changed",
  "case-added": "A case was added",
  "case-removed": "A case was removed",
  "proof-removed": "A proving test was removed",
};

/** Whether a path is a plain image path inside the screenshots folder (no scheme, no `..`), so `ctx.file()` cannot leave it. */
function birdShotPath(src) {
  if (typeof src !== "string" || src === "" || src.startsWith("/") || /[\\:\0?#]/.test(src))
    return false;

  return (
    src.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
    /\.(png|jpe?g|webp|gif)$/i.test(src)
  );
}

function birdLanguage(language) {
  return language === "" ? "All languages" : language;
}

/** The sentence of a drift item for the side-by-side panel. */
function birdDriftWords(item) {
  const base = BIRD_DRIFT_WORDS[item.type] ?? item.type;
  const named = item.case ? `${base}: ${item.case}` : base;

  return item.language ? `${named} (${item.language})` : named;
}

/** How a filter text matches: an `AC-n` text matches that criterion exactly, anything else is a substring. */
function birdMatcher(text) {
  const needle = text.trim().toLowerCase();
  const exactCriterion = /^ac-\d+$/.test(needle);

  return {
    empty: needle === "",
    feature: (feature) =>
      feature.id.toLowerCase().includes(needle) || feature.title.toLowerCase().includes(needle),
    flow: (flow) =>
      flow.ref.toLowerCase().includes(needle) || flow.title.toLowerCase().includes(needle),
    criterion: (row) =>
      exactCriterion ? row.id.toLowerCase() === needle : row.id.toLowerCase().includes(needle),
  };
}

/** The features, flows and criteria that match a filter; a matching feature or flow keeps everything under it. */
function birdFilter(features, text) {
  const match = birdMatcher(text);

  if (match.empty) return features;

  return features.flatMap((feature) => {
    if (match.feature(feature)) return [feature];

    const flows = feature.flows.flatMap((flow) => {
      if (match.flow(flow)) return [flow];

      const criteria = flow.criteria.filter(match.criterion);

      return criteria.length ? [{ ...flow, criteria }] : [];
    });

    return flows.length ? [{ ...feature, flows }] : [];
  });
}

/** Cells per state over some flows. */
function birdCounts(flows) {
  const counts = {};

  for (const flow of flows)
    for (const row of flow.criteria)
      for (const cell of row.cells) counts[cell.state] = (counts[cell.state] ?? 0) + 1;

  return counts;
}

/** Pills for the states that need a look, or "all passing". */
function birdCountPills(ctx, counts) {
  const shown = BIRD_STATE_ORDER.filter((state) => state !== "pass" && counts[state]);

  if (!shown.length)
    return counts.pass ? pill(ctx, `${counts.pass} passing`, "good") : muted(ctx, "no criteria");

  return shown.map((state) =>
    pill(
      ctx,
      `${counts[state]} ${BIRD_STATES[state].label.toLowerCase()}`,
      BIRD_STATES[state].tone,
    ),
  );
}

/** One image of the side-by-side panel, or the words that say there is none. */
function birdFigure(ctx, title, src, none) {
  const { el } = ctx;

  return el("figure", { class: "grimoire-bird-figure" }, [
    el("figcaption", { text: title }),
    birdShotPath(src) && typeof ctx.file === "function"
      ? el("img", { src: ctx.file(src), alt: title, loading: "lazy" })
      : el("p", { class: "grimoire-muted grimoire-bird-none", text: none }),
  ]);
}

/**
 * The side-by-side panel: approved left, captured right, what changed, and
 * (in development) Approve and Reject. A failed request keeps the panel open
 * and says what failed.
 */
function birdPanel(ctx, data, develop) {
  const { el } = ctx;
  const body = el("div", { class: "grimoire-bird-panel-body" });
  const dialog = el(
    "dialog",
    {
      class: "grimoire-bird-panel",
      "aria-label": "Compare",
      onclick: (event) => {
        if (event && event.target === dialog) dialog.close?.();
      },
    },
    [body],
  );
  const byId = new Map((data.drift ?? []).map((item) => [item.id, item]));

  async function send(action, ids, note, error, button) {
    const verb = action === "approve" ? "approve" : "reject";

    error.textContent = "";
    button.setAttribute("disabled", "");

    try {
      await ctx.api(action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note ? { ids, note } : { ids }),
      });
      dialog.close?.();
      ctx.refresh();
    } catch (failure) {
      button.removeAttribute?.("disabled");
      // The dialog stays open: the failure is shown where the click happened.
      error.textContent = birdFailure(verb, failure);
    }
  }

  function open({ title, language, state, test, shown, drift }) {
    const items = drift.map((id) => byId.get(id)).filter(Boolean);
    const info = BIRD_STATES[state] ?? BIRD_STATES["no-test"];
    const error = el("p", { class: "grimoire-error-title", role: "alert" });
    const note = el("input", {
      type: "text",
      class: "grimoire-filter-input",
      placeholder: "Why? (optional, kept with a rejection)",
      "aria-label": "Why reject",
    });
    const approve = el("button", {
      type: "button",
      class: "grimoire-bird-button is-primary",
      text: items.length > 1 ? `Approve ${items.length} changes` : "Approve",
      onclick: () => send("approve", drift, "", error, approve),
    });
    const reject = el("button", {
      type: "button",
      class: "grimoire-bird-button",
      text: items.length > 1 ? `Reject ${items.length} changes` : "Reject",
      onclick: () => send("reject", drift, (note.value ?? "").trim(), error, reject),
    });

    body.replaceChildren(
      el("header", { class: "grimoire-bird-panel-head" }, [
        el("h3", { text: title }),
        language === null ? "" : pill(ctx, birdLanguage(language)),
        pill(ctx, info.label, info.tone),
      ]),
      test ? el("p", {}, ["Test: ", pill(ctx, test, toneOf(test))]) : "",
      shown
        ? el("div", { class: "grimoire-bird-compare" }, [
            birdFigure(ctx, "Approved", shown.approved, "No approved image yet."),
            birdFigure(
              ctx,
              "Captured",
              shown.shot,
              shown.outcome === "fail"
                ? "The scene failed, so there is no capture."
                : "Not captured yet.",
            ),
          ])
        : "",
      items.length
        ? el("section", { class: "grimoire-bird-changes", "aria-label": "Changes not approved" }, [
            el("h4", { text: "Changes not approved" }),
            el(
              "ul",
              { class: "grimoire-list" },
              items.map((item) =>
                el("li", {}, [
                  el("strong", { text: birdDriftWords(item) }),
                  item.rejected
                    ? [
                        " ",
                        pill(ctx, "rejected", "bad"),
                        item.rejected.note ? ` ${item.rejected.note}` : "",
                      ]
                    : "",
                  item.before !== null || item.after !== null
                    ? el("p", { class: "grimoire-muted" }, [
                        item.before !== null ? `Before: ${item.before}` : "",
                        item.before !== null && item.after !== null ? " · " : "",
                        item.after !== null ? `Now: ${item.after}` : "",
                      ])
                    : "",
                ]),
              ),
            ),
          ])
        : el("p", { class: "grimoire-muted", text: "Nothing here is waiting for approval." }),
      develop && items.length
        ? el("div", { class: "grimoire-bird-actions" }, [note, approve, reject])
        : "",
      error,
      el("button", {
        type: "button",
        class: "grimoire-bird-button",
        text: "Close",
        onclick: () => dialog.close?.(),
      }),
    );

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  return { dialog, open };
}

/** One cell: the state in words and glyph, with the captured image as a thumbnail. */
function birdCell(ctx, cell, label, panel, context) {
  const { el } = ctx;
  const info = BIRD_STATES[cell.state] ?? BIRD_STATES["no-test"];
  const shot = cell.shown?.shot ?? null;

  return el("td", { class: "grimoire-bird-td" }, [
    el(
      "button",
      {
        type: "button",
        class: `grimoire-bird-cell is-${cell.state}`,
        "aria-label": `${label}, ${birdLanguage(cell.language)}: ${info.label}`,
        onclick: () =>
          panel.open({
            ...context,
            language: cell.language,
            state: cell.state,
            test: cell.test,
            shown: cell.shown,
            drift: cell.drift,
          }),
      },
      [
        birdShotPath(shot) && typeof ctx.file === "function"
          ? el("img", {
              class: "grimoire-bird-thumb",
              src: ctx.file(shot),
              alt: "",
              loading: "lazy",
            })
          : "",
        el("span", { class: "grimoire-bird-state" }, [
          el("span", { class: "grimoire-bird-glyph", "aria-hidden": "true", text: info.glyph }),
          el("span", { text: info.label }),
        ]),
      ],
    ),
  ]);
}

function birdFlow(ctx, data, feature, flow, panel, forceOpen, develop) {
  const { el } = ctx;
  const counts = birdCounts([flow]);
  const hot =
    ["rejected", "fail", "changed"].some((state) => counts[state]) || flow.drift.length > 0;
  const title = `${feature.title} / ${flow.title}`;
  const head = [
    el("span", { class: "grimoire-bird-name", text: flow.title }),
    mono(ctx, flow.ref),
    flow.removed ? pill(ctx, "removed", "warn") : "",
    flow.differsIn.length ? pill(ctx, `differs in ${flow.differsIn.join(", ")}`) : "",
    !flow.screenshots && data.mode !== "off" ? pill(ctx, "no screenshots") : "",
    flow.drift.length
      ? pill(ctx, `${plural(flow.drift.length, "change")} not approved`, "warn")
      : "",
    birdCountPills(ctx, counts),
  ];
  const lines = flow.criteria.map((row) =>
    el("tr", { class: row.removed ? "is-removed" : "" }, [
      el("th", { scope: "row", class: "grimoire-bird-rowhead" }, [
        el("span", { class: "grimoire-mono", text: row.id }),
        row.app ? [" ", pill(ctx, row.app)] : "",
        row.removed ? [" ", pill(ctx, "removed", "warn")] : "",
        el("span", { class: "grimoire-bird-text", text: row.text }),
      ]),
      ...row.cells.map((cell) =>
        birdCell(ctx, cell, `${flow.ref} ${row.id}`, panel, {
          title: `${title}, ${row.id}`,
        }),
      ),
    ]),
  );

  return el("details", { class: "grimoire-bird-flow", ...(forceOpen || hot ? { open: "" } : {}) }, [
    el("summary", { class: "grimoire-bird-summary" }, head),
    el("div", { class: "grimoire-bird-flowbody" }, [
      flow.drift.length
        ? el("p", {}, [
            el("button", {
              type: "button",
              class: "grimoire-bird-button",
              text: develop ? "Review the flow's changes" : "See the flow's changes",
              onclick: () =>
                panel.open({
                  title,
                  language: null,
                  state: "changed",
                  test: null,
                  shown: null,
                  drift: flow.drift,
                }),
            }),
          ])
        : "",
      flow.criteria.length
        ? el("div", { class: "grimoire-scroll" }, [
            el("table", { class: "grimoire-table grimoire-bird-table" }, [
              el("thead", {}, [
                el("tr", {}, [
                  el("th", { scope: "col", text: "Criterion" }),
                  ...data.languages.map((language) =>
                    el("th", { scope: "col", text: language === "" ? "All" : language }),
                  ),
                ]),
              ]),
              el("tbody", {}, lines),
            ]),
          ])
        : ctx.empty("This flow has no acceptance criteria."),
      link(
        ctx,
        "Open the flow",
        `flow/${encodeURIComponent(flow.ref.split("/")[0])}/${encodeURIComponent(flow.id)}`,
      ),
    ]),
  ]);
}

/** The Bird view: every feature, flow and criterion against the app's languages. */
async function birdView(ctx, query = {}) {
  const data = await ctx.api("matrix");
  const { el } = ctx;
  const develop = data.development === true && ctx.shared !== true;
  const panel = birdPanel(ctx, data, develop);
  const results = el("div", { class: "grimoire-bird-list" });
  const count = el("p", { class: "grimoire-muted", role: "status", "aria-live": "polite" });
  let text = String(query.q ?? "");

  const paint = () => {
    const matches = birdFilter(data.features, text);
    const flows = matches.flatMap((feature) => feature.flows);
    const forceOpen = text.trim() !== "";

    count.textContent = forceOpen
      ? `${plural(flows.length, "flow")} match`
      : `${plural(data.features.length, "feature")}, ${plural(
          data.features.reduce((total, feature) => total + feature.flows.length, 0),
          "flow",
        )}`;
    results.replaceChildren(
      ...(matches.length
        ? matches.map((feature) => {
            const counts = birdCounts(feature.flows);
            const hot = ["rejected", "fail", "changed"].some((state) => counts[state]);

            return el(
              "details",
              { class: "grimoire-bird-feature", ...(forceOpen || hot ? { open: "" } : {}) },
              [
                el("summary", { class: "grimoire-bird-summary" }, [
                  el("span", { class: "grimoire-bird-name", text: feature.title }),
                  mono(ctx, feature.id),
                  feature.designSystem ? pill(ctx, "design system", "info") : "",
                  birdCountPills(ctx, counts),
                ]),
                el(
                  "div",
                  { class: "grimoire-bird-featurebody" },
                  feature.flows.length
                    ? feature.flows.map((flow) =>
                        birdFlow(ctx, data, feature, flow, panel, forceOpen, develop),
                      )
                    : ctx.empty("This feature has no flows yet."),
                ),
              ],
            );
          })
        : [
            ctx.empty(
              `Nothing matches "${text.trim()}". Try a feature, a flow or an AC number such as AC-3.`,
            ),
          ]),
    );
  };

  const input = el("input", {
    type: "search",
    class: "grimoire-filter-input",
    value: text,
    placeholder: "Jump to a feature, a flow or AC-3",
    "aria-label": "Jump to a feature, a flow or a criterion",
    oninput: (event) => {
      text = event?.target?.value ?? "";
      rememberRoute(
        ctx,
        text.trim() ? `bird-view?q=${encodeURIComponent(text.trim())}` : "bird-view",
      );
      paint();
    },
  });
  const banners = [];
  const waiting = (data.drift ?? []).filter((item) => item.rejected === null).length;

  if (data.mode === "off") {
    banners.push(
      el("p", {
        class: "grimoire-note",
        text: "Screenshots are off in grimoire/settings.md. The matrix shows test status only.",
      }),
    );
  }

  // One button that approves some ids; a failure is written next to it and the button stays usable.
  const approveButton = (label, ids, primary) => {
    const error = el("span", { class: "grimoire-error-title", role: "alert" });
    const button = el("button", {
      type: "button",
      class: primary ? "grimoire-bird-button is-primary" : "grimoire-bird-button",
      text: label,
      onclick: async () => {
        error.textContent = "";

        try {
          await ctx.api("approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
          });
          ctx.refresh();
        } catch (failure) {
          error.textContent = ` ${birdFailure("approve", failure)}`;
        }
      },
    });

    return [button, error];
  };

  if (data.baseline === null) {
    banners.push(
      el("p", { class: "grimoire-note" }, [
        "Nothing approved yet: approve all to start. Until then the matrix shows test status and the latest screenshots, and nothing counts as changed. ",
        develop ? approveButton("Approve all", [BIRD_APPROVE_ALL], true) : "",
      ]),
    );
  } else if (develop && waiting > 0) {
    banners.push(
      el("p", { class: "grimoire-note" }, [
        `${plural(waiting, "change")} not approved. `,
        approveButton(
          `Approve all ${waiting}`,
          data.drift.filter((item) => item.rejected === null).map((item) => item.id),
          false,
        ),
      ]),
    );
  }

  paint();

  return el("div", { class: "grimoire-view grimoire-bird" }, [
    heading(ctx, "Bird view"),
    el("p", {
      class: "grimoire-muted",
      text: "Every criterion against every language: its test status, and the screenshot of the scene that shows it. Open a cell to compare it with the approved image.",
    }),
    el(
      "ul",
      { class: "grimoire-bird-legend", "aria-label": "Cell states" },
      BIRD_STATE_ORDER.map((state) =>
        el("li", {}, [
          pill(
            ctx,
            `${BIRD_STATES[state].glyph} ${BIRD_STATES[state].label}`,
            BIRD_STATES[state].tone,
          ),
          " ",
          muted(ctx, String(data.counts?.[state] ?? 0)),
        ]),
      ),
    ),
    ...banners,
    el("div", { class: "grimoire-toolbar" }, [input, count]),
    results,
    panel.dialog,
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
      const map =
        globalThis.grimoireProductMap ??
        (await import(/* @vite-ignore */ moduleUrl(ctx.asset("product-map.js"))));

      return map.productMapView(ctx, parts.slice(1));
    }
    case "bird-view":
      return birdView(ctx, query);
    case "features":
      return featuresView(ctx);
    case "feature":
      return featureView(ctx, first, second);
    case "flow":
      return flowView(ctx, first, second, parts[3] ?? "");
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
    "bird-view": ["the bird view", null],
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

/** The hint under the progress line: more specific the longer the book takes. */
function loadingHint(seconds) {
  if (seconds >= 40)
    return "Still opening after 40 s. Check that the app is running and look at its server log; Retry appears if the request fails.";
  if (seconds >= 15)
    return "This is taking longer than usual. A very large book can need up to 30 s the first time; keep this tab open.";
  if (seconds >= 5) return "Large books take 5–15 s the first time; later opens are instant.";

  return "Reading the book. The first open of a large book can take a few seconds.";
}

// Inline, so the layout holds even when grimoire.css fails to load (tokens only).
const SKEL_GRID =
  "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:12px;margin-top:6px";
const SKEL_BLOCK = "height:76px;border-radius:var(--radius,10px);background-color:var(--muted)";
const SKEL_ROW =
  "height:34px;border-radius:calc(var(--radius,10px) - 4px);background-color:var(--muted)";
const SKEL_TRACK =
  "height:4px;border-radius:2px;background:var(--muted);overflow:hidden;position:relative;max-width:260px";
const SKEL_BAR = "height:100%;width:40%;border-radius:2px;background:var(--brand,var(--primary))";

/**
 * The loading state: a skeleton of the Overview with a progress line, a live
 * elapsed counter and a hint that grows more specific with time. `stop()` ends
 * the counter; call it once the view is filled in or failed.
 */
function skeleton(ctx) {
  const { el } = ctx;
  const started = Date.now();
  const counter = el("span", { class: "grimoire-load-elapsed", text: "0 s" });
  const hint = el("p", { class: "grimoire-muted grimoire-load-hint", text: loadingHint(0) });
  const timer =
    typeof setInterval === "function"
      ? setInterval(() => {
          const seconds = Math.floor((Date.now() - started) / 1000);

          counter.textContent = `${seconds} s`;
          hint.textContent = loadingHint(seconds);
        }, 1000)
      : null;

  const node = el(
    "div",
    {
      class: "grimoire-skeleton",
      role: "status",
      "aria-live": "polite",
      style: "display:grid;gap:10px",
    },
    [
      el("p", {
        class: "grimoire-skeleton-title",
        style: "margin:0;font-weight:600",
        text: "Opening the book…",
      }),
      el("div", { class: "grimoire-load-progress", style: "display:grid;gap:6px" }, [
        el("div", { class: "grimoire-load-track", style: SKEL_TRACK, "aria-hidden": "true" }, [
          el("div", { class: "grimoire-load-bar", style: SKEL_BAR }),
        ]),
        el("p", { class: "grimoire-muted", style: "margin:0" }, ["Elapsed ", counter]),
      ]),
      hint,
      el(
        "div",
        { class: "grimoire-skeleton-grid", style: SKEL_GRID, "aria-hidden": "true" },
        [1, 2, 3, 4, 5, 6].map(() =>
          el("div", { class: "grimoire-skeleton-block", style: SKEL_BLOCK }),
        ),
      ),
      el(
        "div",
        {
          class: "grimoire-skeleton-rows",
          style: "display:grid;gap:8px;margin-top:6px",
          "aria-hidden": "true",
        },
        [1, 2, 3, 4, 5].map(() => el("div", { class: "grimoire-skeleton-row", style: SKEL_ROW })),
      ),
    ],
  );

  return {
    node,
    stop: () => {
      if (timer !== null) clearInterval(timer);
    },
  };
}

/** A failed view: what failed, why, what to do, and a way to try again. */
function errorBox(ctx, route, error) {
  const { el } = ctx;
  const [what, back] = describe(route);
  const base = error && error.message ? error.message : String(error);
  const status =
    error && typeof error.status === "number" && error.status > 0 ? ` (HTTP ${error.status})` : "";
  const message = base + status;
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
  const brandSlot = el("div", { class: "grimoire-brand-slot" });
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
      set("bird-view", data.birdView || undefined);
      set("features", data.features?.features?.length);
      set("apps", data.apps?.apps);
      set("tasks", data.tasks ? data.tasks.open.length : undefined);
      set("releases", data.releases);
      set("check", data.counts ? data.counts.errors + data.counts.warnings : undefined);

      const brand = grimoireBrand(ctx, data.host);

      if (brand) brandSlot.replaceChildren(brand);
    },
    () => undefined,
  );

  return {
    element: el("div", { class: "grimoire-header" }, [
      brandSlot,
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

  const loading = skeleton(ctx);

  content.append(loading.node);
  top.input.disabled = true;
  const footer = el("footer", { class: "grimoire-footer" });

  summaryRequest.then(
    (data) => {
      const line = grimoireAppLine(ctx, data.host);

      if (line) footer.replaceChildren(line);
    },
    () => undefined,
  );
  root.append(el("div", { class: "grimoire-root" }, [top.element, content, footer]));
  top.revealActive();

  const loaded = (async () => {
    try {
      content.replaceChildren(await body(ctx, summaryRequest));
    } catch (error) {
      content.replaceChildren(errorBox(ctx, route, error));
    }
    loading.stop();
    top.input.disabled = false;
    content.setAttribute("aria-busy", "false");
  })();

  // A quick answer is shown filled in; a slow one hands back the skeleton at once and fills in later.
  await (typeof setTimeout === "function"
    ? Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, SKELETON_AFTER))])
    : loaded);
  return root;
}

export default renderGrimoire;
